package monitor

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/yuu1111/StreamNotifier/internal/config"
	"github.com/yuu1111/StreamNotifier/internal/twitch"
)

// mockAPI はTwitchAPIのmock実装
type mockAPI struct {
	users    map[string]twitch.User
	streams  map[string]twitch.Stream
	channels map[string]twitch.Channel
	vod      *twitch.Video
}

func newMockAPI() *mockAPI {
	return &mockAPI{
		users:    make(map[string]twitch.User),
		streams:  make(map[string]twitch.Stream),
		channels: make(map[string]twitch.Channel),
	}
}

func (m *mockAPI) GetUsers(_ context.Context, logins []string) (map[string]twitch.User, error) {
	result := make(map[string]twitch.User)
	for _, login := range logins {
		if u, ok := m.users[login]; ok {
			result[login] = u
		}
	}
	return result, nil
}

func (m *mockAPI) GetStreams(_ context.Context, _ []string) (map[string]twitch.Stream, error) {
	return m.streams, nil
}

func (m *mockAPI) GetChannels(_ context.Context, _ []string) (map[string]twitch.Channel, error) {
	return m.channels, nil
}

func (m *mockAPI) GetLatestVod(_ context.Context, _ string) (*twitch.Video, error) {
	return m.vod, nil
}

func newTestConfig(streamers ...string) *config.Config {
	var sc []config.StreamerConfig
	for _, s := range streamers {
		sc = append(sc, config.StreamerConfig{
			Username: s,
			Webhooks: []config.WebhookConfig{
				{
					URL:           "https://discord.com/api/webhooks/test/test",
					Notifications: config.NotificationSettings{Online: true, Offline: true, TitleChange: true, GameChange: true},
				},
			},
		})
	}
	return &config.Config{
		Twitch:    config.TwitchConfig{ClientID: "test", ClientSecret: "test"},
		Polling:   config.PollingConfig{IntervalSeconds: 10},
		Streamers: sc,
		Log:       config.LogConfig{Level: "info"},
	}
}

func TestPoller_Poll_DetectsOnline(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "Hello!",
		GameID:    "100",
		GameName:  "Game",
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	ctx := context.Background()
	poller.poll(ctx)

	// 初回ポーリングではprocessStreamerがonline通知を追加する
	hasOnline := false
	for _, c := range received {
		if c.Type == config.ChangeOnline {
			hasOnline = true
		}
	}
	if !hasOnline {
		t.Error("expected online notification on first poll with live streamer")
	}
}

func TestPoller_Poll_DetectsOffline(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.channels["streamer1"] = twitch.Channel{BroadcasterLogin: "streamer1", Title: "Offline", GameID: "100"}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	// 事前に配信中状態を設定
	poller.stateManager.UpdateState("streamer1", StreamerState{
		UserID:   "1",
		Username: "streamer1",
		IsLive:   true,
		Title:    "Live Stream",
		GameID:   "100",
	})

	ctx := context.Background()
	poller.poll(ctx)

	hasOffline := false
	for _, c := range received {
		if c.Type == config.ChangeOffline {
			hasOffline = true
		}
	}
	if !hasOffline {
		t.Error("expected offline notification when streamer goes offline")
	}
}

func TestPoller_Poll_TitleChangeWhileLive(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "New Title",
		GameID:    "100",
		GameName:  "Game",
	}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	// 事前に配信中状態を設定(旧タイトル)
	poller.stateManager.UpdateState("streamer1", StreamerState{
		UserID:   "1",
		Username: "streamer1",
		IsLive:   true,
		Title:    "Old Title",
		GameID:   "100",
		GameName: "Game",
	})

	ctx := context.Background()
	poller.poll(ctx)

	hasTitleChange := false
	for _, c := range received {
		if c.Type == config.ChangeTitleChange {
			hasTitleChange = true
			if c.OldValue != "Old Title" || c.NewValue != "New Title" {
				t.Errorf("unexpected title change values: %s → %s", c.OldValue, c.NewValue)
			}
		}
	}
	if !hasTitleChange {
		t.Error("expected title change notification")
	}
}

func TestPoller_Poll_NoTitleChangeWhenGoingOffline(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.channels["streamer1"] = twitch.Channel{BroadcasterLogin: "streamer1", Title: "Different Title", GameID: "200"}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	poller.stateManager.UpdateState("streamer1", StreamerState{
		UserID:   "1",
		Username: "streamer1",
		IsLive:   true,
		Title:    "Original Title",
		GameID:   "100",
	})

	ctx := context.Background()
	poller.poll(ctx)

	for _, c := range received {
		if c.Type == config.ChangeTitleChange {
			t.Error("should not detect title change on live→offline transition")
		}
		if c.Type == config.ChangeGameChange {
			t.Error("should not detect game change on live→offline transition")
		}
	}
}

