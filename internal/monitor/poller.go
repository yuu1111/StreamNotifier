package monitor

import (
	"context"
	"log/slog"
	"strings"
	"time"

	"github.com/yuu1111/StreamNotifier/internal/config"
	"github.com/yuu1111/StreamNotifier/internal/twitch"
)

// ChangeHandler は変更検出時に呼び出されるコールバック型。
type ChangeHandler func(changes []DetectedChange, streamerConfig config.StreamerConfig)

// Poller は配信者の状態を定期的にポーリングし変更を検出する。
type Poller struct {
	api          *twitch.API
	cfg          *config.Config
	onChanges    ChangeHandler
	stateManager *StateManager
	userCache    map[string]twitch.User
}

// NewPoller はPollerインスタンスを作成する。
func NewPoller(api *twitch.API, cfg *config.Config, onChanges ChangeHandler) *Poller {
	return &Poller{
		api:          api,
		cfg:          cfg,
		onChanges:    onChanges,
		stateManager: NewStateManager(),
		userCache:    make(map[string]twitch.User),
	}
}

// Run はポーリングループを開始する。ctxがキャンセルされるまで実行する。
func (p *Poller) Run(ctx context.Context) error {
	if err := p.initializeUserCache(ctx); err != nil {
		return err
	}

	p.poll(ctx)

	interval := time.Duration(p.cfg.Polling.IntervalSeconds) * time.Second
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	slog.Info("ポーリング開始",
		"interval", p.cfg.Polling.IntervalSeconds,
		"streamers", len(p.cfg.Streamers))

	for {
		select {
		case <-ctx.Done():
			slog.Info("ポーリング停止")
			return nil
		case <-ticker.C:
			p.poll(ctx)
		}
	}
}

// initializeUserCache はユーザー情報をキャッシュに読み込む。
func (p *Poller) initializeUserCache(ctx context.Context) error {
	usernames := make([]string, len(p.cfg.Streamers))
	for i, s := range p.cfg.Streamers {
		usernames[i] = s.Username
	}

	users, err := p.api.GetUsers(ctx, usernames)
	if err != nil {
		return err
	}

	p.userCache = users

	for _, s := range p.cfg.Streamers {
		key := strings.ToLower(s.Username)
		if _, ok := p.userCache[key]; !ok {
			slog.Warn("ユーザーが見つかりません", "username", s.Username)
		}
	}

	return nil
}

// combineChanges はタイトル変更とゲーム変更を同時検出した場合に統合する。
func combineChanges(changes []DetectedChange) []DetectedChange {
	var titleChange, gameChange *DetectedChange
	for i := range changes {
		switch changes[i].Type {
		case config.ChangeTitleChange:
			titleChange = &changes[i]
		case config.ChangeGameChange:
			gameChange = &changes[i]
		}
	}

	if titleChange == nil || gameChange == nil {
		return changes
	}

	combined := DetectedChange{
		Type:         config.ChangeTitleAndGame,
		Streamer:     titleChange.Streamer,
		OldTitle:     titleChange.OldValue,
		NewTitle:     titleChange.NewValue,
		OldGame:      gameChange.OldValue,
		NewGame:      gameChange.NewValue,
		CurrentState: titleChange.CurrentState,
	}

	var result []DetectedChange
	for _, c := range changes {
		if c.Type != config.ChangeTitleChange && c.Type != config.ChangeGameChange {
			result = append(result, c)
		}
	}
	return append(result, combined)
}

// buildStreamerState はAPIレスポンスから配信者状態を構築する。
func buildStreamerState(user twitch.User, stream *twitch.Stream, channel *twitch.Channel) StreamerState {
	state := StreamerState{
		UserID:          user.ID,
		Username:        user.Login,
		DisplayName:     user.DisplayName,
		ProfileImageURL: user.ProfileImageURL,
	}

	if stream != nil {
		state.IsLive = true
		state.Title = stream.Title
		state.GameID = stream.GameID
		state.GameName = stream.GameName
		state.StartedAt = stream.StartedAt
		state.ThumbnailURL = stream.ThumbnailURL
		state.ViewerCount = stream.ViewerCount
	} else if channel != nil {
		state.Title = channel.Title
		state.GameID = channel.GameID
		state.GameName = channel.GameName
	}

	return state
}

