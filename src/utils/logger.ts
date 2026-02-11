import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { type LogLevel, LogLevels } from "../config/schema";

/**
 * @description ログメタデータ型
 */
export type LogMetadata = Record<string, unknown>;

/**
 * @description 構造化ログエントリ型
 * @property timestamp - ISO 8601形式のタイムスタンプ
 * @property level - ログレベル
 * @property category - カテゴリ名
 * @property message - ログメッセージ
 * @property metadata - 追加のメタデータ @optional
 */
export type LogEntry = {
  timestamp: string;
  level: LogLevel;
  category: string;
  message: string;
  metadata?: LogMetadata | undefined;
};

/**
 * @description ロガーインターフェース
 */
export type Logger = {
  debug: (message: string, metadata?: LogMetadata) => void;
  info: (message: string, metadata?: LogMetadata) => void;
  warn: (message: string, metadata?: LogMetadata) => void;
  error: (message: string, metadata?: LogMetadata) => void;
};

/**
 * @description 現在のログ出力レベル
 */
let currentLevel: LogLevel = LogLevels.Info;

/**
 * @description ログ出力レベルを設定
 * @param level - 設定するログレベル
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * @description ログレベルの優先度マッピング
 */
const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  [LogLevels.Debug]: 0,
  [LogLevels.Info]: 1,
  [LogLevels.Warn]: 2,
  [LogLevels.Error]: 3,
};

/**
 * @description ANSIカラーコード
 */
const COLORS = {
  RESET: "\x1b[0m",
  DIM: "\x1b[2m",
  BRIGHT: "\x1b[1m",
  CYAN: "\x1b[36m",
  GREEN: "\x1b[32m",
  YELLOW: "\x1b[33m",
  RED: "\x1b[31m",
} as const;

/**
 * @description ログレベル別のカラーコード
 */
const LEVEL_COLORS: Record<LogLevel, string> = {
  [LogLevels.Debug]: COLORS.CYAN,
  [LogLevels.Info]: COLORS.GREEN,
  [LogLevels.Warn]: COLORS.YELLOW,
  [LogLevels.Error]: COLORS.RED,
};

/**
 * @description エラーオブジェクトをシリアライズ可能な形式に変換
 * @param error - エラーオブジェクト
 * @returns シリアライズされたエラー情報
 */
function serializeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
      stack: error.stack,
      ...Object.fromEntries(
        Object.entries(error).filter(([key]) => !["name", "message", "stack"].includes(key))
      ),
    };
  }
  return { error: String(error) };
}

/**
 * @description メタデータをコンソール出力用にフォーマット
 * @param metadata - メタデータオブジェクト
 * @returns フォーマット済み文字列
 */
function formatMetadataForConsole(metadata: LogMetadata): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(metadata)) {
    if (value === undefined) continue;

    if (key === "error" && value instanceof Error) {
      parts.push(`\n${COLORS.RED}Error: ${value.message}${COLORS.RESET}`);
      if (value.stack) {
        parts.push(`${COLORS.DIM}${value.stack.split("\n").slice(1, 4).join("\n")}${COLORS.RESET}`);
      }
    } else if (typeof value === "object") {
      parts.push(`${key}=${JSON.stringify(value)}`);
    } else {
      parts.push(`${key}=${value}`);
    }
  }

  return parts.length > 0 ? ` ${parts.join(" ")}` : "";
}

/**
 * @description メタデータをJSON形式にシリアライズ
 * @param metadata - メタデータオブジェクト
 * @returns シリアライズされたメタデータ
 */
function serializeMetadata(metadata?: LogMetadata): LogMetadata | undefined {
  if (!metadata || Object.keys(metadata).length === 0) return;

  const serialized = { ...metadata };
  if (serialized.error) {
    serialized.error = serializeError(serialized.error);
  }
  return serialized;
}

/**
 * @description ログファイル出力ディレクトリ
 */
const LOG_DIR = `${process.cwd()}/logs`;

/**
 * @description ログディレクトリの存在確認済みフラグ
 */
let logDirEnsured = false;

/**
 * @description JST日付フォーマッター(YYYY-MM-DD形式)
 */
const dateFormatter = new Intl.DateTimeFormat("sv-SE", {
  timeZone: "Asia/Tokyo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * @description JSTでYYYY-MM-DD形式の日付文字列を返す
 * @returns 日付文字列
 */
function getDateString(): string {
  return dateFormatter.format(new Date());
}

/**
 * @description ログファイルパスを取得
 * @param type - ファイルタイプ
 * @returns ログファイルの絶対パス
 */
function getLogFilePath(type: "app" | "error"): string {
  return `${LOG_DIR}/${type}-${getDateString()}.log`;
}

/**
 * @description ログディレクトリが存在しない場合に作成
 */
function ensureLogDirectory(): void {
  if (logDirEnsured) return;
  if (!existsSync(LOG_DIR)) {
    mkdirSync(LOG_DIR, { recursive: true });
  }
  logDirEnsured = true;
}

/**
 * @description ログエントリをファイルに同期追記
 * @param filePath - 書き込み先ファイルパス
 * @param logLine - 書き込むログ行
 */
function appendLogToFile(filePath: string, logLine: string): void {
  try {
    ensureLogDirectory();
    appendFileSync(filePath, logLine);
  } catch (err) {
    console.error(`Failed to write log to ${filePath}:`, err);
  }
}

/**
 * @description ログエントリをファイルに記録
 * @param entry - ログエントリ
 */
function writeLogToFile(entry: LogEntry): void {
  const logLine = `${JSON.stringify(entry)}\n`;

  appendLogToFile(getLogFilePath("app"), logLine);

  if (entry.level === "error") {
    appendLogToFile(getLogFilePath("error"), logLine);
  }
}

/**
 * @description カテゴリ付きロガーを作成
 * @param category - カテゴリ名
 * @returns ロガーインスタンス
 */
export function createLogger(category: string): Logger {
  /**
   * @description 指定レベルでログを出力する共通処理
   * @param level - ログレベル
   * @param message - メッセージ
   * @param metadata - 追加のメタデータ
   */
  const log = (level: LogLevel, message: string, metadata?: LogMetadata): void => {
    if (LOG_LEVEL_PRIORITY[level] < LOG_LEVEL_PRIORITY[currentLevel]) return;

    const timestamp = new Date().toISOString();
    const color = LEVEL_COLORS[level];
    const levelStr = level.toUpperCase().padEnd(5);
    const metadataStr = metadata ? formatMetadataForConsole(metadata) : "";

    const logLine = `${COLORS.DIM}[${timestamp}]${COLORS.RESET} ${color}${levelStr}${COLORS.RESET} ${COLORS.BRIGHT}[${category}]${COLORS.RESET} ${message}${metadataStr}`;

    if (level === "error" || level === "warn") {
      console.error(logLine);
    } else {
      console.log(logLine);
    }

    writeLogToFile({
      timestamp,
      level,
      category,
      message,
      metadata: serializeMetadata(metadata),
    });
  };

  return {
    debug: (message, metadata?) => log(LogLevels.Debug, message, metadata),
    info: (message, metadata?) => log(LogLevels.Info, message, metadata),
    warn: (message, metadata?) => log(LogLevels.Warn, message, metadata),
    error: (message, metadata?) => log(LogLevels.Error, message, metadata),
  };
}
