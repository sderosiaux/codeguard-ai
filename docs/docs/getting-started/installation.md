# Installation

## CLI Installation

### Using Go

The recommended way to install the CodeGuard CLI:

```bash
go install github.com/codeguard-ai/cli@latest
```

### Download Binary

Download pre-built binaries from the [releases page](https://github.com/sderosiaux/codeguard-ai/releases):

=== "macOS (Apple Silicon)"
    ```bash
    curl -L https://github.com/sderosiaux/codeguard-ai/releases/latest/download/codeguard-darwin-arm64 -o codeguard
    chmod +x codeguard
    sudo mv codeguard /usr/local/bin/
    ```

=== "macOS (Intel)"
    ```bash
    curl -L https://github.com/sderosiaux/codeguard-ai/releases/latest/download/codeguard-darwin-amd64 -o codeguard
    chmod +x codeguard
    sudo mv codeguard /usr/local/bin/
    ```

=== "Linux (x64)"
    ```bash
    curl -L https://github.com/sderosiaux/codeguard-ai/releases/latest/download/codeguard-linux-amd64 -o codeguard
    chmod +x codeguard
    sudo mv codeguard /usr/local/bin/
    ```

=== "Windows"
    ```powershell
    Invoke-WebRequest -Uri https://github.com/sderosiaux/codeguard-ai/releases/latest/download/codeguard-windows-amd64.exe -OutFile codeguard.exe
    ```

### Build from Source

```bash
git clone https://github.com/sderosiaux/codeguard-ai.git
cd codeguard-ai/packages/cli
make build
```

## Verify Installation

```bash
codeguard --version
```

You should see output like:

```
CodeGuard AI version 0.1.0
```

## System Requirements

- **Go 1.22+** (for installation via `go install`)
- **macOS**, **Linux**, or **Windows**
- Internet connection (for API calls)

## Next Steps

- [Quick Start Guide](quickstart.md) - Scan your first project
- [Configuration](configuration.md) - Configure the CLI
