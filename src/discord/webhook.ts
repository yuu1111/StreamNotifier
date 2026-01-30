import { logger } from "../utils/logger";
import type { DiscordEmbed } from "./embed";

/**
 * @description Discord Webhookのペイロード
 * @property embeds - 送信するEmbedの配列
 * @property username - Webhook表示名 @optional
 * @property avatar_url - Webhookアバター画像URL @optional
 */
export interface WebhookPayload {
  embeds: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

/**
 * @description 配信者情報(Webhook表示用)
 * @property displayName - 表示名
 * @property profileImageUrl - プロフィール画像URL
 */
export interface StreamerInfo {
  displayName: string;
  profileImageUrl: string;
}

/**
 * @description 単一のWebhookにEmbedを送信
 * @param webhookUrl - Discord Webhook URL
 * @param embed - 送信するEmbed
 * @param streamer - 配信者情報
 * @throws 送信失敗時にエラー
 */
export async function sendWebhook(
  webhookUrl: string,
  embed: DiscordEmbed,
  streamer: StreamerInfo
): Promise<void> {
  const payload: WebhookPayload = {
    embeds: [embed],
    username: streamer.displayName,
    avatar_url: streamer.profileImageUrl,
  };

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Webhook送信失敗: ${response.status} ${error}`);
  }

  logger.debug(`Webhook送信成功: ${webhookUrl.slice(0, 50)}...`);
}

/**
 * @description 複数のWebhookにEmbedを並列送信
 * @param webhookUrls - Discord Webhook URLの配列
 * @param embed - 送信するEmbed
 * @param streamer - 配信者情報
 */
export async function sendToMultipleWebhooks(
  webhookUrls: string[],
  embed: DiscordEmbed,
  streamer: StreamerInfo
): Promise<void> {
  const results = await Promise.allSettled(
    webhookUrls.map((url) => sendWebhook(url, embed, streamer))
  );

  for (const [index, result] of results.entries()) {
    if (result.status === "rejected") {
      logger.error(`Webhook送信エラー [${index + 1}/${webhookUrls.length}]:`, result.reason);
    }
  }
}
