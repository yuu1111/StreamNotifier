import { ChangeTypes, type Config, type StreamerConfig, ThumbnailSize } from "../config/schema";

/**
 * @description RSS上限バイト数(512MB) - mimallockのアドレス空間保持により修正不可なRSS肥大時に自動再起動
 */
const RSS_LIMIT_BYTES = 512 * 1024 * 1024;

/**
 * @description GC実行間隔(ポーリング回数)
 */
const GC_INTERVAL = 10;

/**
 * @description メモリログ出力間隔(ポーリング回数)
 */
const MEMORY_LOG_INTERVAL = 100;

import type { TwitchAPI } from "../twitch/api";
import type { TwitchChannel, TwitchStream, TwitchUser } from "../twitch/types";
import { createLogger } from "../utils/logger";
import { type DetectedChange, detectChanges } from "./detector";
import { StateManager, type StreamerState } from "./state";

/**
 * @description ポーリングモジュールのロガー
 */
const logger = createLogger("monitor:poller");

/**
 * @description 配信者の状態を定期的にポーリングし変更を検出するクラス
 */
export class Poller {
  /**
   * @description ポーリングのタイマーID
   */
  private timeoutId: ReturnType<typeof setTimeout> | null = null;

  /**
   * @description 配信者の状態を管理するインスタンス
   */
  private stateManager = new StateManager();

  /**
   * @description ユーザー情報のキャッシュ
   */
  private userCache = new Map<string, TwitchUser>();

  /**
   * @description ポーリング実行回数(メモリ診断ログの間隔制御用)
   */
  private pollCount = 0;

  /**
   * @description RSS上限超過により再起動待機中フラグ
   */
  private restartPending = false;

  /**
   * @description Pollerインスタンスを作成
   * @param api - Twitch APIクライアント
   * @param config - アプリケーション設定
   * @param onChanges - 変更検出時のコールバック
   */
  constructor(
    private api: TwitchAPI,
    private config: Config,
    private onChanges: (changes: DetectedChange[], streamerConfig: StreamerConfig) => Promise<void>
  ) {}

  /**
   * @description ポーリングを開始
   */
  async start(): Promise<void> {
    await this.initializeUserCache();
    await this.poll();

    const intervalMs = this.config.polling.intervalSeconds * 1000;
    this.scheduleNextPoll(intervalMs);

    const { intervalSeconds } = this.config.polling;
    const streamerCount = this.config.streamers.length;
    logger.info(`ポーリング開始 (間隔: ${intervalSeconds}秒, 配信者: ${streamerCount}人)`);
  }

  /**
   * @description ポーリングを停止
   */
  stop(): void {
    if (!this.timeoutId) return;

    clearTimeout(this.timeoutId);
    this.timeoutId = null;
    logger.info("ポーリング停止");
  }

  /**
   * @description poll完了後に次のポーリングをスケジュール
   * @param intervalMs - ポーリング間隔(ミリ秒)
   */
  private scheduleNextPoll(intervalMs: number): void {
    this.timeoutId = setTimeout(async () => {
      await this.poll();
      if (this.timeoutId !== null) {
        this.scheduleNextPoll(intervalMs);
      }
    }, intervalMs);
  }

  /**
   * @description ユーザー情報をキャッシュに読み込む
   */
  private async initializeUserCache(): Promise<void> {
    const usernames = this.config.streamers.map((s: StreamerConfig) => s.username);
    this.userCache = await this.api.getUsers(usernames);

    for (const streamer of this.config.streamers) {
      const user = this.userCache.get(streamer.username.toLowerCase());
      if (!user) {
        logger.warn(`ユーザーが見つかりません: ${streamer.username}`);
      }
    }
  }

  /**
   * @description タイトル変更とゲーム変更を同時検出した場合に統合
   * @param changes - 検出された変更の配列
   * @returns 統合後の変更配列
   */
  private combineChanges(changes: DetectedChange[]): DetectedChange[] {
    const titleChange = changes.find((c) => c.type === ChangeTypes.TitleChange);
    const gameChange = changes.find((c) => c.type === ChangeTypes.GameChange);

    // タイトル変更とゲーム変更が同時発生していない場合はそのまま返す
    const hasBothChanges = titleChange && gameChange;
    if (!hasBothChanges) {
      return changes;
    }

    const combinedChange: DetectedChange = {
      type: ChangeTypes.TitleAndGameChange,
      streamer: titleChange.streamer,
      oldTitle: titleChange.oldValue,
      newTitle: titleChange.newValue,
      oldGame: gameChange.oldValue,
      newGame: gameChange.newValue,
      currentState: titleChange.currentState,
    };

    const otherChanges = changes.filter(
      (c) => c.type !== ChangeTypes.TitleChange && c.type !== ChangeTypes.GameChange
    );

    return [...otherChanges, combinedChange];
  }

  /**
   * @description ユーザー情報から配信者状態を構築
   * @param user - Twitchユーザー情報
   * @param stream - 配信情報(配信中の場合)
   * @param channel - チャンネル情報(オフラインの場合)
   * @returns 構築された配信者状態
   */
  private buildStreamerState(
    user: TwitchUser,
    stream: TwitchStream | undefined,
    channel: TwitchChannel | undefined
  ): StreamerState {
    const source = stream ?? channel;

    return {
      userId: user.id,
      username: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
      isLive: !!stream,
      title: source?.title ?? "",
      gameId: source?.game_id ?? "",
      gameName: source?.game_name ?? "",
      startedAt: stream?.started_at ?? null,
      thumbnailUrl: stream?.thumbnail_url ?? null,
      viewerCount: stream?.viewer_count ?? 0,
    };
  }

