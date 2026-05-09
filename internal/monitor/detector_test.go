package monitor

import (
	"testing"

	"github.com/yuu1111/StreamNotifier/internal/config"
)

func TestDetectChanges_OfflineTitleChange_NoNotification(t *testing.T) {
	oldState := &StreamerState{
		Username: "test",
		IsLive:   false,
		Title:    "Old Title",
		GameID:   "100",
		GameName: "Old Game",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   false,
		Title:    "New Title",
		GameID:   "200",
		GameName: "New Game",
	}

	changes := DetectChanges(oldState, newState)

	for _, c := range changes {
		if c.Type == config.ChangeTitleChange {
			t.Error("should not detect title change when both states are offline")
		}
		if c.Type == config.ChangeGameChange {
			t.Error("should not detect game change when both states are offline")
		}
	}
}

func TestDetectChanges_LiveToOffline_NoTitleChange(t *testing.T) {
	oldState := &StreamerState{
		Username:  "test",
		IsLive:    true,
		Title:     "Live Title",
		GameID:    "100",
		GameName:  "Game",
		StartedAt: "2026-03-29T10:00:00Z",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   false,
		Title:    "Changed Offline Title",
		GameID:   "200",
		GameName: "New Game",
	}

	changes := DetectChanges(oldState, newState)

	hasOffline := false
	for _, c := range changes {
		switch c.Type {
		case config.ChangeOffline:
			hasOffline = true
		case config.ChangeTitleChange:
			t.Error("should not detect title change on live→offline transition")
		case config.ChangeGameChange:
			t.Error("should not detect game change on live→offline transition")
		}
	}

	if !hasOffline {
		t.Error("should detect offline event")
	}
}

func TestDetectChanges_LiveTitleChange(t *testing.T) {
	oldState := &StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "Old Title",
		GameID:   "100",
		GameName: "Game",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "New Title",
		GameID:   "100",
		GameName: "Game",
	}

	changes := DetectChanges(oldState, newState)

	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Type != config.ChangeTitleChange {
		t.Errorf("expected titleChange, got %s", changes[0].Type)
	}
	if changes[0].OldValue != "Old Title" {
		t.Errorf("expected old value 'Old Title', got '%s'", changes[0].OldValue)
	}
	if changes[0].NewValue != "New Title" {
		t.Errorf("expected new value 'New Title', got '%s'", changes[0].NewValue)
	}
}

func TestDetectChanges_LiveGameChange(t *testing.T) {
	oldState := &StreamerState{
		Username: "test",
		IsLive:   true,
		GameID:   "100",
		GameName: "Old Game",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   true,
		GameID:   "200",
		GameName: "New Game",
	}

	changes := DetectChanges(oldState, newState)

	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Type != config.ChangeGameChange {
		t.Errorf("expected gameChange, got %s", changes[0].Type)
	}
}

func TestDetectChanges_Online(t *testing.T) {
	oldState := &StreamerState{Username: "test", IsLive: false}
	newState := StreamerState{Username: "test", IsLive: true}

	changes := DetectChanges(oldState, newState)

	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Type != config.ChangeOnline {
		t.Errorf("expected online, got %s", changes[0].Type)
	}
}

func TestDetectChanges_Offline(t *testing.T) {
	oldState := &StreamerState{
		Username:  "test",
		IsLive:    true,
		StartedAt: "2026-03-29T10:00:00Z",
	}
	newState := StreamerState{Username: "test", IsLive: false}

	changes := DetectChanges(oldState, newState)

	if len(changes) != 1 {
		t.Fatalf("expected 1 change, got %d", len(changes))
	}
	if changes[0].Type != config.ChangeOffline {
		t.Errorf("expected offline, got %s", changes[0].Type)
	}
}

func TestDetectChanges_NilOldState(t *testing.T) {
	newState := StreamerState{Username: "test", IsLive: true}

	changes := DetectChanges(nil, newState)

	if changes != nil {
		t.Errorf("expected nil for nil oldState, got %v", changes)
	}
}

func TestDetectChanges_LiveTitleAndGameChange(t *testing.T) {
	oldState := &StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "Old Title",
		GameID:   "100",
		GameName: "Old Game",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "New Title",
		GameID:   "200",
		GameName: "New Game",
	}

	changes := DetectChanges(oldState, newState)

	if len(changes) != 2 {
		t.Fatalf("expected 2 changes (title + game), got %d", len(changes))
	}

	hasTitle, hasGame := false, false
	for _, c := range changes {
		switch c.Type {
		case config.ChangeTitleChange:
			hasTitle = true
		case config.ChangeGameChange:
			hasGame = true
		}
	}
	if !hasTitle {
		t.Error("expected title change")
	}
	if !hasGame {
		t.Error("expected game change")
	}
}

func TestDetectChanges_NoChange(t *testing.T) {
	state := &StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "Same Title",
		GameID:   "100",
		GameName: "Same Game",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "Same Title",
		GameID:   "100",
		GameName: "Same Game",
	}

	changes := DetectChanges(state, newState)

	if len(changes) != 0 {
		t.Errorf("expected 0 changes, got %d", len(changes))
	}
}

func TestDetectChanges_TitleClearedToEmpty_NoNotification(t *testing.T) {
	oldState := &StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "Some Title",
		GameID:   "100",
	}
	newState := StreamerState{
		Username: "test",
		IsLive:   true,
		Title:    "",
		GameID:   "100",
	}

	changes := DetectChanges(oldState, newState)

	for _, c := range changes {
		if c.Type == config.ChangeTitleChange {
			t.Error("should not detect title change when new title is empty")
		}
	}
}
