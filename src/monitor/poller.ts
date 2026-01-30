import type { Config, StreamerConfig } from "../config/schema";
import type { TwitchAPI } from "../twitch/api";
import type { TwitchChannel, TwitchStream, TwitchUser } from "../twitch/types";
import { logger } from "../utils/logger";
import { type DetectedChange, detectChanges } from "./detector";
import { StateManager, type StreamerState } from "./state";

/**
 * @description 配信者の状態を定期的にポーリングし変更を検出するクラス
 */
export class Poller {
  /**
   * @description ポーリングインターバルのタイマーID
   */
  private intervalId: Timer | null = null;

  /**
   * @description 配信者の状態を管理するインスタンス
   */
  private stateManager = new StateManager();

  /**
   * @description ユーザー情報のキャッシュ
   */
  private userCache = new Map<string, TwitchUser>();

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

    this.intervalId = setInterval(() => this.poll(), this.config.polling.intervalSeconds * 1000);

    logger.info(
      `ポーリング開始 (間隔: ${this.config.polling.intervalSeconds}秒, 配信者: ${this.config.streamers.length}人)`
    );
  }

  /**
   * @description ポーリングを停止
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("ポーリング停止");
    }
  }

  /**
   * @description ユーザー情報をキャッシュに読み込む
   */
  private async initializeUserCache(): Promise<void> {
    const usernames = this.config.streamers.map((s) => s.username);
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
    const titleChange = changes.find((c) => c.type === "titleChange");
    const gameChange = changes.find((c) => c.type === "gameChange");

    if (titleChange && gameChange) {
      const combined: DetectedChange = {
        type: "titleAndGameChange",
        streamer: titleChange.streamer,
        oldTitle: titleChange.oldValue,
        newTitle: titleChange.newValue,
        oldGame: gameChange.oldValue,
        newGame: gameChange.newValue,
        currentState: titleChange.currentState,
      };
      return [
        ...changes.filter((c) => c.type !== "titleChange" && c.type !== "gameChange"),
        combined,
      ];
    }

    return changes;
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
    return {
      userId: user.id,
      username: user.login,
      displayName: user.display_name,
      profileImageUrl: user.profile_image_url,
      isLive: !!stream,
      title: stream?.title ?? channel?.title ?? "",
      gameId: stream?.game_id ?? channel?.game_id ?? "",
      gameName: stream?.game_name ?? channel?.game_name ?? "",
      startedAt: stream?.started_at ?? null,
      thumbnailUrl: stream?.thumbnail_url ?? null,
      viewerCount: stream?.viewer_count ?? 0,
    };
  }

  /**
   * @description 変更が通知設定で有効かどうかを判定
   * @param change - 検出された変更
   * @param config - 配信者の通知設定
   * @returns 通知が有効な場合true
   */
  private isNotificationEnabled(change: DetectedChange, config: StreamerConfig): boolean {
    if (change.type === "titleAndGameChange") {
      return config.notifications.titleChange || config.notifications.gameChange;
    }
    return config.notifications[change.type];
  }

  /**
   * @description 全配信者の状態をポーリングして変更を検出
   */
  private async poll(): Promise<void> {
    try {
      const usernames = this.config.streamers.map((s) => s.username);
      const streams = await this.api.getStreams(usernames);

      const offlineUserIds: string[] = [];
      for (const streamer of this.config.streamers) {
        const user = this.userCache.get(streamer.username.toLowerCase());
        if (user && !streams.has(streamer.username.toLowerCase())) {
          offlineUserIds.push(user.id);
        }
      }

      // オフラインの配信者はチャンネル情報からタイトル/ゲームを取得
      const channels =
        offlineUserIds.length > 0 ? await this.api.getChannels(offlineUserIds) : new Map();

      for (const streamerConfig of this.config.streamers) {
        const username = streamerConfig.username.toLowerCase();
        const user = this.userCache.get(username);
        if (!user) continue;

        const stream = streams.get(username);
        const channel = channels.get(username);
        const newState = this.buildStreamerState(user, stream, channel);

        const oldState = this.stateManager.getState(username);
        const isInitialPoll = !oldState;

        if (isInitialPoll) {
          const status = newState.isLive
            ? `配信中 - ${newState.gameName || "ゲーム未設定"}`
            : "オフライン";
          logger.info(`[${newState.displayName}] 初期状態: ${status}`);
        }

        let changes = detectChanges(oldState, newState);

        // 起動時に既に配信中の場合もonline通知を送る
        if (isInitialPoll && newState.isLive) {
          changes.push({
            type: "online",
            streamer: newState.username,
            currentState: newState,
          });
        }

        changes = this.combineChanges(changes);

        for (const change of changes) {
          if (change.type === "offline") {
            const vod = await this.api.getLatestVod(user.id);
            if (vod) {
              change.vodUrl = vod.url;
              change.vodThumbnailUrl = vod.thumbnail_url
                .replace("%{width}", "440")
                .replace("%{height}", "248");
            }
          }
        }

        const filteredChanges = changes.filter((c) =>
          this.isNotificationEnabled(c, streamerConfig)
        );

        if (filteredChanges.length > 0) {
          await this.onChanges(filteredChanges, streamerConfig);
        }

        this.stateManager.updateState(username, newState);
      }
    } catch (error) {
      logger.error("ポーリングエラー:", error);
    }
  }
}
