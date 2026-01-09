import { logger } from "../utils/logger";
import type { TwitchTokenResponse } from "./types";

export class TwitchAuth {
  private accessToken: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  async getToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.expiresAt - 60000) {
      return this.accessToken;
    }
    return this.refreshToken();
  }

  private async refreshToken(): Promise<string> {
    logger.debug("Twitchアクセストークンを取得中...");

    const response = await fetch("https://id.twitch.tv/oauth2/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Twitch認証失敗: ${response.status} ${error}`);
    }

    const data = (await response.json()) as TwitchTokenResponse;
    this.accessToken = data.access_token;
    this.expiresAt = Date.now() + data.expires_in * 1000;

    logger.debug("Twitchアクセストークン取得完了");
    return this.accessToken;
  }
}
