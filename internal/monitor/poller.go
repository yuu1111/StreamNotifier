package monitor

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/yuu1111/StreamNotifier/internal/config"
	"github.com/yuu1111/StreamNotifier/internal/twitch"
)

// ChangeHandler は変更検出時に呼び出されるコールバック型
type ChangeHandler func(changes []DetectedChange, streamerConfig config.StreamerConfig)

// Poller は配信者の状態を定期的にポーリングし変更を検出する
type Poller struct {
	api           *twitch.API
	cfg           *config.Config
	configPath    string
	statePath     string
	onChanges     ChangeHandler
	stateManager  *StateManager
	userCache     map[string]twitch.User
	lastConfigMod time.Time
}

// NewPoller はPollerインスタンスを作成する
func NewPoller(api *twitch.API, cfg *config.Config, configPath string, statePath string, onChanges ChangeHandler) *Poller {
	return &Poller{
		api:          api,
		cfg:          cfg,
		configPath:   configPath,
		statePath:    statePath,
		onChanges:    onChanges,
		stateManager: NewStateManager(),
		userCache:    make(map[string]twitch.User),
	}
}

// Run はポーリングループを開始し、ctxがキャンセルされるまで実行する
func (p *Poller) Run(ctx context.Context) error {
	if err := os.MkdirAll(filepath.Dir(p.statePath), 0755); err != nil {
		return fmt.Errorf("状態保存ディレクトリの作成に失敗: %w", err)
	}

	if err := p.stateManager.LoadFromFile(p.statePath); err != nil {
		slog.Warn("状態ファイルの読み込みに失敗(新規起動として続行)", "error", err)
	} else if p.stateManager.stateCount() > 0 {
		slog.Info("前回の状態を復元しました", "streamers", p.stateManager.stateCount())
	}

	p.updateConfigModTime()

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
			p.saveState()
			return nil
		case <-ticker.C:
			if newInterval := p.checkConfigReload(ctx); newInterval > 0 {
				ticker.Reset(newInterval)
			}
			p.poll(ctx)
		}
	}
}

// initializeUserCache はユーザー情報をキャッシュに読み込む
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

// updateConfigModTime はconfigファイルの更新時刻を記録する
func (p *Poller) updateConfigModTime() {
	info, err := os.Stat(p.configPath)
	if err != nil {
		return
	}
	p.lastConfigMod = info.ModTime()
}

// checkConfigReload はconfigファイルの変更を検出しリロードする
// ポーリング間隔が変更された場合は新しいintervalを返し、変更なしは0を返す
func (p *Poller) checkConfigReload(ctx context.Context) time.Duration {
	info, err := os.Stat(p.configPath)
	if err != nil {
		return 0
	}

	if !info.ModTime().After(p.lastConfigMod) {
		return 0
	}

	p.lastConfigMod = info.ModTime()

	newCfg, err := config.Load(p.configPath)
	if err != nil {
		slog.Error("設定リロード失敗(現在の設定を維持)", "error", err)
		return 0
	}

	oldInterval := p.cfg.Polling.IntervalSeconds
	oldStreamers := make(map[string]bool, len(p.cfg.Streamers))
	for _, s := range p.cfg.Streamers {
		oldStreamers[strings.ToLower(s.Username)] = true
	}

	p.cfg = newCfg

	newStreamers := make(map[string]bool, len(newCfg.Streamers))
	var newUsernames []string
	for _, s := range newCfg.Streamers {
		key := strings.ToLower(s.Username)
		newStreamers[key] = true
		if !oldStreamers[key] {
			newUsernames = append(newUsernames, s.Username)
		}
	}
	for name := range oldStreamers {
		if !newStreamers[name] {
			delete(p.userCache, name)
			p.stateManager.DeleteState(name)
			slog.Info("配信者を削除", "username", name)
		}
	}
	if len(newUsernames) > 0 {
		users, err := p.api.GetUsers(ctx, newUsernames)
		if err != nil {
			slog.Error("新規配信者のユーザー情報取得失敗", "error", err)
		} else {
			for k, u := range users {
				p.userCache[k] = u
				slog.Info("配信者を追加", "username", u.DisplayName)
			}
		}
	}

	slog.Info("設定をリロードしました", "streamers", len(newCfg.Streamers))

	if newCfg.Polling.IntervalSeconds != oldInterval {
		newInterval := time.Duration(newCfg.Polling.IntervalSeconds) * time.Second
		slog.Info("ポーリング間隔を変更", "old", oldInterval, "new", newCfg.Polling.IntervalSeconds)
		return newInterval
	}

	return 0
}

// saveState は現在の状態をファイルに保存する
func (p *Poller) saveState() {
	if err := p.stateManager.SaveToFile(p.statePath); err != nil {
		slog.Error("状態の保存に失敗", "error", err)
	}
}

// combineChanges はタイトル変更とゲーム変更を同時検出した場合に統合する
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

// buildStreamerState はAPIレスポンスから配信者状態を構築する
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

// collectOfflineUserIDs はオフライン配信者のユーザーIDを収集する
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

// attachVodInfo はOffline変更にVOD情報を付与する
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

// processStreamer は単一配信者の変更を処理し、状態が変化した場合はtrueを返す
func (p *Poller) processStreamer(
	ctx context.Context,
	sc config.StreamerConfig,
	streams map[string]twitch.Stream,
	channels map[string]twitch.Channel,
) bool {
	key := strings.ToLower(sc.Username)
	user, ok := p.userCache[key]
	if !ok {
		return false
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

	changed := isInitialPoll || len(combined) > 0
	p.stateManager.UpdateState(key, newState)
	return changed
}

// poll は全配信者の状態をポーリングして変更を検出する
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

	dirty := false
	for _, sc := range p.cfg.Streamers {
		if p.processStreamer(ctx, sc, streams, channels) {
			dirty = true
		}
	}

	if dirty {
		p.saveState()
	}
}
