import { runCli } from "./cli";
import { loadConfig } from "./config/loader";
import { isNotificationEnabled } from "./config/schema";
import { buildEmbed } from "./discord/embed";
import { sendWebhook } from "./discord/webhook";
import { Poller } from "./monitor/poller";
import { TwitchAPI } from "./twitch/api";
import { TwitchAuth } from "./twitch/auth";
import { createLogger, setLogLevel } from "./utils/logger";

/**
 * @description メインモジュールのロガー
 */
const logger = createLogger("main");

/**
 * @description ワーカープロセス判別用の環境変数名
 */
const WORKER_ENV_KEY = "STREAM_NOTIFIER_WORKER";

/**
 * @description 監視を開始する
 */
async function startMonitor(): Promise<void> {
  process.title = "Stream Notifier";
  logger.info("Stream Notifier 起動中...");

  const config = await loadConfig();
  setLogLevel(config.log.level);

  const auth = new TwitchAuth(config.twitch.clientId, config.twitch.clientSecret);
  const api = new TwitchAPI(auth, config.twitch.clientId);

  const poller = new Poller(api, config, async (changes, streamerConfig) => {
    for (const change of changes) {
      const embed = buildEmbed(change);
      const streamerInfo = {
        displayName: change.currentState.displayName,
        profileImageUrl: change.currentState.profileImageUrl,
      };

      for (const webhook of streamerConfig.webhooks) {
        if (isNotificationEnabled(change.type, webhook.notifications)) {
          const webhookLabel = webhook.name ?? "Webhook";
          logger.info(
            `[${change.currentState.displayName}] ${change.type} → ${webhookLabel}` +
              (change.newValue ? ` (${change.newValue})` : "")
          );
          await sendWebhook(webhook.url, embed, streamerInfo);
        }
      }
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
 * @description ワーカーをspawnし、exit(0)時に自動再起動するスーパーバイザー
 */
async function runSupervisor(): Promise<void> {
  logger.info("スーパーバイザー起動");

  const spawnWorker = (): void => {
    const worker = Bun.spawn([process.execPath, ...process.argv.slice(1)], {
      env: { ...process.env, [WORKER_ENV_KEY]: "1" },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
      onExit: (_proc, exitCode) => {
        if (exitCode === 0) {
          logger.info("ワーカー終了(exit 0) - 再起動します");
          spawnWorker();
          return;
        }
        logger.error(`ワーカー異常終了(exit ${exitCode})`);
        process.exit(exitCode ?? 1);
      },
    });

    // スーパーバイザーへのシグナルをワーカーに転送
    const forwardSignal = () => {
      worker.kill();
    };
    process.on("SIGINT", forwardSignal);
    process.on("SIGTERM", forwardSignal);
  };

  spawnWorker();
}

/**
 * @description 統合エントリーポイント
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // 引数なし or "run" → 監視開始
  if (args.length === 0 || args[0] === "run") {
    if (process.env[WORKER_ENV_KEY]) {
      await startMonitor();
    } else {
      await runSupervisor();
    }
    return;
  }

  // その他 → CLI
  await runCli(args);
}

main().catch((error) => {
  logger.error("致命的なエラー", { error });
  process.exit(1);
});
