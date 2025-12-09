# Commands Reference

Complete reference for all CodeGuard CLI commands.

## scan

Scan a directory for security issues.

### Usage

```bash
codeguard scan [path] [flags]
```

### Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `path` | Directory to scan | Current directory (`.`) |

### Flags

| Flag | Short | Description | Default |
|------|-------|-------------|---------|
| `--format` | `-f` | Output format: `pretty`, `json` | `pretty` |
| `--all` | `-a` | Show all issues including low severity | `false` |
| `--help` | `-h` | Show help | |

### Examples

```bash
# Scan current directory
codeguard scan

# Scan specific directory
codeguard scan ./src

# Scan with JSON output
codeguard scan --format json ./my-project

# Show all issues
codeguard scan --all

# Scan and save results
codeguard scan --format json > results.json
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (scan failed, API error, etc.) |

---

## auth

Manage authentication with the CodeGuard API.

### Subcommands

#### auth login

Authenticate with an API key.

```bash
codeguard auth login
```

You will be prompted to enter your API key.

#### auth logout

Remove stored credentials.

```bash
codeguard auth logout
```

#### auth status

Check authentication status.

```bash
codeguard auth status
```

### Examples

```bash
# Login
codeguard auth login
# Enter your API key: ****

# Check status
codeguard auth status
# ✓ Authenticated
#   API URL: https://codeguard-ai.vercel.app/api
#   API Key: cg_a...xyz

# Logout
codeguard auth logout
# ✓ Logged out successfully
```

---

## completion

Generate shell autocompletion scripts.

### Usage

```bash
codeguard completion [shell]
```

### Supported Shells

- `bash`
- `zsh`
- `fish`
- `powershell`

### Examples

```bash
# Bash
codeguard completion bash > /etc/bash_completion.d/codeguard

# Zsh
codeguard completion zsh > "${fpath[1]}/_codeguard"

# Fish
codeguard completion fish > ~/.config/fish/completions/codeguard.fish

# PowerShell
codeguard completion powershell > codeguard.ps1
```

---

## help

Show help for any command.

### Usage

```bash
codeguard help [command]
```

### Examples

```bash
# General help
codeguard help

# Help for scan command
codeguard help scan

# Alternative syntax
codeguard scan --help
```

---

## version

Show version information.

### Usage

```bash
codeguard --version
# or
codeguard -v
```

### Output

```
CodeGuard AI version 0.1.0
```
