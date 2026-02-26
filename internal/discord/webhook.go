package discord

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"sync"
	"time"
)

// WebhookPayload はDiscord Webhookのペイロード。
type WebhookPayload struct {
	Embeds    []Embed `json:"embeds"`
	Username  string  `json:"username,omitempty"`
	AvatarURL string  `json:"avatar_url,omitempty"`
}

// StreamerInfo は配信者情報(Webhook表示用)。
type StreamerInfo struct {
	DisplayName     string
	ProfileImageURL string
}

// SendWebhook は単一のWebhookにEmbedを送信する。
func SendWebhook(ctx context.Context, webhookURL string, embed Embed, streamer StreamerInfo) error {
	payload := WebhookPayload{
		Embeds:    []Embed{embed},
		Username:  streamer.DisplayName,
		AvatarURL: streamer.ProfileImageURL,
	}

	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("WebhookペイロードのJSON変換に失敗: %w", err)
	}

	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, webhookURL, bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("Webhookリクエスト作成に失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("Webhook送信に失敗: %w", err)
	}
	defer resp.Body.Close()

	// レスポンスボディを消費してリソースを解放
	respBody, _ := io.ReadAll(resp.Body)

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("Webhook送信失敗: %d %s", resp.StatusCode, string(respBody))
	}

	slog.Debug("Webhook送信成功", "url", truncate(webhookURL, 50))
	return nil
}

// SendToMultipleWebhooks は複数のWebhookにEmbedを並列送信する。
func SendToMultipleWebhooks(ctx context.Context, webhookURLs []string, embed Embed, streamer StreamerInfo) {
	var wg sync.WaitGroup
	for i, url := range webhookURLs {
		wg.Add(1)
		go func(idx int, u string) {
			defer wg.Done()
			if err := SendWebhook(ctx, u, embed, streamer); err != nil {
				slog.Error("Webhook送信エラー",
					"index", idx+1,
					"total", len(webhookURLs),
					"error", err)
			}
		}(i, url)
	}
	wg.Wait()
}

// truncate は文字列を指定長で切り詰める。
func truncate(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}
