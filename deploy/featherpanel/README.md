# FeatherPanelへの配備

StreamNotifierはGitHub ActionsでコンテナをGHCRへpublishし、FeatherPanelで実行する。

## 永続ファイル

- `/home/container/config.json`: Twitch資格情報、監視対象、Discord Webhook設定
- `/home/container/data/state.json`: 配信者の前回状態
- `/home/container/logs`: 日次ログ

`config.json`には秘密値が含まれるため、GitやSpell JSONへ追加しない。

## 初回配備

1. `main`へpushし、Container workflowで `ghcr.io/yuu1111/streamnotifier:latest` をpublishする。
2. workspaceの `.env` を指定してサーバーを作成する。

```powershell
pwsh ./deploy/featherpanel/deploy.ps1 `
  -PanelEnvFile C:\Users\yuu21\workspace\.env
```

3. 起動前に `config.json` と、既存環境があれば `data/state.json`、`logs/` をサーバーへ配置する。
4. FeatherPanelから起動し、`Application ready` を確認する。
5. GitHub Actions Secretsへ次を設定する。

- `FEATHERPANEL_URL`
- `FEATHERPANEL_API_KEY`
- `FEATHERPANEL_SERVER_ID`（UUID short）

以後はmainへのpushでimageをpublishし、FeatherPanel serverをrestartする。

## 停止

Spellのstop commandは `^C`。アプリはSIGINT、SIGTERM、stdinの制御文字、stdinの文字列 `^C` を正常終了として処理し、終了時に状態を保存する。
