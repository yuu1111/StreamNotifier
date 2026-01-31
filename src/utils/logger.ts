import { type LogLevel, LogLevels } from "../config/schema";

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
 * @description ログレベルごとのコンソール出力関数
 */
const LOG_FUNCTIONS: Record<LogLevel, (...args: unknown[]) => void> = {
  [LogLevels.Debug]: console.log,
  [LogLevels.Info]: console.log,
  [LogLevels.Warn]: console.warn,
  [LogLevels.Error]: console.error,
};

/**
 * @description レベル別ログ出力を行うロガー
 */
class Logger {
  private level: LogLevel = LogLevels.Info;

  /**
   * @description ログ出力レベルを設定する
   * @param level - 設定するログレベル
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * @description 指定レベルのログを出力すべきか判定する
   * @param level - 判定するログレベル
   * @returns 出力すべき場合true
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[this.level];
  }

  /**
   * @description ログメッセージをフォーマットする
   * @param level - ログレベル
   * @param message - メッセージ
   * @returns フォーマット済みメッセージ
   */
  private format(level: string, message: string): string {
    const timestamp = new Date().toISOString();
    return `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  }

  /**
   * @description 指定レベルでログを出力する共通処理
   * @param level - ログレベル
   * @param message - メッセージ
   * @param args - 追加の引数
   */
  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    const logFn = LOG_FUNCTIONS[level];
    logFn(this.format(level, message), ...args);
  }

  /**
   * @description デバッグログを出力する
   * @param message - メッセージ
   * @param args - 追加の引数
   */
  debug(message: string, ...args: unknown[]): void {
    this.log(LogLevels.Debug, message, args);
  }

  /**
   * @description 情報ログを出力する
   * @param message - メッセージ
   * @param args - 追加の引数
   */
  info(message: string, ...args: unknown[]): void {
    this.log(LogLevels.Info, message, args);
  }

  /**
   * @description 警告ログを出力する
   * @param message - メッセージ
   * @param args - 追加の引数
   */
  warn(message: string, ...args: unknown[]): void {
    this.log(LogLevels.Warn, message, args);
  }

  /**
   * @description エラーログを出力する
   * @param message - メッセージ
   * @param args - 追加の引数
   */
  error(message: string, ...args: unknown[]): void {
    this.log(LogLevels.Error, message, args);
  }
}

/**
 * @description グローバルロガーインスタンス
 */
export const logger = new Logger();
