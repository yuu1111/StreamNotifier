import * as z from "zod";

/**
 * @description 通知タイプの定数
 */
export const ChangeTypes = {
  Online: "online",
  Offline: "offline",
  TitleChange: "titleChange",
  GameChange: "gameChange",
  TitleAndGameChange: "titleAndGameChange",
} as const;

/**
 * @description ログレベルの定数
 */
export const LogLevels = {
  Debug: "debug",
  Info: "info",
  Warn: "warn",
  Error: "error",
} as const;

/**
 * @description サムネイル画像のサイズ
 */
export const ThumbnailSize = {
  Width: "440",
  Height: "248",
} as const;

/**
 * @description Discord Webhook URLのプレフィックス
 */
export const WEBHOOK_URL_PREFIX = "https://discord.com/api/webhooks/";

/**
 * @description Discord Webhook URLのバリデーションスキーマ
 */
const WebhookUrlSchema = z
  .string()
  .startsWith(WEBHOOK_URL_PREFIX, "Discord Webhook URLの形式が無効です");

/**
 * @description 通知種別ごとの有効/無効設定スキーマ
 */
const NotificationSettingsSchema = z.object({
  [ChangeTypes.Online]: z.boolean(),
  [ChangeTypes.Offline]: z.boolean(),
  [ChangeTypes.TitleChange]: z.boolean(),
  [ChangeTypes.GameChange]: z.boolean(),
});

/**
 * @description Webhook設定スキーマ (URLと通知設定)
 */
const WebhookConfigSchema = z.object({
  url: WebhookUrlSchema,
  notifications: NotificationSettingsSchema,
});

/**
 * @description 配信者ごとの設定スキーマ
 */
const StreamerConfigSchema = z.object({
  username: z.string().min(1, "usernameは必須です"),
  webhooks: z.array(WebhookConfigSchema).min(1, "webhooksに1つ以上の設定が必要です"),
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
    level: z.enum([LogLevels.Debug, LogLevels.Info, LogLevels.Warn, LogLevels.Error]),
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
 * @description Webhook設定 (URLと通知設定)
 */
export type WebhookConfig = z.infer<typeof WebhookConfigSchema>;

/**
 * @description 通知種別ごとの有効/無効設定
 */
export type NotificationSettings = z.infer<typeof NotificationSettingsSchema>;

/**
 * @description ログ出力レベル
 */
export type LogLevel = (typeof LogLevels)[keyof typeof LogLevels];

/**
 * @description 変更イベントの種別
 */
export type ChangeType = (typeof ChangeTypes)[keyof typeof ChangeTypes];

/**
 * @description 変更が通知設定で有効かどうかを判定
 */
export function isNotificationEnabled(
  changeType: ChangeType,
  notifications: NotificationSettings
): boolean {
  if (changeType === ChangeTypes.TitleAndGameChange) {
    return notifications[ChangeTypes.TitleChange] || notifications[ChangeTypes.GameChange];
  }
  return notifications[changeType];
}
