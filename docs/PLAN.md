# Twitch配信通知ツール 実装計画

## 概要
Twitch配信者の状態変更をDiscord WebHookに通知するBunアプリケーション

## 技術選定

| 項目 | 選定 | 理由 |
|------|------|------|
| API方式 | **ポーリング** | シンプル・ローカル実行可能・タイトル/ゲーム変更も検出可能 |
| 設定形式 | JSON | ユーザー希望 |
| ランタイム | Bun | ユーザー指定 |

## ディレクトリ構造

```
StreamNotifier/
├── src/
│   ├── main.ts           # エントリーポイント
│   ├── config/
│   │   ├── loader.ts      # 設定読み込み
│   │   └── schema.ts      # 型定義・バリデーション
│   ├── twitch/
│   │   ├── auth.ts        # Client Credentials認証
│   │   ├── api.ts         # Helix API呼び出し
│   │   └── types.ts       # API型定義
│   ├── monitor/
│   │   ├── poller.ts      # ポーリング制御
│   │   ├── state.ts       # 状態管理
│   │   └── detector.ts    # 変更検出
│   ├── discord/
│   │   ├── webhook.ts     # Webhook送信
│   │   └── embed.ts       # Embed構築
│   └── utils/
│       └── logger.ts      # ログ出力
├── config.json            # ユーザー設定
├── config.example.json    # 設定サンプル
├── package.json
└── tsconfig.json
```

## 設定ファイル形式 (config.json)

```json
{
  "twitch": {
    "clientId": "your_client_id",
    "clientSecret": "your_client_secret"
  },
  "polling": {
    "intervalSeconds": 30
  },
  "streamers": [
    {
      "username": "streamer_name",
      "notifications": {
        "online": true,
        "offline": true,
        "titleChange": true,
        "gameChange": true
      },
      "webhooks": [
        "https://discord.com/api/webhooks/xxx/yyy"
      ]
    }
  ],
  "log": {
    "level": "info"
  }
}
```

## 実装ステップ

### Step 1: プロジェクト初期化
- `bun init` でプロジェクト作成
- TypeScript設定
- ディレクトリ構造作成

### Step 2: 設定機能
- `src/config/schema.ts` - 型定義
- `src/config/loader.ts` - 設定読み込み・バリデーション
- `config.example.json` - サンプル設定

### Step 3: ユーティリティ
- `src/utils/logger.ts` - ログ出力

### Step 4: Twitch連携
- `src/twitch/types.ts` - API型定義
- `src/twitch/auth.ts` - Client Credentials認証
- `src/twitch/api.ts` - Helix API (streams, channels, users)

### Step 5: 監視機能
- `src/monitor/state.ts` - 配信者状態管理
- `src/monitor/detector.ts` - 変更検出ロジック
- `src/monitor/poller.ts` - ポーリング制御

### Step 6: Discord通知
- `src/discord/embed.ts` - Embed構築 (通知タイプ別)
- `src/discord/webhook.ts` - Webhook送信

### Step 7: 統合
- `src/main.ts` - エントリーポイント・Graceful shutdown

## 通知タイプ

| タイプ | 検出方法 | Embed色 |
|--------|----------|---------|
| 配信開始 | `isLive: false → true` | 紫 (#9146ff) |
| 配信終了 | `isLive: true → false` | グレー (#808080) |
| タイトル変更 | `title` 変更 | 緑 (#00ff00) |
| ゲーム変更 | `gameId` 変更 | オレンジ (#ff9900) |

## エラーハンドリング

- **Twitch認証失敗**: exponential backoffでリトライ、3回失敗で終了
- **APIレート制限**: Retry-Afterヘッダーを尊重
- **Webhook送信失敗**: ログ出力、他のWebhookは継続
- **設定エラー**: 起動時に詳細エラー出力して終了

## 動作確認方法

1. Twitch Developer Consoleでアプリ作成、Client ID/Secretを取得
2. `config.example.json` を `config.json` にコピーして設定
3. `bun run src/main.ts` で起動
4. 対象配信者の配信開始/終了/タイトル変更/ゲーム変更を待つか、テスト用配信者で確認
5. Discord WebHookに通知が届くことを確認
