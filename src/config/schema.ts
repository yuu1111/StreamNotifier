import { z } from "zod";

/**
 * @description Discord Webhook URLのバリデーションスキーマ
 */
const WebhookUrlSchema = z
  .string()
  .startsWith("https://discord.com/api/webhooks/", "Discord Webhook URLの形式が無効です");

/**
 * @description 通知種別ごとの有効/無効設定スキーマ
 */
const NotificationSettingsSchema = z.object({
  online: z.boolean(),
  offline: z.boolean(),
  titleChange: z.boolean(),
  gameChange: z.boolean(),
});

/**
 * @description 配信者ごとの設定スキーマ
 */
const StreamerConfigSchema = z.object({
  username: z.string().min(1, "usernameは必須です"),
  notifications: NotificationSettingsSchema,
  webhooks: z.array(WebhookUrlSchema).min(1, "webhooksに1つ以上のURLを設定してください"),
});

/**
 * @description アプリケーション全体の設定スキーマ
 */
export const ConfigSchema = z.object({
  twitch: z.object({
    clientId: z.string().min(1, "twitch.clientIdは必須です"),
    clientSecret: z.string().min(1, "twitch.clientSecretは必須です"),
  }),
  polling: z.object({
    intervalSeconds: z.number().min(10, "polling.intervalSecondsは10以上で設定してください"),
  }),
  streamers: z.array(StreamerConfigSchema).min(1, "streamersに1人以上の配信者を設定してください"),
  log: z.object({
    level: z.enum(["debug", "info", "warn", "error"]),
  }),
});

/**
 * @description アプリケーション全体の設定
 */
export type Config = z.infer<typeof ConfigSchema>;

/**
 * @description 配信者ごとの設定
 */
export type StreamerConfig = z.infer<typeof StreamerConfigSchema>;

/**
 * @description 通知種別ごとの有効/無効設定
 */
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

/**
 * @description ログ出力レベル
 */
export type LogLevel = "debug" | "info" | "warn" | "error";

/**
 * @description 変更イベントの種別
 */
export type ChangeType = keyof NotificationSettings | "titleAndGameChange";
