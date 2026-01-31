import * as path from "node:path";
import * as readline from "node:readline";
import {
  ChangeTypes,
  type Config,
  type NotificationSettings,
  type StreamerConfig,
  WEBHOOK_URL_PREFIX,
  type WebhookConfig,
} from "./config/schema";

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
  ${exe}                            監視を開始
  ${exe} add <username>             配信者を追加
  ${exe} remove <username>          配信者を削除
  ${exe} list                       配信者一覧を表示
  ${exe} webhook add <username>     Webhookを追加
  ${exe} webhook remove <username>  Webhookを削除
  ${exe} webhook config <username>  Webhook通知設定を変更
  ${exe} help                       このヘルプを表示
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
  return url.startsWith(WEBHOOK_URL_PREFIX);
}

/**
 * @description 有効な通知タイプを文字列で返す
 */
function getEnabledNotificationTypes(notifications: NotificationSettings): string {
  const types: string[] = [];
  if (notifications[ChangeTypes.Online]) types.push("online");
  if (notifications[ChangeTypes.Offline]) types.push("offline");
  if (notifications[ChangeTypes.TitleChange]) types.push("title");
  if (notifications[ChangeTypes.GameChange]) types.push("game");
  return types.length === 4 ? "全通知" : types.join(", ");
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

  const webhookName = await promptInput("Webhook名 (任意): ");
  const webhookUrl = await promptInput("Webhook URL: ");
  if (!validateWebhookUrl(webhookUrl)) {
    console.error("エラー: 無効なWebhook URLです");
    process.exit(1);
  }

  const newStreamer: StreamerConfig = {
    username,
    webhooks: [
      {
        name: webhookName || undefined,
        url: webhookUrl,
        notifications: {
          [ChangeTypes.Online]: true,
          [ChangeTypes.Offline]: true,
          [ChangeTypes.TitleChange]: true,
          [ChangeTypes.GameChange]: true,
        },
      },
    ],
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

  const webhookName = await promptInput("Webhook名 (任意): ");
  const webhookUrl = await promptInput("Webhook URL: ");
  if (!validateWebhookUrl(webhookUrl)) {
    console.error("エラー: 無効なWebhook URLです");
    process.exit(1);
  }

  if (streamer.webhooks.some((w) => w.url === webhookUrl)) {
    console.error("エラー: このWebhookは既に登録されています");
    process.exit(1);
  }

  const newWebhook: WebhookConfig = {
    name: webhookName || undefined,
    url: webhookUrl,
    notifications: {
      [ChangeTypes.Online]: true,
      [ChangeTypes.Offline]: true,
      [ChangeTypes.TitleChange]: true,
      [ChangeTypes.GameChange]: true,
    },
  };
  streamer.webhooks.push(newWebhook);
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
  streamer.webhooks.forEach((webhook, i) => {
    const label = webhook.name ?? `${webhook.url.slice(0, 50)}...`;
    const enabledTypes = getEnabledNotificationTypes(webhook.notifications);
    console.log(`  ${i + 1}. ${label} (${enabledTypes})`);
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
 * @description 配信者のWebhook通知設定を変更
 * @param username - Twitchユーザー名
 */
async function configureWebhook(username: string): Promise<void> {
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
  streamer.webhooks.forEach((webhook, i) => {
    const label = webhook.name ?? `${webhook.url.slice(0, 50)}...`;
    const enabledTypes = getEnabledNotificationTypes(webhook.notifications);
    console.log(`  ${i + 1}. ${label} (${enabledTypes})`);
  });

  const input = await promptInput("\n設定する番号: ");
  const index = parseInt(input, 10) - 1;

  if (Number.isNaN(index) || index < 0 || index >= streamer.webhooks.length) {
    console.error("エラー: 無効な番号です");
    process.exit(1);
  }

  const webhook = streamer.webhooks[index];
  if (!webhook) {
    console.error("エラー: Webhookが見つかりません");
    process.exit(1);
  }
  console.log("\n通知設定 (y/n):");

  const onlineInput = await promptInput(`  online [${webhook.notifications.online ? "y" : "n"}]: `);
  const offlineInput = await promptInput(
    `  offline [${webhook.notifications.offline ? "y" : "n"}]: `
  );
  const titleInput = await promptInput(
    `  titleChange [${webhook.notifications.titleChange ? "y" : "n"}]: `
  );
  const gameInput = await promptInput(
    `  gameChange [${webhook.notifications.gameChange ? "y" : "n"}]: `
  );

  const parseYesNo = (input: string, current: boolean): boolean => {
    if (input === "") return current;
    return input.toLowerCase() === "y";
  };

  webhook.notifications = {
    [ChangeTypes.Online]: parseYesNo(onlineInput, webhook.notifications.online),
    [ChangeTypes.Offline]: parseYesNo(offlineInput, webhook.notifications.offline),
    [ChangeTypes.TitleChange]: parseYesNo(titleInput, webhook.notifications.titleChange),
    [ChangeTypes.GameChange]: parseYesNo(gameInput, webhook.notifications.gameChange),
  };

  await saveConfig(config);
  console.log(`\nWebhook ${index + 1} の設定を更新しました`);
}

/**
 * @description ユーザー名を対話的に取得して検証
 * @returns 入力されたユーザー名
 */
async function promptUsername(): Promise<string> {
  const username = await promptInput("ユーザー名: ");
  if (!username) {
    console.error("エラー: ユーザー名を入力してください");
    process.exit(1);
  }
  return username;
}

/**
 * @description 対話モードのメニュー項目
 * @property key - メニュー選択キー
 * @property label - 表示ラベル
 * @property action - 実行するアクション
 */
interface MenuItem {
  key: string;
  label: string;
  action: () => Promise<void>;
}

/**
 * @description 対話モードのメニュー定義
 */
const MENU_ITEMS: MenuItem[] = [
  { key: "1", label: "配信者を追加", action: async () => addStreamer(await promptUsername()) },
  { key: "2", label: "配信者を削除", action: async () => removeStreamer(await promptUsername()) },
  { key: "3", label: "配信者一覧を表示", action: () => listStreamers() },
  { key: "4", label: "Webhookを追加", action: async () => addWebhook(await promptUsername()) },
  { key: "5", label: "Webhookを削除", action: async () => removeWebhook(await promptUsername()) },
  {
    key: "6",
    label: "Webhook通知設定",
    action: async () => configureWebhook(await promptUsername()),
  },
];

/**
 * @description 対話モードでCLIを実行
 */
async function interactiveMode(): Promise<void> {
  console.log("Stream Notifier CLI\n");

  for (const item of MENU_ITEMS) {
    console.log(`${item.key}. ${item.label}`);
  }
  console.log("0. 終了\n");

  const choice = await promptInput("選択: ");

  if (choice === "0") {
    console.log("終了します");
    return;
  }

  const selectedItem = MENU_ITEMS.find((item) => item.key === choice);
  if (!selectedItem) {
    console.error("無効な選択です");
    process.exit(1);
  }

  await selectedItem.action();
}

/**
 * @description ユーザー名引数が必須であることを検証
 * @param username - ユーザー名引数
 * @returns 検証済みユーザー名
 */
function requireUsername(username: string | undefined): string {
  if (!username) {
    console.error("エラー: ユーザー名を指定してください");
    process.exit(1);
  }
  return username;
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
        await addStreamer(requireUsername(args[1]));
        break;

      case "remove":
        await removeStreamer(requireUsername(args[1]));
        break;

      case "list":
        await listStreamers();
        break;

      case "webhook":
        if (args[1] === "add") {
          await addWebhook(requireUsername(args[2]));
        } else if (args[1] === "remove") {
          await removeWebhook(requireUsername(args[2]));
        } else if (args[1] === "config") {
          await configureWebhook(requireUsername(args[2]));
        } else {
          console.error("エラー: webhook add/remove/config を指定してください");
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
