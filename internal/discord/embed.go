// Package discord はDiscord Webhook連携を提供する。
package discord

import (
	"fmt"
	"strings"
	"time"

	"github.com/yuu1111/StreamNotifier/internal/config"
	"github.com/yuu1111/StreamNotifier/internal/monitor"
)

// EmbedField はDiscord Embedのフィールド。
type EmbedField struct {
	Name   string `json:"name"`
	Value  string `json:"value"`
	Inline bool   `json:"inline,omitempty"`
}

// EmbedFooter はDiscord Embedのフッター。
type EmbedFooter struct {
	Text string `json:"text"`
}

// EmbedAuthor はDiscord Embedの作成者情報。
type EmbedAuthor struct {
	Name    string `json:"name"`
	IconURL string `json:"icon_url,omitempty"`
}

// EmbedImage はDiscord Embedの画像。
type EmbedImage struct {
	URL string `json:"url"`
}

// Embed はDiscord Embed構造。
type Embed struct {
	Title       string       `json:"title"`
	Description string       `json:"description,omitempty"`
	URL         string       `json:"url,omitempty"`
	Color       int          `json:"color"`
	Thumbnail   *EmbedImage  `json:"thumbnail,omitempty"`
	Image       *EmbedImage  `json:"image,omitempty"`
	Fields      []EmbedField `json:"fields,omitempty"`
	Timestamp   string       `json:"timestamp,omitempty"`
	Footer      *EmbedFooter `json:"footer,omitempty"`
	Author      *EmbedAuthor `json:"author,omitempty"`
}

var colorMap = map[string]int{
	config.ChangeOnline:       0x9146ff,
	config.ChangeOffline:      0x808080,
	config.ChangeTitleChange:  0x00ff00,
	config.ChangeGameChange:   0xff9900,
	config.ChangeTitleAndGame: 0x00ccff,
}

var titleMap = map[string]string{
	config.ChangeOnline:       "配信開始",
	config.ChangeOffline:      "配信終了",
	config.ChangeTitleChange:  "タイトル変更",
	config.ChangeGameChange:   "ゲーム変更",
	config.ChangeTitleAndGame: "タイトル・ゲーム変更",
}

// changeEventTypes はタイトル/ゲーム変更系のイベント種別。
var changeEventTypes = map[string]bool{
	config.ChangeTitleChange:  true,
	config.ChangeGameChange:   true,
	config.ChangeTitleAndGame: true,
}

// formatElapsedTime は配信開始からの経過時間を日本語でフォーマットする。
func formatElapsedTime(startedAt string) string {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return ""
	}

	diff := time.Since(start)
	if diff < 0 {
		return ""
	}

	totalMinutes := int(diff.Minutes())
	if totalMinutes < 1 {
		return "たった今"
	}

	hours := totalMinutes / 60
	mins := totalMinutes % 60

	if hours == 0 {
		return fmt.Sprintf("%d分前から配信中", mins)
	}
	return fmt.Sprintf("%d時間%d分前から配信中", hours, mins)
}

// formatDuration は配信時間をフォーマットする。
func formatDuration(startedAt string) string {
	start, err := time.Parse(time.RFC3339, startedAt)
	if err != nil {
		return "不明"
	}

	diff := time.Since(start)
	totalMinutes := int(diff.Minutes())
	hours := totalMinutes / 60
	mins := totalMinutes % 60

	if hours == 0 {
		return fmt.Sprintf("%d分", mins)
	}
	return fmt.Sprintf("%d時間%d分", hours, mins)
}

// formatTimeJST は時刻をJST HH:MM形式にフォーマットする。
func formatTimeJST(t time.Time) string {
	jst := time.FixedZone("JST", 9*60*60)
	return t.In(jst).Format("15:04")
}

// orDefault は空文字列の場合にデフォルト値を返す。
func orDefault(s, defaultVal string) string {
	if s == "" {
		return defaultVal
	}
	return s
}