// collectOfflineUserIDs はオフライン配信者のユーザーIDを収集する。
func (p *Poller) collectOfflineUserIDs(streams map[string]twitch.Stream) []string {
	var ids []string
	for _, s := range p.cfg.Streamers {
		key := strings.ToLower(s.Username)
		user, ok := p.userCache[key]
		if ok {
			if _, live := streams[key]; !live {
				ids = append(ids, user.ID)
			}
		}
	}
	return ids
}

// attachVodInfo はOffline変更にVOD情報を付与する。
func (p *Poller) attachVodInfo(ctx context.Context, changes []DetectedChange, userID string) {
	for i := range changes {
		if changes[i].Type != config.ChangeOffline {
			continue
		}

		vod, err := p.api.GetLatestVod(ctx, userID)
		if err != nil {
			slog.Warn("VOD取得失敗", "error", err)
			continue
		}
		if vod == nil {
			continue
		}

		changes[i].VodURL = vod.URL
		thumbnailURL := vod.ThumbnailURL
		thumbnailURL = strings.ReplaceAll(thumbnailURL, "%{width}", config.ThumbnailWidth)
		thumbnailURL = strings.ReplaceAll(thumbnailURL, "%{height}", config.ThumbnailHeight)
		changes[i].VodThumbnailURL = thumbnailURL
	}
}

// processStreamer は単一配信者の変更を処理する。
func (p *Poller) processStreamer(
	ctx context.Context,
	sc config.StreamerConfig,
	streams map[string]twitch.Stream,
	channels map[string]twitch.Channel,
) {
	key := strings.ToLower(sc.Username)
	user, ok := p.userCache[key]
	if !ok {
		return
	}

	var streamPtr *twitch.Stream
	if s, ok := streams[key]; ok {
		streamPtr = &s
	}

	var channelPtr *twitch.Channel
	if ch, ok := channels[key]; ok {
		channelPtr = &ch
	}

	newState := buildStreamerState(user, streamPtr, channelPtr)
	oldState := p.stateManager.GetState(key)
	isInitialPoll := oldState == nil

	if isInitialPoll {
		status := "オフライン"
		if newState.IsLive {
			game := newState.GameName
			if game == "" {
				game = "ゲーム未設定"
			}
			status = "配信中 - " + game
		}
		slog.Info("初期状態", "streamer", newState.DisplayName, "status", status)
	}

	detectedChanges := DetectChanges(oldState, newState)

	// 初回ポーリング時に配信中であればOnline通知を追加
	if isInitialPoll && newState.IsLive {
		detectedChanges = append(detectedChanges, DetectedChange{
			Type:         config.ChangeOnline,
			Streamer:     newState.Username,
			CurrentState: newState,
		})
	}

	combined := combineChanges(detectedChanges)
	p.attachVodInfo(ctx, combined, user.ID)

	if len(combined) > 0 {
		p.onChanges(combined, sc)
	}

	p.stateManager.UpdateState(key, newState)
}

// poll は全配信者の状態をポーリングして変更を検出する。
func (p *Poller) poll(ctx context.Context) {
	usernames := make([]string, len(p.cfg.Streamers))
	for i, s := range p.cfg.Streamers {
		usernames[i] = s.Username
	}

	streams, err := p.api.GetStreams(ctx, usernames)
	if err != nil {
		slog.Error("ポーリングエラー", "error", err)
		return
	}

	offlineIDs := p.collectOfflineUserIDs(streams)

	var channels map[string]twitch.Channel
	if len(offlineIDs) > 0 {
		var chErr error
		channels, chErr = p.api.GetChannels(ctx, offlineIDs)
		if chErr != nil {
			slog.Error("チャンネル情報取得エラー", "error", chErr)
			channels = make(map[string]twitch.Channel)
		}
	} else {
		channels = make(map[string]twitch.Channel)
	}

	for _, sc := range p.cfg.Streamers {
		p.processStreamer(ctx, sc, streams, channels)
	}
}
