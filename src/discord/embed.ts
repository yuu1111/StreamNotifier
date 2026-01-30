import type { ChangeType } from "../config/schema";
import type { DetectedChange } from "../monitor/detector";

/**
 * @description タイトル/ゲーム変更イベントの種別一覧
 */
const CHANGE_EVENT_TYPES: ReadonlySet<ChangeType> = new Set([
  "titleChange",
  "gameChange",
  "titleAndGameChange",
]);

/**
 * @description Discord Embed構造
 * @property title - Embedのタイトル
 * @property description - Embedの説明 @optional
 * @property url - クリック時に開くURL @optional
 * @property color - 左側の縦線の色(10進数)
 * @property thumbnail - サムネイル画像 @optional
 * @property image - メイン画像 @optional
 * @property fields - フィールドの配列 @optional
 * @property timestamp - タイムスタンプ(ISO 8601) @optional
 * @property footer - フッター情報 @optional
 * @property author - 作成者情報 @optional
 */
export interface DiscordEmbed {
  title: string;
  description?: string;
  url?: string;
  color: number;
  thumbnail?: { url: string };
  image?: { url: string };
  fields?: { name: string; value: string; inline?: boolean }[];
  timestamp?: string;
  footer?: { text: string };
  author?: { name: string; icon_url?: string };
}

/**
 * @description 変更種別ごとのEmbed色(10進数)
 */
const COLORS: Record<ChangeType, number> = {
  online: 0x9146ff,
  offline: 0x808080,
  titleChange: 0x00ff00,
  gameChange: 0xff9900,
  titleAndGameChange: 0x00ccff,
};

/**
 * @description 変更種別ごとのEmbedタイトル
 */
const TITLES: Record<ChangeType, string> = {
  online: "配信開始",
  offline: "配信終了",
  titleChange: "タイトル変更",
  gameChange: "ゲーム変更",
  titleAndGameChange: "タイトル・ゲーム変更",
};

/**
 * @description 配信開始からの経過時間を日本語でフォーマット
 * @param startedAt - 配信開始日時(ISO 8601)
 * @returns フォーマット済み文字列(無効な場合null)
 */
function formatElapsedTime(startedAt: string | null): string | null {
  if (!startedAt) return null;

  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;

  if (diffMs < 0) return null;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "たった今";

  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours === 0) return `${mins}分前から配信中`;
  return `${hours}時間${mins}分前から配信中`;
}

/**
 * @description 配信時間を日本語でフォーマット
 * @param startedAt - 配信開始日時(ISO 8601)
 * @returns フォーマット済み文字列
 */
function formatDuration(startedAt: string): string {
  const start = new Date(startedAt).getTime();
  const now = Date.now();
  const diffMs = now - start;

  const totalMinutes = Math.floor(diffMs / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;

  if (hours === 0) return `${mins}分`;
  return `${hours}時間${mins}分`;
}

/**
 * @description 変更情報からDiscord Embedを構築
 * @param change - 検出された変更
 * @returns Discord Embed
 */
export function buildEmbed(change: DetectedChange): DiscordEmbed {
  const { type, currentState } = change;
  const channelUrl = `https://twitch.tv/${currentState.username}`;

  const embed: DiscordEmbed = {
    title: TITLES[type],
    url: channelUrl,
    color: COLORS[type],
    author: {
      name: currentState.displayName,
      icon_url: currentState.profileImageUrl,
    },
    timestamp: new Date().toISOString(),
  };

  switch (type) {
    case "online": {
      embed.description = currentState.title || "(タイトルなし)";
      const fields: { name: string; value: string; inline?: boolean }[] = [
        {
          name: "ゲーム",
          value: currentState.gameName || "(未設定)",
          inline: true,
        },
      ];

      if (currentState.startedAt) {
        const startTime = new Date(currentState.startedAt);
        fields.push({
          name: "開始時刻",
          value: startTime.toLocaleTimeString("ja-JP", { hour: "2-digit", minute: "2-digit" }),
          inline: true,
        });

        const elapsed = formatElapsedTime(currentState.startedAt);
        if (elapsed && !elapsed.includes("たった今")) {
          embed.footer = { text: elapsed };
        }
      }

      embed.fields = fields;
      if (currentState.thumbnailUrl) {
        const thumbnailUrl = currentState.thumbnailUrl
          .replace("{width}", "440")
          .replace("{height}", "248");
        embed.image = { url: thumbnailUrl };
      }
      break;
    }

    case "offline": {
      const endTime = new Date().toLocaleTimeString("ja-JP", {
        hour: "2-digit",
        minute: "2-digit",
      });
      const fields: { name: string; value: string; inline?: boolean }[] = [];

      if (change.streamStartedAt) {
        const startTime = new Date(change.streamStartedAt).toLocaleTimeString("ja-JP", {
          hour: "2-digit",
          minute: "2-digit",
        });
        const duration = formatDuration(change.streamStartedAt);
        fields.push({
          name: "配信時間",
          value: `${startTime} → ${endTime} (${duration})`,
          inline: false,
        });
      } else {
        fields.push({ name: "終了時刻", value: endTime, inline: true });
      }

      if (change.vodUrl) {
        fields.push({
          name: "VOD",
          value: `[この配信を見る](${change.vodUrl})`,
          inline: false,
        });
      }

      embed.description = "配信が終了しました";
      embed.fields = fields;

      if (change.vodThumbnailUrl) {
        embed.image = { url: change.vodThumbnailUrl };
      }
      break;
    }

    case "titleChange":
      embed.fields = [
        { name: "変更前", value: change.oldValue || "(なし)", inline: false },
        { name: "変更後", value: change.newValue || "(なし)", inline: false },
      ];
      break;

    case "gameChange":
      embed.fields = [
        { name: "変更前", value: change.oldValue || "(未設定)", inline: true },
        { name: "変更後", value: change.newValue || "(未設定)", inline: true },
      ];
      break;

    case "titleAndGameChange":
      embed.fields = [
        {
          name: "タイトル",
          value: `${change.oldTitle || "(なし)"}\n→ ${change.newTitle || "(なし)"}`,
          inline: false,
        },
        {
          name: "ゲーム",
          value: `${change.oldGame || "(未設定)"}\n→ ${change.newGame || "(未設定)"}`,
          inline: false,
        },
      ];
      break;
  }

  // タイトル/ゲーム変更時は配信中であればfooterを設定
  if (CHANGE_EVENT_TYPES.has(type) && currentState.isLive && !embed.footer) {
    embed.footer = { text: "配信中" };
  }

  return embed;
}
