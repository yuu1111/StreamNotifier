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
	"time"
)

const helixBaseURL = "https://api.twitch.tv/helix"

// API はTwitch Helix APIクライアント。
type API struct {
	auth     *Auth
	clientID string
}

// NewAPI はAPIインスタンスを作成する。
func NewAPI(auth *Auth, clientID string) *API {
	return &API{auth: auth, clientID: clientID}
}

// request はAPIリクエストを実行しレスポンスデータを返す。
func request[T any](ctx context.Context, a *API, endpoint string, params url.Values) ([]T, error) {
	token, err := a.auth.GetToken(ctx)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()

	reqURL := helixBaseURL + endpoint + "?" + params.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, reqURL, nil)
	if err != nil {
		return nil, fmt.Errorf("APIリクエスト作成に失敗: %w", err)
	}
	req.Header.Set("Authorization", "Bearer "+token)
	req.Header.Set("Client-Id", a.clientID)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("APIリクエストに失敗: %w", err)
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, fmt.Errorf("APIレスポンスの読み込みに失敗: %w", err)
	}

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("Twitch API エラー: %d %s", resp.StatusCode, string(body))
	}

	var apiResp apiResponse[T]
	if err := json.Unmarshal(body, &apiResp); err != nil {
		return nil, fmt.Errorf("APIレスポンスの解析に失敗: %w", err)
	}

	return apiResp.Data, nil
}

// GetUsers はユーザー情報を取得する。返り値はlogin名(小文字)をキーとするmap。
func (a *API) GetUsers(ctx context.Context, logins []string) (map[string]User, error) {
	if len(logins) == 0 {
		return make(map[string]User), nil
	}

	params := url.Values{}
	for _, login := range logins {
		params.Add("login", login)
	}

	users, err := request[User](ctx, a, "/users", params)
	if err != nil {
		return nil, err
	}

	result := make(map[string]User, len(users))
	for _, u := range users {
		result[strings.ToLower(u.Login)] = u
	}

	slog.Debug("ユーザー情報取得", "count", len(users))
	return result, nil
}

// GetStreams は配信中のストリーム情報を取得する。返り値はlogin名(小文字)をキーとするmap。
func (a *API) GetStreams(ctx context.Context, userLogins []string) (map[string]Stream, error) {
	if len(userLogins) == 0 {
		return make(map[string]Stream), nil
	}

	params := url.Values{}
	for _, login := range userLogins {
		params.Add("user_login", login)
	}

	streams, err := request[Stream](ctx, a, "/streams", params)
	if err != nil {
		return nil, err
	}

	result := make(map[string]Stream, len(streams))
	for _, s := range streams {
		result[strings.ToLower(s.UserLogin)] = s
	}

	slog.Debug("配信中", "count", len(streams))
	return result, nil
}

// GetChannels はチャンネル情報を取得する。返り値はlogin名(小文字)をキーとするmap。
func (a *API) GetChannels(ctx context.Context, broadcasterIDs []string) (map[string]Channel, error) {
	if len(broadcasterIDs) == 0 {
		return make(map[string]Channel), nil
	}

	params := url.Values{}
	for _, id := range broadcasterIDs {
		params.Add("broadcaster_id", id)
	}

	channels, err := request[Channel](ctx, a, "/channels", params)
	if err != nil {
		return nil, err
	}

	result := make(map[string]Channel, len(channels))
	for _, ch := range channels {
		result[strings.ToLower(ch.BroadcasterLogin)] = ch
	}

	slog.Debug("チャンネル情報取得", "count", len(channels))
	return result, nil
}

// GetLatestVod は最新のアーカイブVODを取得する。存在しない場合はnilを返す。
func (a *API) GetLatestVod(ctx context.Context, userID string) (*Video, error) {
	params := url.Values{
		"user_id": {userID},
		"type":    {"archive"},
		"first":   {"1"},
	}

	videos, err := request[Video](ctx, a, "/videos", params)
	if err != nil {
		return nil, err
	}

	if len(videos) == 0 {
		return nil, nil
	}
	return &videos[0], nil
}
