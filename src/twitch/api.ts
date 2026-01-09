import { logger } from "../utils/logger";
import type { TwitchAuth } from "./auth";
import type { TwitchApiResponse, TwitchChannel, TwitchStream, TwitchUser } from "./types";

export class TwitchAPI {
  private readonly baseUrl = "https://api.twitch.tv/helix";

  constructor(
    private auth: TwitchAuth,
    private clientId: string
  ) {}

  private async request<T>(endpoint: string, params: URLSearchParams): Promise<T[]> {
    const token = await this.auth.getToken();
    const url = `${this.baseUrl}${endpoint}?${params}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Client-Id": this.clientId,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twitch API エラー: ${response.status} ${error}`);
    }

    const data = (await response.json()) as TwitchApiResponse<T>;
    return data.data;
  }

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
}
