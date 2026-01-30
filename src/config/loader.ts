import { type Config, ConfigSchema } from "./schema";

/**
 * @description 設定ファイルのパス
 */
const CONFIG_PATH = "./config.json";

/**
 * @description 設定ファイルを読み込んでバリデーションを行う
 * @returns バリデーション済みの設定オブジェクト
 * @throws 設定ファイルが存在しない場合、またはバリデーションエラーの場合
 */
export async function loadConfig(): Promise<Config> {
  const file = Bun.file(CONFIG_PATH);

  if (!(await file.exists())) {
    throw new Error(
      `設定ファイルが見つかりません: ${CONFIG_PATH}\nconfig.example.json を config.json にコピーして設定してください。`
    );
  }

  let json: unknown;
  try {
    json = await file.json();
  } catch {
    throw new Error(
      `設定ファイルのJSON構文エラー: ${CONFIG_PATH}\n有効なJSON形式か確認してください。`
    );
  }

  const result = ConfigSchema.safeParse(json);

  if (!result.success) {
    const errors = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`設定ファイルのバリデーションエラー:\n${errors}`);
  }

  return result.data;
}
