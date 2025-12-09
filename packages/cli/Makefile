.PHONY: build clean install test lint

VERSION := 0.1.0
BUILD := $(shell git rev-parse --short HEAD 2>/dev/null || echo "dev")
LDFLAGS := -ldflags "-X main.version=$(VERSION) -X main.build=$(BUILD)"

# Build binary
build:
	go build $(LDFLAGS) -o codeguard .

# Build for all platforms
build-all:
	GOOS=darwin GOARCH=amd64 go build $(LDFLAGS) -o dist/codeguard-darwin-amd64 .
	GOOS=darwin GOARCH=arm64 go build $(LDFLAGS) -o dist/codeguard-darwin-arm64 .
	GOOS=linux GOARCH=amd64 go build $(LDFLAGS) -o dist/codeguard-linux-amd64 .
	GOOS=linux GOARCH=arm64 go build $(LDFLAGS) -o dist/codeguard-linux-arm64 .
	GOOS=windows GOARCH=amd64 go build $(LDFLAGS) -o dist/codeguard-windows-amd64.exe .

# Install to GOPATH/bin
install:
	go install $(LDFLAGS) .

# Clean build artifacts
clean:
	rm -f codeguard
	rm -rf dist/

# Run tests
test:
	go test -v ./...

# Run linter
lint:
	golangci-lint run

# Development build with race detector
dev:
	go build -race $(LDFLAGS) -o codeguard .
