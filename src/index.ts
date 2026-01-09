import { runCli } from "./cli";
import { startMonitor } from "./main";
import { logger } from "./utils/logger";

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
