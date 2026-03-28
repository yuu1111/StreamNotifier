// Package monitor は配信者の状態監視と変化検出を提供する
package monitor

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
)

// StreamerState は配信者の現在の状態を表す
type StreamerState struct {
	UserID          string `json:"userId"`
	Username        string `json:"username"`
	DisplayName     string `json:"displayName"`
	ProfileImageURL string `json:"profileImageUrl"`
	IsLive          bool   `json:"isLive"`
	Title           string `json:"title"`
	GameID          string `json:"gameId"`
	GameName        string `json:"gameName"`
	StartedAt       string `json:"startedAt,omitempty"`  // ISO 8601 (配信中のみ)
	ThumbnailURL    string `json:"thumbnailUrl,omitempty"` // 配信中のみ
	ViewerCount     int    `json:"viewerCount,omitempty"`
}

// StateManager は配信者状態をin-memoryで管理する
type StateManager struct {
	mu     sync.RWMutex
	states map[string]StreamerState
}

// NewStateManager はStateManagerインスタンスを作成する
func NewStateManager() *StateManager {
	return &StateManager{
		states: make(map[string]StreamerState),
	}
}

// GetState は指定ユーザー名の状態を返す。存在しない場合はnilを返す
func (sm *StateManager) GetState(username string) *StreamerState {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	key := strings.ToLower(username)
	state, ok := sm.states[key]
	if !ok {
		return nil
	}
	return &state
}

// UpdateState は指定ユーザー名の状態を更新する
func (sm *StateManager) UpdateState(username string, state StreamerState) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.states[strings.ToLower(username)] = state
}

// HasState は指定ユーザー名の状態が存在するか返す
func (sm *StateManager) HasState(username string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	_, ok := sm.states[strings.ToLower(username)]
	return ok
}

// stateCount は保持している状態数を返す
func (sm *StateManager) stateCount() int {
	sm.mu.RLock()
	defer sm.mu.RUnlock()
	return len(sm.states)
}

// DeleteState は指定ユーザー名の状態を削除する
func (sm *StateManager) DeleteState(username string) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	delete(sm.states, strings.ToLower(username))
}

// SaveToFile は全状態をJSONファイルに保存する
// 一時ファイルに書き込んでからリネームすることでアトミックに書き込む
func (sm *StateManager) SaveToFile(path string) error {
	sm.mu.RLock()
	snapshot := make(map[string]StreamerState, len(sm.states))
	for k, v := range sm.states {
		snapshot[k] = v
	}
	sm.mu.RUnlock()

	data, err := json.MarshalIndent(snapshot, "", "  ")
	if err != nil {
		return fmt.Errorf("状態のJSON変換に失敗: %w", err)
	}

	tmpPath := path + ".tmp"
	if err := os.WriteFile(tmpPath, data, 0644); err != nil {
		return fmt.Errorf("状態の一時ファイル書き込みに失敗: %w", err)
	}

	if err := os.Rename(tmpPath, path); err != nil {
		return fmt.Errorf("状態ファイルのリネームに失敗: %w", err)
	}

	return nil
}

// LoadFromFile はJSONファイルから状態を復元する
// ファイルが存在しない場合はエラーなしで空状態のまま返す
func (sm *StateManager) LoadFromFile(path string) error {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("状態ファイルの読み込みに失敗: %w", err)
	}

	var loaded map[string]StreamerState
	if err := json.Unmarshal(data, &loaded); err != nil {
		return fmt.Errorf("状態ファイルのJSON解析に失敗: %w", err)
	}

	sm.mu.Lock()
	defer sm.mu.Unlock()

	for k, v := range loaded {
		sm.states[k] = v
	}

	return nil
}