  /**
   * @description オフライン配信者のユーザーIDを収集
   * @param streams - 配信中の配信者マップ
   * @returns オフライン配信者のユーザーID配列
   */
  private collectOfflineUserIds(streams: Map<string, TwitchStream>): string[] {
    const offlineUserIds: string[] = [];

    for (const streamer of this.config.streamers) {
      const username = streamer.username.toLowerCase();
      const user = this.userCache.get(username);

      if (user && !streams.has(username)) {
        offlineUserIds.push(user.id);
      }
    }

    return offlineUserIds;
  }

  /**
   * @description offline変更にVOD情報を付与
   * @param changes - 検出された変更の配列
   * @param userId - ユーザーID
   */
  private async attachVodInfo(changes: DetectedChange[], userId: string): Promise<void> {
    for (const change of changes) {
      if (change.type !== ChangeTypes.Offline) continue;

      const vod = await this.api.getLatestVod(userId);
      if (!vod) continue;

      change.vodUrl = vod.url;
      change.vodThumbnailUrl = vod.thumbnail_url
        .replace("%{width}", ThumbnailSize.Width)
        .replace("%{height}", ThumbnailSize.Height);
    }
  }

  /**
   * @description 初回ポーリング時のログ出力
   * @param state - 配信者の状態
   */
  private logInitialState(state: StreamerState): void {
    const status = state.isLive ? `配信中 - ${state.gameName || "ゲーム未設定"}` : "オフライン";
    logger.info(`[${state.displayName}] 初期状態: ${status}`);
  }

  /**
   * @description 単一配信者の変更を処理
   * @param streamerConfig - 配信者設定
   * @param streams - 配信中の配信者マップ
   * @param channels - チャンネル情報マップ
   */
  private async processStreamer(
    streamerConfig: StreamerConfig,
    streams: Map<string, TwitchStream>,
    channels: Map<string, TwitchChannel>
  ): Promise<void> {
    const username = streamerConfig.username.toLowerCase();
    const user = this.userCache.get(username);
    if (!user) return;

    const stream = streams.get(username);
    const channel = channels.get(username);
    const newState = this.buildStreamerState(user, stream, channel);

    const oldState = this.stateManager.getState(username);
    const isInitialPoll = !oldState;

    if (isInitialPoll) {
      this.logInitialState(newState);
    }

    const detectedChanges = detectChanges(oldState, newState);

    // detectChangesは初回ポーリング時に空配列を返すため、配信中であればonline通知を追加
    if (isInitialPoll && newState.isLive) {
      detectedChanges.push({
        type: ChangeTypes.Online,
        streamer: newState.username,
        currentState: newState,
      });
    }

    const combinedChanges = this.combineChanges(detectedChanges);
    await this.attachVodInfo(combinedChanges, user.id);

    if (combinedChanges.length > 0) {
      await this.onChanges(combinedChanges, streamerConfig);
    }

    this.stateManager.updateState(username, newState);
  }

  /**
   * @description メモリ使用量をログ出力し、RSS上限超過時に再起動待機を開始
   */
  private logMemory(): void {
    const mem = process.memoryUsage();
    const toMB = (bytes: number) => (bytes / 1024 / 1024).toFixed(1);
    logger.info(
      `[メモリ] RSS: ${toMB(mem.rss)}MB, HeapUsed: ${toMB(mem.heapUsed)}MB, HeapTotal: ${toMB(mem.heapTotal)}MB`
    );

    if (!this.restartPending && mem.rss > RSS_LIMIT_BYTES) {
      logger.warn(
        `RSS ${toMB(mem.rss)}MBが上限${toMB(RSS_LIMIT_BYTES)}MBを超過 - 全員オフライン時に再起動します`
      );
      this.restartPending = true;
    }
  }

  /**
   * @description 配信中の配信者が1人もいないかチェック
   */
  private isAllOffline(): boolean {
    for (const streamer of this.config.streamers) {
      const state = this.stateManager.getState(streamer.username.toLowerCase());
      if (state?.isLive) return false;
    }
    return true;
  }

  /**
   * @description 再起動待機中かつ全員オフラインならプロセスを終了
   */
  private checkRestart(): void {
    if (!this.restartPending || !this.isAllOffline()) return;

    logger.info("全配信者オフライン確認 - プロセスを再起動します");
    this.stop();
    process.exit(0);
  }

  /**
   * @description 全配信者の状態をポーリングして変更を検出
   */
  private async poll(): Promise<void> {
    try {
      const usernames = this.config.streamers.map((s: StreamerConfig) => s.username);
      const streams = await this.api.getStreams(usernames);
      const offlineUserIds = this.collectOfflineUserIds(streams);

      // オフライン時もタイトル/ゲーム変更を検出するためチャンネル情報を取得
      const channels =
        offlineUserIds.length > 0 ? await this.api.getChannels(offlineUserIds) : new Map();

      for (const streamerConfig of this.config.streamers) {
        await this.processStreamer(streamerConfig, streams, channels);
      }
    } catch (error) {
      logger.error("ポーリングエラー", { error });
    }

    this.pollCount++;
    if (this.pollCount % GC_INTERVAL === 0) {
      Bun.gc(false);
    }
    if (this.pollCount % MEMORY_LOG_INTERVAL === 0) {
      this.logMemory();
    }
    this.checkRestart();
  }
}
