// Package main はStream Notifierのエントリーポイントを提供する
package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/yuu1111/StreamNotifier/internal/cli"
	"github.com/yuu1111/StreamNotifier/internal/config"
	"github.com/yuu1111/StreamNotifier/internal/discord"
	"github.com/yuu1111/StreamNotifier/internal/monitor"
	"github.com/yuu1111/StreamNotifier/internal/twitch"
)

// ANSI色コード
const (
	colorReset  = "\033[0m"
	colorDim    = "\033[2m"
	colorBright = "\033[1m"
	colorCyan   = "\033[36m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorRed    = "\033[31m"
)

var levelColors = map[slog.Level]string{
	slog.LevelDebug: colorCyan,
	slog.LevelInfo:  colorGreen,
	slog.LevelWarn:  colorYellow,
	slog.LevelError: colorRed,
}

// consoleHandler はANSI色付きのコンソール出力ハンドラ
type consoleHandler struct {
	level slog.Level
	mu    sync.Mutex
	w     io.Writer
}

func (h *consoleHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *consoleHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()

	timestamp := r.Time.Format(time.RFC3339)
	color := levelColors[r.Level]
	levelStr := strings.ToUpper(r.Level.String())
	// 5文字にパディング
	for len(levelStr) < 5 {
		levelStr += " "
	}

	var attrs strings.Builder
	r.Attrs(func(a slog.Attr) bool {
		if a.Key == "error" {
			fmt.Fprintf(&attrs, " %sError: %s%s", colorRed, a.Value.String(), colorReset)
		} else {
			fmt.Fprintf(&attrs, " %s=%s", a.Key, a.Value.String())
		}
		return true
	})

	line := fmt.Sprintf("%s[%s]%s %s%s%s %s%s%s",
		colorDim, timestamp, colorReset,
		color, levelStr, colorReset,
		colorBright, r.Message, colorReset,
	)
	if attrs.Len() > 0 {
		line += attrs.String()
	}

	if r.Level >= slog.LevelWarn {
		_, _ = fmt.Fprintln(os.Stderr, line)
	} else {
		_, _ = fmt.Fprintln(os.Stdout, line)
	}

	return nil
}

func (h *consoleHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

func (h *consoleHandler) WithGroup(name string) slog.Handler {
	return h
}

// fileHandler はJSON形式のファイル出力ハンドラ
type fileHandler struct {
	level  slog.Level
	logDir string
	mu     sync.Mutex
	ensured bool
}

var jst = time.FixedZone("JST", 9*60*60)

// ensureDir はログディレクトリを確保する
func (h *fileHandler) ensureDir() {
	if h.ensured {
		return
	}
	if err := os.MkdirAll(h.logDir, 0755); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to create log directory: %v\n", err)
		return
	}
	h.ensured = true
}

// getDateString はJST日付をYYYY-MM-DD形式で返す
func getDateString() string {
	return time.Now().In(jst).Format("2006-01-02")
}

func (h *fileHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.level
}

func (h *fileHandler) Handle(_ context.Context, r slog.Record) error {
	h.mu.Lock()
	defer h.mu.Unlock()
	h.ensureDir()

	entry := map[string]any{
		"timestamp": r.Time.Format(time.RFC3339),
		"level":     strings.ToLower(r.Level.String()),
		"message":   r.Message,
	}

	metadata := make(map[string]any)
	r.Attrs(func(a slog.Attr) bool {
		metadata[a.Key] = a.Value.Any()
		return true
	})
	if len(metadata) > 0 {
		entry["metadata"] = metadata
	}

	data, err := jsonMarshal(entry)
	if err != nil {
		return err
	}
	logLine := string(data) + "\n"

	dateStr := getDateString()
	appPath := filepath.Join(h.logDir, "app-"+dateStr+".log")
	h.appendToFile(appPath, logLine)

	if r.Level >= slog.LevelError {
		errPath := filepath.Join(h.logDir, "error-"+dateStr+".log")
		h.appendToFile(errPath, logLine)
	}

	return nil
}

func (h *fileHandler) appendToFile(path, line string) {
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to write log to %s: %v\n", path, err)
		return
	}
	defer func() { _ = f.Close() }()
	_, _ = f.WriteString(line)
}

func (h *fileHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return h
}

func (h *fileHandler) WithGroup(name string) slog.Handler {
	return h
}

