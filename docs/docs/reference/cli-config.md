# CLI Configuration

## Configuration File

The CLI stores configuration in `~/.codeguard.json`:

```json
{
  "api_url": "https://codeguard-ai.vercel.app/api",
  "api_key": "your-api-key",
  "team_id": "optional-team-id"
}
```

### Fields

| Field | Type | Description | Required |
|-------|------|-------------|----------|
| `api_url` | string | API endpoint URL | No (has default) |
| `api_key` | string | Authentication key | Yes |
| `team_id` | string | Team identifier | No |

## Environment Variables

Override configuration with environment variables:

| Variable | Description | Priority |
|----------|-------------|----------|
| `CODEGUARD_API_KEY` | API key | Highest |
| `CODEGUARD_API_URL` | API endpoint | Highest |
| `CODEGUARD_CONFIG` | Config file path | Highest |

### Example

```bash
# Use environment variable for CI/CD
export CODEGUARD_API_KEY="${{ secrets.CODEGUARD_API_KEY }}"
codeguard scan
```

## File Scanning Configuration

### Supported Extensions

The scanner automatically detects these file types:

```
.js, .jsx, .ts, .tsx    # JavaScript/TypeScript
.py                      # Python
.go                      # Go
.java                    # Java
.rb                      # Ruby
.php                     # PHP
.c, .cpp, .h, .hpp      # C/C++
.cs                      # C#
.rs                      # Rust
.swift                   # Swift
.kt, .kts               # Kotlin
.scala                   # Scala
.sol                     # Solidity
```

### Ignored Directories

These directories are automatically skipped:

```
node_modules/
vendor/
.git/
.svn/
dist/
build/
target/
__pycache__/
.venv/
venv/
.idea/
.vscode/
coverage/
.next/
.nuxt/
```

### File Size Limits

- Default max file size: **100KB**
- Files larger than this are skipped

## Custom Configuration

### Using a Different Config File

```bash
codeguard --config /path/to/config.json scan
```

### Self-Hosted API

For self-hosted instances, update the API URL:

```bash
# Edit config
cat > ~/.codeguard.json << EOF
{
  "api_url": "https://your-instance.com/api",
  "api_key": "your-key"
}
EOF
```

Or use environment variable:

```bash
export CODEGUARD_API_URL="https://your-instance.com/api"
codeguard scan
```

## Security

### Credential Storage

- API keys are stored in plaintext in the config file
- File permissions are set to `0600` (owner read/write only)
- Consider using environment variables in CI/CD

### Best Practices

1. Never commit `.codeguard.json` to version control
2. Add to `.gitignore`:
   ```
   ~/.codeguard.json
   ```
3. Use environment variables in CI/CD pipelines
4. Rotate API keys periodically
