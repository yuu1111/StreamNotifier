import type { ChangeType } from "../config/schema";
import type { DetectedChange } from "../monitor/detector";

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

const COLORS: Record<ChangeType, number> = {
  online: 0x9146ff,
  offline: 0x808080,
  titleChange: 0x00ff00,
  gameChange: 0xff9900,
};

const TITLES: Record<ChangeType, string> = {
  online: "配信開始",
  offline: "配信終了",
  titleChange: "タイトル変更",
  gameChange: "ゲーム変更",
};

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
    case "online":
      embed.description = currentState.title || "(タイトルなし)";
      embed.fields = [
        {
          name: "ゲーム",
          value: currentState.gameName || "(未設定)",
          inline: true,
        },
      ];
      if (currentState.thumbnailUrl) {
        const thumbnailUrl = currentState.thumbnailUrl
          .replace("{width}", "440")
          .replace("{height}", "248");
        embed.image = { url: thumbnailUrl };
      }
      break;

    case "offline":
      embed.description = "配信が終了しました";
      break;

    case "titleChange":
      embed.fields = [
        { name: "変更前", value: change.oldValue || "(なし)", inline: false },
        { name: "変更後", value: change.newValue || "(なし)", inline: false },
      ];
      if (currentState.isLive) {
        embed.footer = { text: "配信中" };
      }
      break;

    case "gameChange":
      embed.fields = [
        { name: "変更前", value: change.oldValue || "(未設定)", inline: true },
        { name: "変更後", value: change.newValue || "(未設定)", inline: true },
      ];
      if (currentState.isLive) {
        embed.footer = { text: "配信中" };
      }
      break;
  }

  return embed;
}
