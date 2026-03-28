# StreamNotifier

[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Twitch配信者のステータス変化をポーリングで監視し、Discord Webhookで通知するCLIツールです。

**[English](README.md)**

## 機能

- Helix APIポーリングによるTwitch配信者ステータスのリアルタイム監視
- Discord Webhook通知:
  - 配信開始 / 配信終了
  - タイトル変更
  - ゲーム/カテゴリ変更
- 複数配信者・配信者ごとに複数Webhookをサポート
- 対話式CLIメニューによる設定管理
- slogによる構造化ログ (コンソール色付き + JSONファイル)

## 必要なもの

- Go 1.25以上
- Twitch開発者アプリケーション ([dev.twitch.tv](https://dev.twitch.tv/console))
- Discord Webhook URL

## クイックスタート

### 1. クローンとビルド

```bash
git clone https://github.com/yuu1111/StreamNotifier.git
cd StreamNotifier
make build
```

### 2. 設定

設定テンプレートをコピーして、認証情報を入力してください:

```bash
cp config.example.json config.json
```

```json
{
  "twitch": {
    "clientId": "あなたのTwitchクライアントID",
    "clientSecret": "あなたのTwitchクライアントシークレット"
  },
  "polling": {
    "intervalSeconds": 30
  },
  "streamers": [
    {
      "username": "配信者名",
      "webhooks": [
        {
          "name": "メイン通知",
          "url": "https://discord.com/api/webhooks/...",
          "notifications": {
            "online": true,
            "offline": true,
            "titleChange": true,
            "gameChange": true
          }
        }
      ]
    }
  ],
  "log": {
    "level": "info"
  }
}
```

### 3. 実行

```bash
./stream-notifier
```

対話式CLIを使う場合:

```bash
./stream-notifier help
```

## Docker

```bash
docker build -t stream-notifier .
docker run -v ./config.json:/app/config.json:ro -v ./logs:/app/logs stream-notifier
```

## ビルド

```bash
make build          # 現在のプラットフォーム用にビルド
make build-all      # Linux, Windows, macOS向けにビルド
make clean          # ビルド成果物を削除
```

## アーキテクチャ

```
cmd/stream-notifier/main.go    エントリーポイント
internal/
├── cli/cli.go                 対話式メニュー + サブコマンド
├── config/config.go           Config構造体, JSON読み込み, バリデーション
├── discord/
│   ├── embed.go               Discord Embed構築
│   └── webhook.go             Webhook送信
├── monitor/
│   ├── detector.go            状態変化検出ロジック
│   ├── poller.go              定期ポーリング実行
│   └── state.go               配信者状態管理 (インメモリ)
└── twitch/
    ├── api.go                 Helix APIクライアント
    ├── auth.go                OAuth2 Client Credentials
    └── types.go               APIレスポンス型
```

**データフロー**: `Poller` → `TwitchAPI` → `DetectChanges` → `BuildEmbed` → `SendWebhook`

## ライセンス

[MIT](LICENSE)
