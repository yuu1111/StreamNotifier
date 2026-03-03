// Package monitor は配信者の状態監視と変化検出を提供する。
package monitor

import (
	"strings"
	"sync"
)

// StreamerState は配信者の現在の状態を表す。
type StreamerState struct {
	UserID          string
	Username        string
	DisplayName     string
	ProfileImageURL string
	IsLive          bool
	Title           string
	GameID          string
	GameName        string
	StartedAt       string // ISO 8601 (配信中のみ)
	ThumbnailURL    string // 配信中のみ
	ViewerCount     int
}

// StateManager は配信者状態をin-memoryで管理する。
type StateManager struct {
	mu     sync.RWMutex
	states map[string]StreamerState
}

// NewStateManager はStateManagerインスタンスを作成する。
func NewStateManager() *StateManager {
	return &StateManager{
		states: make(map[string]StreamerState),
	}
}

// GetState は指定ユーザー名の状態を返す。存在しない場合はnilを返す。
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

// UpdateState は指定ユーザー名の状態を更新する。
func (sm *StateManager) UpdateState(username string, state StreamerState) {
	sm.mu.Lock()
	defer sm.mu.Unlock()

	sm.states[strings.ToLower(username)] = state
}

// HasState は指定ユーザー名の状態が存在するか返す。
func (sm *StateManager) HasState(username string) bool {
	sm.mu.RLock()
	defer sm.mu.RUnlock()

	_, ok := sm.states[strings.ToLower(username)]
	return ok
}
