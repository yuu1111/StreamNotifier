# StreamNotifier

[![Go](https://img.shields.io/badge/Go-1.25-00ADD8?logo=go&logoColor=white)](https://go.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A CLI tool that monitors Twitch streamer status changes via polling and sends notifications to Discord Webhooks.

**[日本語](README.ja.md)**

## Features

- Real-time monitoring of Twitch streamer status via Helix API polling
- Discord Webhook notifications for:
  - Stream online / offline
  - Title changes
  - Game/category changes
- Multi-streamer and multi-webhook support per streamer
- Interactive CLI menu for configuration management
- Structured logging with slog (colored console + JSON file)

## Requirements

- Go 1.25+
- Twitch Developer Application ([dev.twitch.tv](https://dev.twitch.tv/console))
- Discord Webhook URL(s)

## Quick Start

### 1. Clone and build

```bash
git clone https://github.com/yuu1111/StreamNotifier.git
cd StreamNotifier
make build
```

### 2. Configure

Copy the example config and fill in your credentials:

```bash
cp config.example.json config.json
```

```json
{
  "twitch": {
    "clientId": "your_twitch_client_id",
    "clientSecret": "your_twitch_client_secret"
  },
  "polling": {
    "intervalSeconds": 30
  },
  "streamers": [
    {
      "username": "streamer_name",
      "webhooks": [
        {
          "name": "Main Notification",
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

### 3. Run

```bash
./stream-notifier
```

Or use the interactive CLI:

```bash
./stream-notifier help
```

## Docker

```bash
docker build -t stream-notifier .
docker run -v ./config.json:/app/config.json:ro -v ./logs:/app/logs stream-notifier
```

## Build

```bash
make build          # Build for current platform
make build-all      # Build for Linux, Windows, macOS
make clean          # Remove build artifacts
```

## Architecture

```
cmd/stream-notifier/main.go    Entry point
internal/
├── cli/cli.go                 Interactive menu + subcommands
├── config/config.go           Config struct, JSON loader, validation
├── discord/
│   ├── embed.go               Discord embed builder
│   └── webhook.go             Webhook sender
├── monitor/
│   ├── detector.go            State change detection
│   ├── poller.go              Periodic polling
│   └── state.go               In-memory streamer state
└── twitch/
    ├── api.go                 Helix API client
    ├── auth.go                OAuth2 Client Credentials
    └── types.go               API response types
```

**Data flow**: `Poller` → `TwitchAPI` → `DetectChanges` → `BuildEmbed` → `SendWebhook`

## License

[MIT](LICENSE)