func TestPoller_Poll_SavesStateToDisk(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "Live!",
		GameID:    "100",
		GameName:  "Game",
	}

	cfg := newTestConfig("streamer1")

	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), statePath,
		func(_ []DetectedChange, _ config.StreamerConfig) {})
	poller.userCache = api.users

	ctx := context.Background()
	poller.poll(ctx)

	data, err := os.ReadFile(statePath)
	if err != nil {
		t.Fatalf("state file should exist after poll: %v", err)
	}

	var states map[string]StreamerState
	if err := json.Unmarshal(data, &states); err != nil {
		t.Fatalf("state file should be valid JSON: %v", err)
	}

	s, ok := states["streamer1"]
	if !ok {
		t.Fatal("streamer1 state not found in saved file")
	}
	if !s.IsLive {
		t.Error("expected streamer1 to be live in saved state")
	}
	if s.Title != "Live!" {
		t.Errorf("expected title 'Live!', got '%s'", s.Title)
	}
}

func TestPoller_Poll_RestoresStateOnRestart(t *testing.T) {
	dir := t.TempDir()
	statePath := filepath.Join(dir, "state.json")

	// 前回のセッションをシミュレート: 状態ファイルに配信中の状態を書き込む
	previousState := map[string]StreamerState{
		"streamer1": {
			UserID:      "1",
			Username:    "streamer1",
			DisplayName: "Streamer1",
			IsLive:      true,
			Title:       "Previous Stream",
			GameID:      "100",
			GameName:    "Game",
		},
	}
	data, _ := json.MarshalIndent(previousState, "", "  ")
	os.WriteFile(statePath, data, 0644)

	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "Previous Stream",
		GameID:    "100",
		GameName:  "Game",
	}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), statePath,
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})

	// 状態を復元
	if err := poller.stateManager.LoadFromFile(statePath); err != nil {
		t.Fatalf("LoadFromFile failed: %v", err)
	}
	poller.userCache = api.users

	ctx := context.Background()
	poller.poll(ctx)

	// 状態が復元されていれば、同じ配信に対してonline通知は出ない
	for _, c := range received {
		if c.Type == config.ChangeOnline {
			t.Error("should not fire online notification after state restore for same stream")
		}
	}
}

func TestPoller_ConfigReload_AddsAndRemovesStreamers(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")

	// 初期config: streamer1のみ
	initialCfg := newTestConfig("streamer1")
	data, _ := json.MarshalIndent(initialCfg, "", "  ")
	os.WriteFile(configPath, data, 0644)

	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.users["streamer2"] = twitch.User{ID: "2", Login: "streamer2", DisplayName: "Streamer2"}

	poller := NewPoller(api, initialCfg, configPath, filepath.Join(dir, "state.json"),
		func(_ []DetectedChange, _ config.StreamerConfig) {})
	poller.userCache = map[string]twitch.User{
		"streamer1": api.users["streamer1"],
	}
	poller.stateManager.UpdateState("streamer1", StreamerState{Username: "streamer1"})
	poller.updateConfigModTime()

	// configを更新: streamer1を削除、streamer2を追加
	updatedCfg := newTestConfig("streamer2")
	updatedCfg.Polling.IntervalSeconds = 20
	data, _ = json.MarshalIndent(updatedCfg, "", "  ")
	os.WriteFile(configPath, data, 0644)

	// lastConfigModを過去に設定してリロードを強制
	poller.lastConfigMod = time.Time{}

	ctx := context.Background()
	newInterval := poller.checkConfigReload(ctx)

	// streamer1が削除されていること
	if poller.stateManager.HasState("streamer1") {
		t.Error("streamer1 state should be deleted after config reload")
	}
	if _, ok := poller.userCache["streamer1"]; ok {
		t.Error("streamer1 should be removed from user cache")
	}

	// streamer2が追加されていること
	if _, ok := poller.userCache["streamer2"]; !ok {
		t.Error("streamer2 should be added to user cache")
	}

	// ポーリング間隔が変更されていること
	expectedInterval := 20 * time.Second
	if newInterval != expectedInterval {
		t.Errorf("expected new interval %v, got %v", expectedInterval, newInterval)
	}

	// configが更新されていること
	if len(poller.cfg.Streamers) != 1 || poller.cfg.Streamers[0].Username != "streamer2" {
		t.Error("config should be updated to new streamers")
	}
}

