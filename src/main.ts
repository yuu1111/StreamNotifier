import { runCli } from "./cli";
import { loadConfig } from "./config/loader";
import { buildEmbed } from "./discord/embed";
import { sendToMultipleWebhooks } from "./discord/webhook";
import { Poller } from "./monitor/poller";
import { TwitchAPI } from "./twitch/api";
import { TwitchAuth } from "./twitch/auth";
import { logger } from "./utils/logger";

/**
 * @description 監視を開始する
 */
async function startMonitor(): Promise<void> {
  process.title = "Stream Notifier";
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
      await sendToMultipleWebhooks(streamerConfig.webhooks, embed, {
        displayName: change.currentState.displayName,
        profileImageUrl: change.currentState.profileImageUrl,
      });
    }
  });

  await poller.start();

  /**
   * @description シャットダウン処理を実行
   */
  const shutdown = (): void => {
    logger.info("シャットダウン中...");
    poller.stop();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

/**
 * @description 統合エントリーポイント
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 引数なし or "run" → 監視開始
  if (args.length === 0 || args[0] === "run") {
    await startMonitor();
    return;
  }

  // その他 → CLI
  await runCli(args);
}

main().catch((error) => {
  logger.error("致命的なエラー:", error);
  process.exit(1);
});
