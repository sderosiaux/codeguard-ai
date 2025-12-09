# Configuration

## Configuration File

CodeGuard CLI stores configuration in `~/.codeguard.json`:

```json
{
  "api_url": "https://codeguard-ai.vercel.app/api",
  "api_key": "your-api-key"
}
```

## Authentication

### Login

Authenticate with the CodeGuard API:

```bash
codeguard auth login
```

You'll be prompted to enter your API key:

```
Enter your API key: ************************************
✓ Successfully authenticated!

→ You can now run: codeguard scan
```

### Get Your API Key

1. Go to [codeguard-ai.vercel.app/app/settings](https://codeguard-ai.vercel.app/app/settings)
2. Generate a new API key
3. Copy the key and use it with `codeguard auth login`

### Check Status

Verify your authentication:

```bash
codeguard auth status
```

```
✓ Authenticated
  API URL: https://codeguard-ai.vercel.app/api
  API Key: cg_a...xyz
```

### Logout

Remove stored credentials:

```bash
codeguard auth logout
```

## Environment Variables

You can also configure via environment variables:

| Variable | Description |
|----------|-------------|
| `CODEGUARD_API_KEY` | API key for authentication |
| `CODEGUARD_API_URL` | API endpoint URL |

Example:

```bash
export CODEGUARD_API_KEY="your-api-key"
codeguard scan ./my-project
```

## CLI Options

Global options available for all commands:

| Option | Description |
|--------|-------------|
| `--config` | Path to config file (default: `~/.codeguard.json`) |
| `--help, -h` | Show help |
| `--version, -v` | Show version |

## Self-Hosted Configuration

If running a self-hosted instance:

```bash
# Set custom API URL
codeguard auth login
# Then edit ~/.codeguard.json to change api_url
```

Or via environment:

```bash
export CODEGUARD_API_URL="https://your-instance.com/api"
codeguard scan
```
