import { createLogger } from "../utils/logger";
import type { TwitchAuth } from "./auth";
import type {
  TwitchApiResponse,
  TwitchChannel,
  TwitchStream,
  TwitchUser,
  TwitchVideo,
} from "./types";

/**
 * @description Twitch APIモジュールのロガー
 */
const logger = createLogger("twitch:api");

/**
 * @description Twitch Helix APIクライアント
 */
export class TwitchAPI {
  /**
   * @description Twitch Helix APIのベースURL
   */
  private readonly baseUrl = "https://api.twitch.tv/helix";

  /**
   * @description TwitchAPIインスタンスを作成
   * @param auth - 認証インスタンス
   * @param clientId - Twitch Client ID
   */
  constructor(
    private auth: TwitchAuth,
    private clientId: string
  ) {}

  /**
   * @description APIリクエストを実行
   * @param endpoint - APIエンドポイント
   * @param params - クエリパラメータ
   * @returns レスポンスデータの配列
   * @throws APIエラー時
   */
  private async request<T>(endpoint: string, params: URLSearchParams): Promise<T[]> {
    const token = await this.auth.getToken();
    const url = `${this.baseUrl}${endpoint}?${params}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
        // Bunのzlib(inflate)にメモリリークがあるためgzip解凍を回避
        "Accept-Encoding": "identity",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twitch API エラー: ${response.status} ${error}`);
    }

    const data = (await response.json()) as TwitchApiResponse<T>;
    return data.data;
  }

  /**
   * @description ユーザー情報を取得
   * @param logins - ユーザーログイン名の配列
   * @returns ログイン名をキーとするユーザー情報Map
   */
  async getUsers(logins: string[]): Promise<Map<string, TwitchUser>> {
    if (logins.length === 0) return new Map();

    const params = new URLSearchParams();
    for (const login of logins) {
      params.append("login", login);
    }

    const users = await this.request<TwitchUser>("/users", params);
    const result = new Map<string, TwitchUser>();

    for (const user of users) {
      result.set(user.login.toLowerCase(), user);
    }

    logger.debug(`ユーザー情報取得: ${users.length}件`);
    return result;
  }

  /**
   * @description 配信中のストリーム情報を取得
   * @param userLogins - ユーザーログイン名の配列
   * @returns ログイン名をキーとする配信情報Map(配信中のみ含む)
   */
  async getStreams(userLogins: string[]): Promise<Map<string, TwitchStream>> {
    if (userLogins.length === 0) return new Map();

    const params = new URLSearchParams();
    for (const login of userLogins) {
      params.append("user_login", login);
    }

    const streams = await this.request<TwitchStream>("/streams", params);
    const result = new Map<string, TwitchStream>();

    for (const stream of streams) {
      result.set(stream.user_login.toLowerCase(), stream);
    }

    logger.debug(`配信中: ${streams.length}件`);
    return result;
  }

  /**
   * @description チャンネル情報を取得
   * @param broadcasterIds - 配信者IDの配列
   * @returns ログイン名をキーとするチャンネル情報Map
   */
  async getChannels(broadcasterIds: string[]): Promise<Map<string, TwitchChannel>> {
    if (broadcasterIds.length === 0) return new Map();

    const params = new URLSearchParams();
    for (const id of broadcasterIds) {
      params.append("broadcaster_id", id);
    }

    const channels = await this.request<TwitchChannel>("/channels", params);
    const result = new Map<string, TwitchChannel>();

    for (const channel of channels) {
      result.set(channel.broadcaster_login.toLowerCase(), channel);
    }

    logger.debug(`チャンネル情報取得: ${channels.length}件`);
    return result;
  }

  /**
   * @description 最新のアーカイブVODを取得
   * @param userId - ユーザーID
   * @returns VOD情報(存在しない場合null)
   */
  async getLatestVod(userId: string): Promise<TwitchVideo | null> {
    const params = new URLSearchParams();
    params.append("user_id", userId);
    params.append("type", "archive");
    params.append("first", "1");

    const videos = await this.request<TwitchVideo>("/videos", params);
    return videos[0] ?? null;
  }
}
