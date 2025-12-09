# Quick Start

Get up and running with CodeGuard AI in under 5 minutes.

## 1. Install the CLI

```bash
go install github.com/codeguard-ai/cli@latest
```

## 2. Scan Your Project

Navigate to your project directory and run:

```bash
codeguard scan
```

Or specify a path:

```bash
codeguard scan ./path/to/project
```

## 3. View Results

You'll see a security report like this:

```
   ___          _       ___                     _
  / __\___   __| | ___ / _ \_   _  __ _ _ __ __| |
 / /  / _ \ / _' |/ _ \ /_\/ | | |/ _' | '__/ _' |
/ /__| (_) | (_| |  __/ /_\\| |_| | (_| | | | (_| |
\____/\___/ \__,_|\___\____/ \__,_|\__,_|_|  \__,_|
                                              AI

→ Scanning /Users/you/my-project

✓ Found 42 files to analyze
✓ Analysis complete in 3.2s

┌────────────────────────────────────┐
│ Security Report                     │
├────────────────────────────────────┤
│ Grade: B                            │
│ Files scanned: 42                   │
│                                     │
│ Critical: 0                         │
│ High:     2                         │
│ Medium:   5                         │
│ Low:      8                         │
└────────────────────────────────────┘

src/auth/login.ts
────────────────────────────────────────────────────────
  [HIGH] SQL Injection Vulnerability (L45-48)
      User input is directly interpolated into SQL query
      without proper sanitization.
      → Use parameterized queries instead of string concatenation

  [MEDIUM] Missing Rate Limiting (L12)
      Login endpoint has no rate limiting, vulnerable to
      brute force attacks.
      → Implement rate limiting middleware
```

## Output Formats

### Pretty Output (default)

Human-readable output with colors and formatting:

```bash
codeguard scan
```

### JSON Output

For CI/CD integration:

```bash
codeguard scan --format json
```

```json
{
  "grade": "B",
  "filesScanned": 42,
  "issueCount": 15,
  "issues": [
    {
      "severity": "high",
      "title": "SQL Injection Vulnerability",
      "file": "src/auth/login.ts",
      "line": 45,
      "description": "User input is directly interpolated..."
    }
  ]
}
```

## Common Options

| Option | Description |
|--------|-------------|
| `--format, -f` | Output format: `pretty`, `json` |
| `--all, -a` | Show all issues including low severity |
| `--help, -h` | Show help |

## Next Steps

- [Configuration](configuration.md) - Set up API authentication
- [CI/CD Integration](../guides/ci-cd.md) - Add to your pipeline
- [Severity Levels](../concepts/severity-levels.md) - Understand issue severity
