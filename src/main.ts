import { loadConfig } from "./config/loader";
import { buildEmbed } from "./discord/embed";
import { sendToMultipleWebhooks } from "./discord/webhook";
import { Poller } from "./monitor/poller";
import { TwitchAPI } from "./twitch/api";
import { TwitchAuth } from "./twitch/auth";
import { logger } from "./utils/logger";

async function main() {
  logger.info("Stream Notifier 起動中...");

  const config = await loadConfig();
  logger.setLevel(config.log.level);

  const auth = new TwitchAuth(config.twitch.clientId, config.twitch.clientSecret);
  const api = new TwitchAPI(auth, config.twitch.clientId);

  const poller = new Poller(api, config, async (changes, streamerConfig) => {
    for (const change of changes) {
      logger.info(
        `[${change.currentState.displayName}] ${change.type}` +
          (change.newValue ? `: ${change.newValue}` : "")
      );

      const embed = buildEmbed(change);
      await sendToMultipleWebhooks(streamerConfig.webhooks, embed);
    }
  });

  await poller.start();

  process.on("SIGINT", () => {
    logger.info("シャットダウン中...");
    poller.stop();
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    logger.info("シャットダウン中...");
    poller.stop();
    process.exit(0);
  });
}

main().catch((error) => {
  logger.error("致命的なエラー:", error);
  process.exit(1);
});
