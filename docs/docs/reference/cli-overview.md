# CLI Overview

The CodeGuard CLI is a command-line tool for scanning your codebase for security vulnerabilities.

## Features

- **Fast Scanning** - Async analysis with status polling
- **Multiple Formats** - Pretty output for humans, JSON for CI/CD
- **Offline Detection** - Scans locally, sends to API for analysis
- **Smart Filtering** - Ignores build artifacts, dependencies, etc.

## Installation

```bash
go install github.com/codeguard-ai/cli@latest
```

Or download from [releases](https://github.com/sderosiaux/codeguard-ai/releases).

## Basic Usage

```bash
# Scan current directory
codeguard scan

# Scan specific path
codeguard scan ./src

# JSON output
codeguard scan --format json

# Show all issues including low severity
codeguard scan --all
```

## Command Structure

```
codeguard <command> [subcommand] [flags]
```

### Available Commands

| Command | Description |
|---------|-------------|
| `scan` | Scan a directory for security issues |
| `auth` | Manage authentication |
| `completion` | Generate shell autocompletion |
| `help` | Help about any command |

### Global Flags

| Flag | Description |
|------|-------------|
| `--config` | Config file path (default: `~/.codeguard.json`) |
| `-h, --help` | Show help |
| `-v, --version` | Show version |

## Output Example

```
   ___          _       ___                     _
  / __\___   __| | ___ / _ \_   _  __ _ _ __ __| |
 / /  / _ \ / _' |/ _ \ /_\/ | | |/ _' | '__/ _' |
/ /__| (_) | (_| |  __/ /_\\| |_| | (_| | | | (_| |
\____/\___/ \__,_|\___\____/ \__,_|\__,_|_|  \__,_|
                                              AI

→ Scanning /path/to/project

✓ Found 28 files to analyze
⠋ Running security analysis...
✓ Analysis complete in 4.2s

┌────────────────────────────────┐
│ Security Report                │
├────────────────────────────────┤
│ Grade: B                       │
│ Files scanned: 28              │
│                                │
│ Critical: 0                    │
│ High:     1                    │
│ Medium:   3                    │
│ Low:      5                    │
└────────────────────────────────┘
```

## Next Steps

- [Commands Reference](commands.md) - Detailed command documentation
- [Configuration](cli-config.md) - Configure the CLI
