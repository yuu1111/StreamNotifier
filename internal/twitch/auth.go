package twitch

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
)

// Auth はTwitch Client Credentials認証を管理する。
type Auth struct {
	clientID     string
	clientSecret string

	mu          sync.Mutex
	accessToken string
	expiresAt   time.Time
}

// NewAuth はAuthインスタンスを作成する。
func NewAuth(clientID, clientSecret string) *Auth {
	return &Auth{
		clientID:     clientID,
		clientSecret: clientSecret,
	}
}

// GetToken は有効なアクセストークンを返す。期限切れ間近なら自動更新する。
func (a *Auth) GetToken(ctx context.Context) (string, error) {
	a.mu.Lock()
	defer a.mu.Unlock()

	// 期限切れ1分前に更新することでAPI呼び出し中の失効を防ぐ
	if a.accessToken != "" && time.Now().Before(a.expiresAt.Add(-1*time.Minute)) {
		return a.accessToken, nil
	}

	return a.refreshToken(ctx)
}

// refreshToken はClient Credentials Flowでトークンを新規取得する。
func (a *Auth) refreshToken(ctx context.Context) (string, error) {
	slog.Debug("Twitchアクセストークンを取得中...")

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	form := url.Values{
		"client_id":     {a.clientID},
		"client_secret": {a.clientSecret},
		"grant_type":    {"client_credentials"},
	}

	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		"https://id.twitch.tv/oauth2/token",
		strings.NewReader(form.Encode()))
	if err != nil {
		return "", fmt.Errorf("トークンリクエスト作成に失敗: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", fmt.Errorf("トークン取得に失敗: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return "", fmt.Errorf("トークンレスポンスの読み込みに失敗: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("Twitch認証失敗: %d %s", resp.StatusCode, string(body))
	}

	var tokenResp tokenResponse
	if err := json.Unmarshal(body, &tokenResp); err != nil {
		return "", fmt.Errorf("トークンレスポンスの解析に失敗: %w", err)
	}

	a.accessToken = tokenResp.AccessToken
	a.expiresAt = time.Now().Add(time.Duration(tokenResp.ExpiresIn) * time.Second)

	slog.Debug("Twitchアクセストークン取得完了")
	return a.accessToken, nil
}
