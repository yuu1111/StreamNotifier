import { logger } from "../utils/logger";
import type { DiscordEmbed } from "./embed";

export interface WebhookPayload {
  embeds: DiscordEmbed[];
  username?: string;
  avatar_url?: string;
}

export async function sendWebhook(webhookUrl: string, embed: DiscordEmbed): Promise<void> {
  const payload: WebhookPayload = {
    embeds: [embed],
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

export async function sendToMultipleWebhooks(
  webhookUrls: string[],
  embed: DiscordEmbed
): Promise<void> {
  const results = await Promise.allSettled(webhookUrls.map((url) => sendWebhook(url, embed)));

  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result && result.status === "rejected") {
      logger.error(`Webhook送信エラー [${i + 1}/${webhookUrls.length}]:`, result.reason);
    }
  }
}
