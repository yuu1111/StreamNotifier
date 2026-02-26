// Package cli は設定管理CLIを提供する。
package cli

import (
	"bufio"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/yuu1111/StreamNotifier/internal/config"
)

const configPath = "./config.json"

var scanner *bufio.Scanner

// getScanner はstdin用のscannerを遅延初期化して返す。
func getScanner() *bufio.Scanner {
	if scanner == nil {
		scanner = bufio.NewScanner(os.Stdin)
	}
	return scanner
}

// promptInput はプロンプトを表示しユーザー入力を取得する。
func promptInput(message string) string {
	fmt.Print(message)
	s := getScanner()
	if s.Scan() {
		return strings.TrimSpace(s.Text())
	}
	return ""
}

// validateWebhookURL はWebhook URLの形式を検証する。
func validateWebhookURL(url string) bool {
	return strings.HasPrefix(url, config.WebhookURLPrefix)
}

// getEnabledNotificationTypes は有効な通知タイプを文字列で返す。
func getEnabledNotificationTypes(n config.NotificationSettings) string {
	var types []string
	if n.Online {
		types = append(types, "online")
	}
	if n.Offline {
		types = append(types, "offline")
	}
	if n.TitleChange {
		types = append(types, "title")
	}
	if n.GameChange {
		types = append(types, "game")
	}
	if len(types) == 4 {
		return "全通知"
	}
	return strings.Join(types, ", ")
}

// findStreamer はユーザー名で配信者を検索する。
func findStreamer(streamers []config.StreamerConfig, username string) *config.StreamerConfig {
	lower := strings.ToLower(username)
	for i := range streamers {
		if strings.ToLower(streamers[i].Username) == lower {
			return &streamers[i]
		}
	}
	return nil
}

// findStreamerIndex はユーザー名で配信者のインデックスを検索する。
func findStreamerIndex(streamers []config.StreamerConfig, username string) int {
	lower := strings.ToLower(username)
	for i := range streamers {
		if strings.ToLower(streamers[i].Username) == lower {
			return i
		}
	}
	return -1
}

// defaultNotifications は全通知有効のデフォルト設定を返す。
func defaultNotifications() config.NotificationSettings {
	return config.NotificationSettings{
		Online:      true,
		Offline:     true,
		TitleChange: true,
		GameChange:  true,
	}
}

