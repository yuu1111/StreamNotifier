# TSDocスタイル

## スタイルルール

1. 型情報を書かない (TypeScriptから推論されるため冗長)
2. `@description`は1行で簡潔に (追加価値のある情報を提供)
3. `@param`は `名前 - 説明` 形式で型を書かない
4. `@returns`は説明のみ (型は書かない、voidは省略)
5. `@example`タグを使わない (冗長になりやすいため)
6. セクション区切り禁止 (`====`, `----`, `#region`等の視覚的区切り線)
7. 全角記号を使わない (半角 `()[]{}:-/` を使用)
8. コメント内の絵文字禁止 (コード内の文字列リテラルは許可)
9. すべてのinterface/type定義にTSDoc必須
10. すべてのconst定数定義にTSDoc必須
11. 内部関数にもTSDoc必須 (エクスポート有無問わず)
12. コメントアウトされたコードは削除 (Gitで履歴管理)

## 主要タグ

| タグ | 用途 | 記述形式 |
|------|------|----------|
| `@description` | 機能説明 | 1行で簡潔に |
| `@param` | パラメータ | `名前 - 説明` |
| `@returns` | 戻り値 | 説明のみ、または `説明 @default 値` |
| `@property` | プロパティ | `名前 - 説明 @default 値` |
| `@optional` | オプション | `@param`または`@property`と同一行に記述 |
| `@default` | デフォルト値 | `@property`または`@returns`と同一行に記述 |
| `@deprecated` | 非推奨 | 代替案を必ず明記 |
| `@throws` | 例外 | 特殊なエラーのみ |
| `@internal` | 内部実装 | 公開APIでないことを明示 |

## 変換パターン

| Before | After |
|--------|-------|
| `@param {string} name` | `@param name - 説明` |
| `@returns {Promise<User>}` | `@returns ユーザー情報` |
| `（必須）` | `(必須)` |
| `// ========` | 削除 |
| `@example ...` | 削除 |
| `// const old = ...` | 削除 |

## 良い例

```typescript
/**
 * @description キャッシュ優先でユーザー情報を取得(TTL: 5分)
 * @param userId - ユーザー識別子
 * @returns ユーザー情報
 */
function getUserById(userId: string): Promise<User> { }

/**
 * @description ユーザー基本情報
 * @property id - ユーザー識別子
 * @property status - アカウント状態 @optional @default 'active'
 * @property loginCount - ログイン回数
 */
interface UserProfile {
  id: string;
  status?: string;
  loginCount: number;
}

/**
 * @description APIのベースURL
 */
const API_BASE_URL = 'https://api.example.com';
```

## 悪い例

```typescript
// 型情報の重複
/**
 * @param {string} userId - ユーザーID
 * @returns {Promise<User>} ユーザー情報
 */

// 関数名の繰り返し
/**
 * @description ユーザーIDからユーザーを取得
 */
function getUserById() { }

// 冗長な説明
/**
 * @description 商品の割引率を計算
 *
 * この関数は、指定された商品の割引率を計算します。
 * 割引率は通常価格に対する割引額の割合として算出されます。
 */
```

## インラインコメントの原則

「何を」ではなく「なぜ」を説明する:

```typescript
// 何をしているか(コードで明白)
// ユーザーIDを検証
if (userId.length > 0) { }

// なぜそうしているか
// 空文字列はDBでnull扱いになるため事前チェック
if (userId.length > 0) { }

// なぜ他の方法を使わないか(最も価値が高い)
// trimは使用しない: スペースのみのIDも有効な値として扱う仕様
if (userId.length > 0) { }
```
