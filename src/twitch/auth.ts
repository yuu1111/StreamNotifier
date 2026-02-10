import { logger } from "../utils/logger";
import type { TwitchTokenResponse } from "./types";

/**
 * @description Twitch Client Credentials認証を管理するクラス
 * @property accessToken - 現在のアクセストークン
 * @property expiresAt - トークンの有効期限(Unix timestamp)
 */
export class TwitchAuth {
  private accessToken: string | null = null;
  private expiresAt: number = 0;

  /**
   * @description TwitchAuthインスタンスを作成
   * @param clientId - Twitch Developer ConsoleのClient ID
   * @param clientSecret - Twitch Developer ConsoleのClient Secret
   */
  constructor(
    private clientId: string,
    private clientSecret: string
  ) {}

  /**
   * @description 有効なアクセストークンを取得(期限切れ間近なら自動更新)
   * @returns アクセストークン
   */
  async getToken(): Promise<string> {
    // 期限切れ1分前に更新することでAPI呼び出し中の失効を防ぐ
    if (this.accessToken && Date.now() < this.expiresAt - 60000) {
      return this.accessToken;
    }
    return this.refreshToken();
  }

  /**
   * @description Client Credentials Flowでトークンを新規取得
   * @returns 新しいアクセストークン
   * @throws 認証失敗時にエラー
   */
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
      signal: AbortSignal.timeout(15_000),
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
