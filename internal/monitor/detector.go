package monitor

import (
	"github.com/yuu1111/StreamNotifier/internal/config"
)

// DetectedChange は検出された変更イベントを表す。
type DetectedChange struct {
	Type           config.ChangeType
	Streamer       string
	OldValue       string
	NewValue       string
	OldTitle       string
	NewTitle       string
	OldGame        string
	NewGame        string
	StreamStartedAt string
	VodURL         string
	VodThumbnailURL string
	CurrentState   StreamerState
}

// DetectChanges は新旧状態を比較して変更を検出する。
// oldStateがnilの場合は初回ポーリングとして空スライスを返す。
func DetectChanges(oldState *StreamerState, newState StreamerState) []DetectedChange {
	if oldState == nil {
		return nil
	}

	var changes []DetectedChange

	if !oldState.IsLive && newState.IsLive {
		changes = append(changes, DetectedChange{
			Type:         config.ChangeOnline,
			Streamer:     newState.Username,
			CurrentState: newState,
		})
	}

	if oldState.IsLive && !newState.IsLive {
		changes = append(changes, DetectedChange{
			Type:            config.ChangeOffline,
			Streamer:        newState.Username,
			StreamStartedAt: oldState.StartedAt,
			CurrentState:    newState,
		})
	}

	if oldState.Title != newState.Title && newState.Title != "" {
		changes = append(changes, DetectedChange{
			Type:         config.ChangeTitleChange,
			Streamer:     newState.Username,
			OldValue:     oldState.Title,
			NewValue:     newState.Title,
			CurrentState: newState,
		})
	}

	if oldState.GameID != newState.GameID {
		changes = append(changes, DetectedChange{
			Type:         config.ChangeGameChange,
			Streamer:     newState.Username,
			OldValue:     oldState.GameName,
			NewValue:     newState.GameName,
			CurrentState: newState,
		})
	}

	return changes
}