// jsonMarshal はJSON marshalerのラッパー
func jsonMarshal(v any) ([]byte, error) {
	return json.Marshal(v)
}

// multiHandler は複数のslog.Handlerに同時出力する
type multiHandler struct {
	handlers []slog.Handler
}

func (m *multiHandler) Enabled(ctx context.Context, level slog.Level) bool {
	for _, h := range m.handlers {
		if h.Enabled(ctx, level) {
			return true
		}
	}
	return false
}

func (m *multiHandler) Handle(ctx context.Context, r slog.Record) error {
	for _, h := range m.handlers {
		if h.Enabled(ctx, r.Level) {
			if err := h.Handle(ctx, r); err != nil {
				return err
			}
		}
	}
	return nil
}

func (m *multiHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	handlers := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		handlers[i] = h.WithAttrs(attrs)
	}
	return &multiHandler{handlers: handlers}
}

func (m *multiHandler) WithGroup(name string) slog.Handler {
	handlers := make([]slog.Handler, len(m.handlers))
	for i, h := range m.handlers {
		handlers[i] = h.WithGroup(name)
	}
	return &multiHandler{handlers: handlers}
}

// parseSlogLevel はログレベル文字列をslog.Levelに変換する
func parseSlogLevel(level string) slog.Level {
	switch level {
	case config.LogDebug:
		return slog.LevelDebug
	case config.LogInfo:
		return slog.LevelInfo
	case config.LogWarn:
		return slog.LevelWarn
	case config.LogError:
		return slog.LevelError
	default:
		return slog.LevelInfo
	}
}

// setupLogger はslogのグローバルロガーをセットアップする
func setupLogger(level string) {
	slogLevel := parseSlogLevel(level)

	handler := &multiHandler{
		handlers: []slog.Handler{
			&consoleHandler{level: slogLevel, w: os.Stdout},
			&fileHandler{level: slogLevel, logDir: "./logs"},
		},
	}

	slog.SetDefault(slog.New(handler))
}

func startMonitor() error {
	// コンソールウィンドウのタイトルを設定
	fmt.Print("\033]0;Stream Notifier\007")

	slog.Info("Stream Notifier 起動中...")

	const configPath = "./config.json"
	const statePath = "./data/state.json"

	cfg, err := config.Load(configPath)
	if err != nil {
		return err
	}

	setupLogger(cfg.Log.Level)

	auth := twitch.NewAuth(cfg.Twitch.ClientID, cfg.Twitch.ClientSecret)
	api := twitch.NewAPI(auth, cfg.Twitch.ClientID)

	ctx, stop := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM)
	defer stop()

	poller := monitor.NewPoller(api, cfg, configPath, statePath, func(changes []monitor.DetectedChange, sc config.StreamerConfig) {
		for _, change := range changes {
			embed := discord.BuildEmbed(change)
			streamerInfo := discord.StreamerInfo{
				DisplayName:     change.CurrentState.DisplayName,
				ProfileImageURL: change.CurrentState.ProfileImageURL,
			}

			for _, webhook := range sc.Webhooks {
				if !config.IsNotificationEnabled(change.Type, webhook.Notifications) {
					continue
				}

				webhookLabel := webhook.Name
				if webhookLabel == "" {
					webhookLabel = "Webhook"
				}

				logMsg := fmt.Sprintf("[%s] %s → %s",
					change.CurrentState.DisplayName, change.Type, webhookLabel)
				if change.NewValue != "" {
					logMsg += fmt.Sprintf(" (%s)", change.NewValue)
				}
				slog.Info(logMsg)

				if err := discord.SendWebhook(ctx, webhook.URL, embed, streamerInfo); err != nil {
					slog.Error("Webhook送信失敗", "error", err)
				}
			}
		}
	})

	return poller.Run(ctx)
}

func main() {
	args := os.Args[1:]

	// 引数なし or "run" → 監視開始
	if len(args) == 0 || args[0] == "run" {
		// 起動前にデフォルトロガーをセットアップ(設定読み込み前のログ用)
		setupLogger(config.LogInfo)

		if err := startMonitor(); err != nil {
			slog.Error("致命的なエラー", "error", err)
			os.Exit(1)
		}
		return
	}

	// その他 → CLI
	cli.Run(args)
}