// BuildEmbed は変更情報からDiscord Embedを構築する。
func BuildEmbed(change monitor.DetectedChange) Embed {
	state := change.CurrentState
	channelURL := "https://twitch.tv/" + state.Username

	embed := Embed{
		Title:     titleMap[change.Type],
		URL:       channelURL,
		Color:     colorMap[change.Type],
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Author: &EmbedAuthor{
			Name:    state.DisplayName,
			IconURL: state.ProfileImageURL,
		},
	}

	switch change.Type {
	case config.ChangeOnline:
		embed.Description = orDefault(state.Title, "(タイトルなし)")

		fields := []EmbedField{
			{Name: "ゲーム", Value: orDefault(state.GameName, "(未設定)"), Inline: true},
		}

		if state.StartedAt != "" {
			startTime, err := time.Parse(time.RFC3339, state.StartedAt)
			if err == nil {
				fields = append(fields, EmbedField{
					Name:   "開始時刻",
					Value:  formatTimeJST(startTime),
					Inline: true,
				})

				elapsed := formatElapsedTime(state.StartedAt)
				if elapsed != "" && !strings.Contains(elapsed, "たった今") {
					embed.Footer = &EmbedFooter{Text: elapsed}
				}
			}
		}

		embed.Fields = fields

		if state.ThumbnailURL != "" {
			thumbnailURL := strings.ReplaceAll(state.ThumbnailURL, "{width}", config.ThumbnailWidth)
			thumbnailURL = strings.ReplaceAll(thumbnailURL, "{height}", config.ThumbnailHeight)
			embed.Image = &EmbedImage{URL: thumbnailURL}
		}

	case config.ChangeOffline:
		embed.Description = "配信が終了しました"

		var fields []EmbedField
		now := time.Now()

		if change.StreamStartedAt != "" {
			startTime, err := time.Parse(time.RFC3339, change.StreamStartedAt)
			if err == nil {
				duration := formatDuration(change.StreamStartedAt)
				fields = append(fields, EmbedField{
					Name:  "配信時間",
					Value: fmt.Sprintf("%s → %s (%s)", formatTimeJST(startTime), formatTimeJST(now), duration),
				})
			} else {
				fields = append(fields, EmbedField{
					Name:   "終了時刻",
					Value:  formatTimeJST(now),
					Inline: true,
				})
			}
		} else {
			fields = append(fields, EmbedField{
				Name:   "終了時刻",
				Value:  formatTimeJST(now),
				Inline: true,
			})
		}

		if change.VodURL != "" {
			fields = append(fields, EmbedField{
				Name:  "VOD",
				Value: fmt.Sprintf("[この配信を見る](%s)", change.VodURL),
			})
		}

		embed.Fields = fields

		if change.VodThumbnailURL != "" {
			embed.Image = &EmbedImage{URL: change.VodThumbnailURL}
		}

	case config.ChangeTitleChange:
		embed.Fields = []EmbedField{
			{Name: "変更前", Value: orDefault(change.OldValue, "(なし)")},
			{Name: "変更後", Value: orDefault(change.NewValue, "(なし)")},
		}

	case config.ChangeGameChange:
		embed.Fields = []EmbedField{
			{Name: "変更前", Value: orDefault(change.OldValue, "(未設定)"), Inline: true},
			{Name: "変更後", Value: orDefault(change.NewValue, "(未設定)"), Inline: true},
		}

	case config.ChangeTitleAndGame:
		embed.Fields = []EmbedField{
			{
				Name:  "タイトル",
				Value: fmt.Sprintf("%s\n→ %s", orDefault(change.OldTitle, "(なし)"), orDefault(change.NewTitle, "(なし)")),
			},
			{
				Name:  "ゲーム",
				Value: fmt.Sprintf("%s\n→ %s", orDefault(change.OldGame, "(未設定)"), orDefault(change.NewGame, "(未設定)")),
			},
		}
	}

	// タイトル/ゲーム変更時は配信中であればfooterを設定
	if changeEventTypes[change.Type] && state.IsLive && embed.Footer == nil {
		embed.Footer = &EmbedFooter{Text: "配信中"}
	}

	return embed
}
