// Package twitch はTwitch Helix APIクライアントを提供する。
package twitch

// apiResponse はTwitch APIの共通レスポンス構造。
type apiResponse[T any] struct {
	Data []T `json:"data"`
}

// User はTwitchユーザー情報。
type User struct {
	ID              string `json:"id"`
	Login           string `json:"login"`
	DisplayName     string `json:"display_name"`
	ProfileImageURL string `json:"profile_image_url"`
}

// Stream はTwitch配信情報。
type Stream struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	UserLogin    string `json:"user_login"`
	UserName     string `json:"user_name"`
	GameID       string `json:"game_id"`
	GameName     string `json:"game_name"`
	Title        string `json:"title"`
	ViewerCount  int    `json:"viewer_count"`
	StartedAt    string `json:"started_at"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// Channel はTwitchチャンネル情報(オフライン時のタイトル/ゲーム取得用)。
type Channel struct {
	BroadcasterID    string `json:"broadcaster_id"`
	BroadcasterLogin string `json:"broadcaster_login"`
	BroadcasterName  string `json:"broadcaster_name"`
	GameID           string `json:"game_id"`
	GameName         string `json:"game_name"`
	Title            string `json:"title"`
}

// Video はTwitch VOD情報。
type Video struct {
	ID           string `json:"id"`
	UserID       string `json:"user_id"`
	UserLogin    string `json:"user_login"`
	Title        string `json:"title"`
	URL          string `json:"url"`
	CreatedAt    string `json:"created_at"`
	Duration     string `json:"duration"`
	ThumbnailURL string `json:"thumbnail_url"`
}

// tokenResponse はOAuth2トークンレスポンス。
type tokenResponse struct {
	AccessToken string `json:"access_token"`
	ExpiresIn   int    `json:"expires_in"`
	TokenType   string `json:"token_type"`
}
