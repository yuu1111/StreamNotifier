# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# 開発
go run ./cmd/stream-notifier         # 監視開始
go run ./cmd/stream-notifier help     # CLIヘルプ

# 品質チェック
make lint                             # golangci-lint
go vet ./...                          # go vet

# ビルド
make build                            # 現在プラットフォーム用にビルド
make build-all                        # 全プラットフォーム
make clean                            # ビルド成果物を削除
```

## Architecture

Twitch配信者の状態変化をポーリングし、Discord Webhookで通知するCLIアプリ。

```
cmd/
└── stream-notifier/
    └── main.go           # エントリーポイント (監視 or CLI dispatch)
internal/
├── cli/
│   └── cli.go            # 対話式メニュー + サブコマンド
├── config/
│   └── config.go         # Config struct, JSON読み込み, バリデーション
├── discord/
│   ├── embed.go          # Embed構築
│   └── webhook.go        # Webhook送信
├── monitor/
│   ├── detector.go       # 状態変化検出ロジック
│   ├── poller.go         # 定期ポーリング実行
│   └── state.go          # 配信者状態管理 (in-memory)
└── twitch/
    ├── api.go            # Helix API クライアント
    ├── auth.go           # OAuth2 Client Credentials
    └── types.go          # APIレスポンス型
```

**データフロー**: `Poller` → `TwitchAPI` → `DetectChanges` → `BuildEmbed` → `SendWebhook`

## Key Points

- 言語: Go (stdlib only, 外部依存ゼロ)
- 設定バリデーション: 手書きValidate()メソッド
- 通知タイプ: online / offline / titleChange / gameChange / titleAndGameChange
- 設定ファイル: `config.json` (テンプレート: `config.example.json`)
- ログ: slog (コンソール ANSI色付き + ファイル JSON)