// addStreamer は配信者を追加する。
func addStreamer(username string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	if findStreamer(cfg.Streamers, username) != nil {
		fmt.Fprintf(os.Stderr, "エラー: %s は既に登録されています\n", username)
		os.Exit(1)
	}

	webhookName := promptInput("Webhook名 (任意): ")
	webhookURL := promptInput("Webhook URL: ")
	if !validateWebhookURL(webhookURL) {
		fmt.Fprintln(os.Stderr, "エラー: 無効なWebhook URLです")
		os.Exit(1)
	}

	newStreamer := config.StreamerConfig{
		Username: username,
		Webhooks: []config.WebhookConfig{
			{
				Name:          webhookName,
				URL:           webhookURL,
				Notifications: defaultNotifications(),
			},
		},
	}

	cfg.Streamers = append(cfg.Streamers, newStreamer)
	if err := config.Save(configPath, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("%s を追加しました\n", username)
}

// removeStreamer は配信者を削除する。
func removeStreamer(username string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	index := findStreamerIndex(cfg.Streamers, username)
	if index == -1 {
		fmt.Fprintf(os.Stderr, "エラー: %s は登録されていません\n", username)
		os.Exit(1)
	}

	cfg.Streamers = append(cfg.Streamers[:index], cfg.Streamers[index+1:]...)
	if err := config.Save(configPath, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("%s を削除しました\n", username)
}

// listStreamers は登録済み配信者一覧を表示する。
func listStreamers() {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	if len(cfg.Streamers) == 0 {
		fmt.Println("登録されている配信者はいません")
		return
	}

	fmt.Println("登録済み配信者:")
	for _, s := range cfg.Streamers {
		fmt.Printf("  - %s (Webhook: %d件)\n", s.Username, len(s.Webhooks))
	}
}

// addWebhook は配信者にWebhookを追加する。
func addWebhook(username string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	streamer := findStreamer(cfg.Streamers, username)
	if streamer == nil {
		fmt.Fprintf(os.Stderr, "エラー: %s は登録されていません\n", username)
		os.Exit(1)
	}

	webhookName := promptInput("Webhook名 (任意): ")
	webhookURL := promptInput("Webhook URL: ")
	if !validateWebhookURL(webhookURL) {
		fmt.Fprintln(os.Stderr, "エラー: 無効なWebhook URLです")
		os.Exit(1)
	}

	for _, w := range streamer.Webhooks {
		if w.URL == webhookURL {
			fmt.Fprintln(os.Stderr, "エラー: このWebhookは既に登録されています")
			os.Exit(1)
		}
	}

	streamer.Webhooks = append(streamer.Webhooks, config.WebhookConfig{
		Name:          webhookName,
		URL:           webhookURL,
		Notifications: defaultNotifications(),
	})

	if err := config.Save(configPath, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("%s にWebhookを追加しました (合計: %d件)\n", username, len(streamer.Webhooks))
}

// removeWebhook は配信者からWebhookを削除する。
func removeWebhook(username string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	streamer := findStreamer(cfg.Streamers, username)
	if streamer == nil {
		fmt.Fprintf(os.Stderr, "エラー: %s は登録されていません\n", username)
		os.Exit(1)
	}

	if len(streamer.Webhooks) == 0 {
		fmt.Fprintln(os.Stderr, "エラー: Webhookが登録されていません")
		os.Exit(1)
	}

	fmt.Println("登録済みWebhook:")
	for i, w := range streamer.Webhooks {
		label := w.Name
		if label == "" {
			label = truncateURL(w.URL, 50)
		}
		enabled := getEnabledNotificationTypes(w.Notifications)
		fmt.Printf("  %d. %s (%s)\n", i+1, label, enabled)
	}

	input := promptInput("削除する番号: ")
	index, err := strconv.Atoi(input)
	if err != nil || index < 1 || index > len(streamer.Webhooks) {
		fmt.Fprintln(os.Stderr, "エラー: 無効な番号です")
		os.Exit(1)
	}
	index-- // 0-based

	streamer.Webhooks = append(streamer.Webhooks[:index], streamer.Webhooks[index+1:]...)
	if err := config.Save(configPath, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("Webhookを削除しました (残り: %d件)\n", len(streamer.Webhooks))
}

// configureWebhook は配信者のWebhook通知設定を変更する。
func configureWebhook(username string) {
	cfg, err := config.Load(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}

	streamer := findStreamer(cfg.Streamers, username)
	if streamer == nil {
		fmt.Fprintf(os.Stderr, "エラー: %s は登録されていません\n", username)
		os.Exit(1)
	}

	if len(streamer.Webhooks) == 0 {
		fmt.Fprintln(os.Stderr, "エラー: Webhookが登録されていません")
		os.Exit(1)
	}

	fmt.Println("登録済みWebhook:")
	for i, w := range streamer.Webhooks {
		label := w.Name
		if label == "" {
			label = truncateURL(w.URL, 50)
		}
		enabled := getEnabledNotificationTypes(w.Notifications)
		fmt.Printf("  %d. %s (%s)\n", i+1, label, enabled)
	}

	input := promptInput("\n設定する番号: ")
	index, err := strconv.Atoi(input)
	if err != nil || index < 1 || index > len(streamer.Webhooks) {
		fmt.Fprintln(os.Stderr, "エラー: 無効な番号です")
		os.Exit(1)
	}
	index-- // 0-based

	w := &streamer.Webhooks[index]
	fmt.Println("\n通知設定 (y/n):")

	onlineInput := promptInput(fmt.Sprintf("  online [%s]: ", boolToYN(w.Notifications.Online)))
	offlineInput := promptInput(fmt.Sprintf("  offline [%s]: ", boolToYN(w.Notifications.Offline)))
	titleInput := promptInput(fmt.Sprintf("  titleChange [%s]: ", boolToYN(w.Notifications.TitleChange)))
	gameInput := promptInput(fmt.Sprintf("  gameChange [%s]: ", boolToYN(w.Notifications.GameChange)))

	w.Notifications = config.NotificationSettings{
		Online:      parseYesNo(onlineInput, w.Notifications.Online),
		Offline:     parseYesNo(offlineInput, w.Notifications.Offline),
		TitleChange: parseYesNo(titleInput, w.Notifications.TitleChange),
		GameChange:  parseYesNo(gameInput, w.Notifications.GameChange),
	}

	if err := config.Save(configPath, cfg); err != nil {
		fmt.Fprintf(os.Stderr, "エラー: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("\nWebhook %d の設定を更新しました\n", index+1)
}

// parseYesNo は入力をboolに変換する。空文字列の場合は現在値を返す。
func parseYesNo(input string, current bool) bool {
	if input == "" {
		return current
	}
	return strings.ToLower(input) == "y"
}

// boolToYN はboolをy/nに変換する。
func boolToYN(b bool) string {
	if b {
		return "y"
	}
	return "n"
}

// truncateURL はURLを指定長で切り詰める。
func truncateURL(s string, maxLen int) string {
	if len(s) <= maxLen {
		return s
	}
	return s[:maxLen] + "..."
}

// getExeName は実行ファイル名を返す。
func getExeName() string {
	return filepath.Base(os.Args[0])
}

// printUsage は使い方を表示する。
func printUsage() {
	exe := getExeName()
	fmt.Printf(`
使い方:
  %s                            監視を開始
  %s add <username>             配信者を追加
  %s remove <username>          配信者を削除
  %s list                       配信者一覧を表示
  %s webhook add <username>     Webhookを追加
  %s webhook remove <username>  Webhookを削除
  %s webhook config <username>  Webhook通知設定を変更
  %s help                       このヘルプを表示
`, exe, exe, exe, exe, exe, exe, exe, exe)
}

// promptUsername はユーザー名を対話的に取得する。
func promptUsername() string {
	username := promptInput("ユーザー名: ")
	if username == "" {
		fmt.Fprintln(os.Stderr, "エラー: ユーザー名を入力してください")
		os.Exit(1)
	}
	return username
}

type menuItem struct {
	key    string
	label  string
	action func()
}

// interactiveMode は対話モードを実行する。
func interactiveMode() {
	items := []menuItem{
		{key: "1", label: "配信者を追加", action: func() { addStreamer(promptUsername()) }},
		{key: "2", label: "配信者を削除", action: func() { removeStreamer(promptUsername()) }},
		{key: "3", label: "配信者一覧を表示", action: func() { listStreamers() }},
		{key: "4", label: "Webhookを追加", action: func() { addWebhook(promptUsername()) }},
		{key: "5", label: "Webhookを削除", action: func() { removeWebhook(promptUsername()) }},
		{key: "6", label: "Webhook通知設定", action: func() { configureWebhook(promptUsername()) }},
	}

	fmt.Println("Stream Notifier CLI")
	fmt.Println()
	for _, item := range items {
		fmt.Printf("%s. %s\n", item.key, item.label)
	}
	fmt.Println("0. 終了")
	fmt.Println()

	choice := promptInput("選択: ")

	if choice == "0" {
		fmt.Println("終了します")
		return
	}

	for _, item := range items {
		if item.key == choice {
			item.action()
			return
		}
	}

	fmt.Fprintln(os.Stderr, "無効な選択です")
	os.Exit(1)
}

// requireUsername はユーザー名引数が必須であることを検証する。
func requireUsername(args []string, index int) string {
	if index >= len(args) || args[index] == "" {
		fmt.Fprintln(os.Stderr, "エラー: ユーザー名を指定してください")
		os.Exit(1)
	}
	return args[index]
}

// Run はCLIを実行する。argsが空の場合は対話モードを起動する。
func Run(args []string) {
	if len(args) == 0 {
		interactiveMode()
		return
	}

	command := args[0]

	switch command {
	case "add":
		addStreamer(requireUsername(args, 1))

	case "remove":
		removeStreamer(requireUsername(args, 1))

	case "list":
		listStreamers()

	case "webhook":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "エラー: webhook add/remove/config を指定してください")
			os.Exit(1)
		}
		switch args[1] {
		case "add":
			addWebhook(requireUsername(args, 2))
		case "remove":
			removeWebhook(requireUsername(args, 2))
		case "config":
			configureWebhook(requireUsername(args, 2))
		default:
			fmt.Fprintln(os.Stderr, "エラー: webhook add/remove/config を指定してください")
			os.Exit(1)
		}

	case "help", "--help", "-h":
		printUsage()

	default:
		fmt.Fprintf(os.Stderr, "不明なコマンド: %s\n", command)
		printUsage()
		os.Exit(1)
	}
}
