package main

import (
	"context"
	"strings"
	"testing"
	"time"
)

func TestWatchStopInput(t *testing.T) {
	tests := []struct {
		name  string
		input string
	}{
		{name: "control character", input: "\x03"},
		{name: "literal caret C", input: "^C"},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()

			go watchStopInput(strings.NewReader(tt.input), cancel)

			select {
			case <-ctx.Done():
			case <-time.After(time.Second):
				t.Fatal("stop input did not cancel the context")
			}
		})
	}
}
