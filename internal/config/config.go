// Package config はアプリケーション設定の読み込み・保存・バリデーションを提供する。
package config

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
)

// ChangeType は通知タイプを表す。
type ChangeType = string

const (
	ChangeOnline           ChangeType = "online"
	ChangeOffline          ChangeType = "offline"
	ChangeTitleChange      ChangeType = "titleChange"
	ChangeGameChange       ChangeType = "gameChange"
	ChangeTitleAndGame     ChangeType = "titleAndGameChange"
)

// LogLevel はログ出力レベルを表す。
type LogLevel = string

const (
	LogDebug LogLevel = "debug"
	LogInfo  LogLevel = "info"
	LogWarn  LogLevel = "warn"
	LogError LogLevel = "error"
)

const (
	// WebhookURLPrefix はDiscord Webhook URLの必須プレフィックス。
	WebhookURLPrefix = "https://discord.com/api/webhooks/"

	// ThumbnailWidth はサムネイル画像の幅。
	ThumbnailWidth = "440"

	// ThumbnailHeight はサムネイル画像の高さ。
	ThumbnailHeight = "248"
)

// NotificationSettings は通知種別ごとの有効/無効設定。
type NotificationSettings struct {
	Online      bool `json:"online"`
	Offline     bool `json:"offline"`
	TitleChange bool `json:"titleChange"`
	GameChange  bool `json:"gameChange"`
}

// WebhookConfig はWebhook設定(URLと通知設定)。
type WebhookConfig struct {
	Name          string               `json:"name,omitempty"`
	URL           string               `json:"url"`
	Notifications NotificationSettings `json:"notifications"`
}

// StreamerConfig は配信者ごとの設定。
type StreamerConfig struct {
	Username string          `json:"username"`
	Webhooks []WebhookConfig `json:"webhooks"`
}

// TwitchConfig はTwitch API認証設定。
type TwitchConfig struct {
	ClientID     string `json:"clientId"`
	ClientSecret string `json:"clientSecret"`
}

// PollingConfig はポーリング間隔設定。
type PollingConfig struct {
	IntervalSeconds int `json:"intervalSeconds"`
}

// LogConfig はログ設定。
type LogConfig struct {
	Level LogLevel `json:"level"`
}

// Config はアプリケーション全体の設定。
type Config struct {
	Twitch    TwitchConfig     `json:"twitch"`
	Polling   PollingConfig    `json:"polling"`
	Streamers []StreamerConfig `json:"streamers"`
	Log       LogConfig        `json:"log"`
}

// Load は指定パスからconfig.jsonを読み込みバリデーションする。
func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("設定ファイルの読み込みに失敗: %w", err)
	}

	var cfg Config
	if err := json.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("設定ファイルのJSON解析に失敗: %w", err)
	}

	if err := cfg.Validate(); err != nil {
		return nil, err
	}

	return &cfg, nil
}

// Save は設定をJSON形式で指定パスに保存する。
func Save(path string, cfg *Config) error {
	data, err := json.MarshalIndent(cfg, "", "  ")
	if err != nil {
		return fmt.Errorf("設定のJSON変換に失敗: %w", err)
	}
	return os.WriteFile(path, data, 0644)
}

// Validate は設定のバリデーションを行う。
func (c *Config) Validate() error {
	if c.Twitch.ClientID == "" {
		return fmt.Errorf("twitch.clientIdは必須です")
	}
	if c.Twitch.ClientSecret == "" {
		return fmt.Errorf("twitch.clientSecretは必須です")
	}
	if c.Polling.IntervalSeconds < 10 {
		return fmt.Errorf("polling.intervalSecondsは10以上で設定してください")
	}
	if len(c.Streamers) == 0 {
		return fmt.Errorf("streamersに1人以上の配信者を設定してください")
	}

	validLevels := map[string]bool{
		LogDebug: true, LogInfo: true, LogWarn: true, LogError: true,
	}
	if !validLevels[c.Log.Level] {
		return fmt.Errorf("log.levelは debug/info/warn/error のいずれかを設定してください")
	}

	for i, s := range c.Streamers {
		if s.Username == "" {
			return fmt.Errorf("streamers[%d].usernameは必須です", i)
		}
		if len(s.Webhooks) == 0 {
			return fmt.Errorf("streamers[%d].webhooksに1つ以上の設定が必要です", i)
		}
		for j, w := range s.Webhooks {
			if !strings.HasPrefix(w.URL, WebhookURLPrefix) {
				return fmt.Errorf("streamers[%d].webhooks[%d].url: Discord Webhook URLの形式が無効です", i, j)
			}
		}
	}

	return nil
}

// IsNotificationEnabled は変更タイプが通知設定で有効かどうかを判定する。
func IsNotificationEnabled(changeType ChangeType, n NotificationSettings) bool {
	switch changeType {
	case ChangeOnline:
		return n.Online
	case ChangeOffline:
		return n.Offline
	case ChangeTitleChange:
		return n.TitleChange
	case ChangeGameChange:
		return n.GameChange
	case ChangeTitleAndGame:
		// タイトル変更またはゲーム変更のどちらかが有効なら通知
		return n.TitleChange || n.GameChange
	default:
		return false
	}
}
