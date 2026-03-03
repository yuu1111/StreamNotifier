BINARY_NAME := stream-notifier
CMD_PATH := ./cmd/stream-notifier
OUT_DIR := out

.PHONY: build build-all build-linux build-windows build-darwin lint test clean

build:
	go build -o $(BINARY_NAME) $(CMD_PATH)

build-all: build-linux build-windows build-darwin

build-linux:
	GOOS=linux GOARCH=amd64 go build -o $(OUT_DIR)/$(BINARY_NAME)-linux-x64 $(CMD_PATH)

build-windows:
	GOOS=windows GOARCH=amd64 go build -o $(OUT_DIR)/$(BINARY_NAME)-windows-x64.exe $(CMD_PATH)

build-darwin:
	GOOS=darwin GOARCH=amd64 go build -o $(OUT_DIR)/$(BINARY_NAME)-darwin-x64 $(CMD_PATH)

lint:
	golangci-lint run ./...

test:
	go test ./...

clean:
	rm -f $(BINARY_NAME) $(BINARY_NAME).exe
	rm -rf $(OUT_DIR)
