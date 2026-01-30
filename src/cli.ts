import * as path from "node:path";
import * as readline from "node:readline";
import type { Config, StreamerConfig } from "./config/schema";

/**
 * @description 実行ファイル名を取得
 */
function getExeName(): string {
  return path.basename(process.argv[1] ?? "stream-notifier");
}

/**
 * @description 設定ファイルのパス
 */
const CONFIG_PATH = "./config.json";

/**
 * @description 標準入出力のreadlineインターフェース (遅延初期化)
 */
let rl: readline.Interface | null = null;

/**
 * @description readlineインターフェースを取得 (必要時に初期化)
 */
function getReadline(): readline.Interface {
  if (!rl) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
  }
  return rl;
}

/**
 * @description 設定ファイルを読み込む
 * @returns 設定オブジェクト
 * @throws 設定ファイルが存在しない場合
 */
async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_PATH);
  if (!(await file.exists())) {
    throw new Error("config.json が見つかりません");
  }
  return file.json();
}

/**
 * @description 設定ファイルに書き込む
 * @param config - 保存する設定オブジェクト
 */
async function saveConfig(config: Config): Promise<void> {
  await Bun.write(CONFIG_PATH, JSON.stringify(config, null, 2));
}

/**
 * @description CLIの使い方を表示
 */
function printUsage(): void {
  const exe = getExeName();
  console.log(`
使い方:
  ${exe}                           監視を開始
  ${exe} add <username>            配信者を追加
  ${exe} remove <username>         配信者を削除
  ${exe} list                      配信者一覧を表示
  ${exe} webhook add <username>    Webhookを追加
  ${exe} webhook remove <username> Webhookを削除
  ${exe} help                      このヘルプを表示
`);
}

/**
 * @description ユーザー入力を取得
 * @param message - 表示するプロンプト
 * @returns 入力された文字列
 */
function promptInput(message: string): Promise<string> {
  return new Promise((resolve) => {
    getReadline().question(message, (answer: string) => {
      resolve(answer.trim());
    });
  });
}

/**
 * @description Webhook URLの形式を検証
 * @param url - 検証するURL
 * @returns 有効な形式の場合true
 */
function validateWebhookUrl(url: string): boolean {
  return url.startsWith("https://discord.com/api/webhooks/");
}

/**
 * @description 配信者をユーザー名で検索
 * @param streamers - 配信者設定の配列
 * @param username - 検索するユーザー名
 * @returns 見つかった配信者、または undefined
 */
function findStreamer(streamers: StreamerConfig[], username: string): StreamerConfig | undefined {
  return streamers.find((s) => s.username.toLowerCase() === username.toLowerCase());
}

/**
 * @description 配信者のインデックスをユーザー名で検索
 * @param streamers - 配信者設定の配列
 * @param username - 検索するユーザー名
 * @returns 見つかったインデックス、または -1
 */
function findStreamerIndex(streamers: StreamerConfig[], username: string): number {
  return streamers.findIndex((s) => s.username.toLowerCase() === username.toLowerCase());
}

/**
 * @description 配信者を追加
 * @param username - Twitchユーザー名
 */
async function addStreamer(username: string): Promise<void> {
  const config = await loadConfig();

  if (findStreamer(config.streamers, username)) {
    console.error(`エラー: ${username} は既に登録されています`);
    process.exit(1);
  }

  const webhookUrl = await promptInput("Webhook URL: ");
  if (!validateWebhookUrl(webhookUrl)) {
    console.error("エラー: 無効なWebhook URLです");
    process.exit(1);
  }

  const newStreamer: StreamerConfig = {
    username,
    notifications: {
      online: true,
      offline: true,
      titleChange: true,
      gameChange: true,
    },
    webhooks: [webhookUrl],
  };

  config.streamers.push(newStreamer);
  await saveConfig(config);
  console.log(`${username} を追加しました`);
}

/**
 * @description 配信者を削除
 * @param username - Twitchユーザー名
 */
async function removeStreamer(username: string): Promise<void> {
  const config = await loadConfig();

  const index = findStreamerIndex(config.streamers, username);
  if (index === -1) {
    console.error(`エラー: ${username} は登録されていません`);
    process.exit(1);
  }

  config.streamers.splice(index, 1);
  await saveConfig(config);
  console.log(`${username} を削除しました`);
}

/**
 * @description 登録済み配信者一覧を表示
 */
async function listStreamers(): Promise<void> {
  const config = await loadConfig();

  if (config.streamers.length === 0) {
    console.log("登録されている配信者はいません");
    return;
  }

  console.log("登録済み配信者:");
  for (const streamer of config.streamers) {
    console.log(`  - ${streamer.username} (Webhook: ${streamer.webhooks.length}件)`);
  }
}

/**
 * @description 配信者にWebhookを追加
 * @param username - Twitchユーザー名
 */
