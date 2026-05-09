package monitor

import (
	"os"
	"path/filepath"
	"testing"
)

func TestSaveAndLoadState(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")

	sm := NewStateManager()
	sm.UpdateState("streamer1", StreamerState{
		UserID:      "123",
		Username:    "streamer1",
		DisplayName: "Streamer1",
		IsLive:      true,
		Title:       "Test Stream",
		GameID:      "456",
		GameName:    "Game1",
		StartedAt:   "2026-03-29T10:00:00Z",
	})
	sm.UpdateState("streamer2", StreamerState{
		UserID:      "789",
		Username:    "streamer2",
		DisplayName: "Streamer2",
		IsLive:      false,
		Title:       "Offline Title",
	})

	if err := sm.SaveToFile(path); err != nil {
		t.Fatalf("SaveToFile failed: %v", err)
	}

	sm2 := NewStateManager()
	if err := sm2.LoadFromFile(path); err != nil {
		t.Fatalf("LoadFromFile failed: %v", err)
	}

	if sm2.stateCount() != 2 {
		t.Errorf("expected 2 states, got %d", sm2.stateCount())
	}

	s1 := sm2.GetState("streamer1")
	if s1 == nil {
		t.Fatal("streamer1 state not found after load")
	}
	if s1.DisplayName != "Streamer1" {
		t.Errorf("expected DisplayName Streamer1, got %s", s1.DisplayName)
	}
	if !s1.IsLive {
		t.Error("expected streamer1 to be live")
	}
	if s1.Title != "Test Stream" {
		t.Errorf("expected title 'Test Stream', got '%s'", s1.Title)
	}
	if s1.GameName != "Game1" {
		t.Errorf("expected game 'Game1', got '%s'", s1.GameName)
	}

	s2 := sm2.GetState("streamer2")
	if s2 == nil {
		t.Fatal("streamer2 state not found after load")
	}
	if s2.IsLive {
		t.Error("expected streamer2 to be offline")
	}
}

func TestLoadFromFile_NotExists(t *testing.T) {
	sm := NewStateManager()
	err := sm.LoadFromFile(filepath.Join(t.TempDir(), "nonexistent.json"))
	if err != nil {
		t.Errorf("expected nil error for nonexistent file, got: %v", err)
	}
	if sm.stateCount() != 0 {
		t.Errorf("expected 0 states, got %d", sm.stateCount())
	}
}

func TestSaveToFile_Atomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "state.json")

	sm := NewStateManager()
	sm.UpdateState("test", StreamerState{Username: "test", IsLive: true})

	if err := sm.SaveToFile(path); err != nil {
		t.Fatalf("SaveToFile failed: %v", err)
	}

	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Error("temp file should not exist after save")
	}
}

func TestDeleteState(t *testing.T) {
	sm := NewStateManager()
	sm.UpdateState("test", StreamerState{Username: "test"})

	if !sm.HasState("test") {
		t.Fatal("expected state to exist")
	}

	sm.DeleteState("test")

	if sm.HasState("test") {
		t.Error("expected state to be deleted")
	}
}

func TestStateManager_CaseInsensitive(t *testing.T) {
	sm := NewStateManager()
	sm.UpdateState("testuser", StreamerState{Username: "testuser", DisplayName: "TestUser"})

	// GetStateは大文字小文字を区別せずに取得できること
	if s := sm.GetState("TESTUSER"); s == nil {
		t.Error("expected to find state with uppercase key")
	}
	if s := sm.GetState("TestUser"); s == nil {
		t.Error("expected to find state with mixed case key")
	}

	// HasState/DeleteStateも同様
	if !sm.HasState("TESTUSER") {
		t.Error("HasState should be case-insensitive")
	}
	sm.DeleteState("TESTUSER")
	if sm.HasState("testuser") {
		t.Error("DeleteState should work case-insensitively")
	}
}