func TestPoller_ConfigReload_NoChangeWhenFileUnmodified(t *testing.T) {
	dir := t.TempDir()
	configPath := filepath.Join(dir, "config.json")

	cfg := newTestConfig("streamer1")
	data, _ := json.MarshalIndent(cfg, "", "  ")
	os.WriteFile(configPath, data, 0644)

	api := newMockAPI()

	poller := NewPoller(api, cfg, configPath, filepath.Join(dir, "state.json"),
		func(_ []DetectedChange, _ config.StreamerConfig) {})
	poller.updateConfigModTime()

	ctx := context.Background()
	newInterval := poller.checkConfigReload(ctx)

	if newInterval != 0 {
		t.Errorf("expected 0 interval (no change), got %v", newInterval)
	}
}

func TestPoller_CombineChanges_TitleAndGame(t *testing.T) {
	changes := []DetectedChange{
		{Type: config.ChangeTitleChange, OldValue: "OldT", NewValue: "NewT"},
		{Type: config.ChangeGameChange, OldValue: "OldG", NewValue: "NewG"},
	}

	combined := combineChanges(changes)

	if len(combined) != 1 {
		t.Fatalf("expected 1 combined change, got %d", len(combined))
	}
	if combined[0].Type != config.ChangeTitleAndGame {
		t.Errorf("expected titleAndGameChange, got %s", combined[0].Type)
	}
	if combined[0].OldTitle != "OldT" || combined[0].NewTitle != "NewT" {
		t.Error("combined change should preserve title values")
	}
	if combined[0].OldGame != "OldG" || combined[0].NewGame != "NewG" {
		t.Error("combined change should preserve game values")
	}
}

func TestPoller_Poll_EmptyTitleAndGame_HeldThenRecovered(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	// 1ポーリング目: Twitch APIが空のtitle/gameIDを返す(グリッチ)
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "",
		GameID:    "",
		GameName:  "",
	}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	poller.stateManager.UpdateState("streamer1", StreamerState{
		UserID:   "1",
		Username: "streamer1",
		IsLive:   true,
		Title:    "Real Title",
		GameID:   "100",
		GameName: "Real Game",
	})

	ctx := context.Background()
	poller.poll(ctx)

	if len(received) != 0 {
		t.Errorf("first poll with both empty should not notify, got %d changes", len(received))
	}
	if !poller.emptyPending["streamer1"] {
		t.Error("streamer1 should be in emptyPending after first empty poll")
	}

	// 2ポーリング目: 値が復帰
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "Real Title",
		GameID:    "100",
		GameName:  "Real Game",
	}
	received = nil
	poller.poll(ctx)

	if len(received) != 0 {
		t.Errorf("second poll after recovery should not notify, got %d changes", len(received))
	}
	if poller.emptyPending["streamer1"] {
		t.Error("streamer1 should be cleared from emptyPending after recovery")
	}
}

func TestPoller_Poll_EmptyTitleAndGame_ConfirmedAfterTwoPolls(t *testing.T) {
	api := newMockAPI()
	api.users["streamer1"] = twitch.User{ID: "1", Login: "streamer1", DisplayName: "Streamer1"}
	api.streams["streamer1"] = twitch.Stream{
		UserLogin: "streamer1",
		Title:     "",
		GameID:    "",
		GameName:  "",
	}

	cfg := newTestConfig("streamer1")

	var received []DetectedChange
	dir := t.TempDir()

	poller := NewPoller(api, cfg, filepath.Join(dir, "config.json"), filepath.Join(dir, "state.json"),
		func(changes []DetectedChange, _ config.StreamerConfig) {
			received = append(received, changes...)
		})
	poller.userCache = api.users

	poller.stateManager.UpdateState("streamer1", StreamerState{
		UserID:   "1",
		Username: "streamer1",
		IsLive:   true,
		Title:    "Real Title",
		GameID:   "100",
		GameName: "Real Game",
	})

	ctx := context.Background()
	// 1回目: 保留
	poller.poll(ctx)
	if len(received) != 0 {
		t.Errorf("first poll should not notify, got %d", len(received))
	}

	// 2回目: 同じく両方空 → 確定して通知
	received = nil
	poller.poll(ctx)

	hasGameChange := false
	for _, c := range received {
		if c.Type == config.ChangeGameChange {
			hasGameChange = true
			if c.NewValue != "" {
				t.Errorf("expected empty new game, got %q", c.NewValue)
			}
		}
	}
	if !hasGameChange {
		t.Error("second poll with persisting empty values should fire game change")
	}
}

func TestPoller_CombineChanges_OnlyTitle(t *testing.T) {
	changes := []DetectedChange{
		{Type: config.ChangeTitleChange, OldValue: "Old", NewValue: "New"},
	}

	combined := combineChanges(changes)

	if len(combined) != 1 {
		t.Fatalf("expected 1 change, got %d", len(combined))
	}
	if combined[0].Type != config.ChangeTitleChange {
		t.Errorf("expected titleChange (not combined), got %s", combined[0].Type)
	}
}