async function addWebhook(username: string): Promise<void> {
  const config = await loadConfig();

  const streamer = findStreamer(config.streamers, username);
  if (!streamer) {
    console.error(`エラー: ${username} は登録されていません`);
    process.exit(1);
  }

  const webhookUrl = await promptInput("Webhook URL: ");
  if (!validateWebhookUrl(webhookUrl)) {
    console.error("エラー: 無効なWebhook URLです");
    process.exit(1);
  }

  if (streamer.webhooks.includes(webhookUrl)) {
    console.error("エラー: このWebhookは既に登録されています");
    process.exit(1);
  }

  streamer.webhooks.push(webhookUrl);
  await saveConfig(config);
  console.log(`${username} にWebhookを追加しました (合計: ${streamer.webhooks.length}件)`);
}

/**
 * @description 配信者からWebhookを削除
 * @param username - Twitchユーザー名
 */
async function removeWebhook(username: string): Promise<void> {
  const config = await loadConfig();

  const streamer = findStreamer(config.streamers, username);
  if (!streamer) {
    console.error(`エラー: ${username} は登録されていません`);
    process.exit(1);
  }

  if (streamer.webhooks.length === 0) {
    console.error("エラー: Webhookが登録されていません");
    process.exit(1);
  }

  console.log("登録済みWebhook:");
  streamer.webhooks.forEach((url, i) => {
    console.log(`  ${i + 1}. ${url.slice(0, 60)}...`);
  });

  const input = await promptInput("削除する番号: ");
  const index = parseInt(input, 10) - 1;

  if (Number.isNaN(index) || index < 0 || index >= streamer.webhooks.length) {
    console.error("エラー: 無効な番号です");
    process.exit(1);
  }

  streamer.webhooks.splice(index, 1);
  await saveConfig(config);
  console.log(`Webhookを削除しました (残り: ${streamer.webhooks.length}件)`);
}

/**
 * @description 対話モードでCLIを実行
 */
async function interactiveMode(): Promise<void> {
  console.log("Stream Notifier CLI\n");
  console.log("1. 配信者を追加");
  console.log("2. 配信者を削除");
  console.log("3. 配信者一覧を表示");
  console.log("4. Webhookを追加");
  console.log("5. Webhookを削除");
  console.log("0. 終了\n");

  const choice = await promptInput("選択: ");

  switch (choice) {
    case "1": {
      const username = await promptInput("ユーザー名: ");
      if (!username) {
        console.error("エラー: ユーザー名を入力してください");
        process.exit(1);
      }
      await addStreamer(username);
      break;
    }
    case "2": {
      const username = await promptInput("ユーザー名: ");
      if (!username) {
        console.error("エラー: ユーザー名を入力してください");
        process.exit(1);
      }
      await removeStreamer(username);
      break;
    }
    case "3":
      await listStreamers();
      break;
    case "4": {
      const username = await promptInput("ユーザー名: ");
      if (!username) {
        console.error("エラー: ユーザー名を入力してください");
        process.exit(1);
      }
      await addWebhook(username);
      break;
    }
    case "5": {
      const username = await promptInput("ユーザー名: ");
      if (!username) {
        console.error("エラー: ユーザー名を入力してください");
        process.exit(1);
      }
      await removeWebhook(username);
      break;
    }
    case "0":
      console.log("終了します");
      break;
    default:
      console.error("無効な選択です");
      process.exit(1);
  }
}

/**
 * @description CLIを実行する
 * @param args - コマンドライン引数
 */
export async function runCli(args: string[]): Promise<void> {
  try {
    if (args.length === 0) {
      await interactiveMode();
      return;
    }

    const command = args[0];

    switch (command) {
      case "add":
        if (!args[1]) {
          console.error("エラー: ユーザー名を指定してください");
          process.exit(1);
        }
        await addStreamer(args[1]);
        break;

      case "remove":
        if (!args[1]) {
          console.error("エラー: ユーザー名を指定してください");
          process.exit(1);
        }
        await removeStreamer(args[1]);
        break;

      case "list":
        await listStreamers();
        break;

      case "webhook":
        if (args[1] === "add") {
          if (!args[2]) {
            console.error("エラー: ユーザー名を指定してください");
            process.exit(1);
          }
          await addWebhook(args[2]);
        } else if (args[1] === "remove") {
          if (!args[2]) {
            console.error("エラー: ユーザー名を指定してください");
            process.exit(1);
          }
          await removeWebhook(args[2]);
        } else {
          console.error("エラー: webhook add または webhook remove を指定してください");
          process.exit(1);
        }
        break;

      case "help":
      case "--help":
      case "-h":
        printUsage();
        break;

      default:
        console.error(`不明なコマンド: ${command}`);
        printUsage();
        process.exit(1);
    }
  } finally {
    rl?.close();
  }
}
