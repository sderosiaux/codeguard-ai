# Go Project Example

Scanning a Go project with CodeGuard AI.

## Project Structure

```
my-go-api/
├── cmd/
│   └── server/
│       └── main.go
├── internal/
│   ├── handlers/
│   │   ├── auth.go
│   │   └── users.go
│   ├── middleware/
│   │   └── auth.go
│   └── db/
│       └── queries.go
├── go.mod
└── go.sum
```

## Running the Scan

```bash
cd my-go-api
codeguard scan
```

## Example Output

```
   ___          _       ___                     _
  / __\___   __| | ___ / _ \_   _  __ _ _ __ __| |
 / /  / _ \ / _' |/ _ \ /_\/ | | |/ _' | '__/ _' |
/ /__| (_) | (_| |  __/ /_\\| |_| | (_| | | | (_| |
\____/\___/ \__,_|\___\____/ \__,_|\__,_|_|  \__,_|
                                              AI

→ Scanning /Users/dev/my-go-api

✓ Found 7 files to analyze
✓ Analysis complete in 2.4s

┌────────────────────────────────┐
│ Security Report                │
├────────────────────────────────┤
│ Grade: B                       │
│ Files scanned: 7               │
│                                │
│ Critical: 0                    │
│ High:     1                    │
│ Medium:   3                    │
│ Low:      2                    │
└────────────────────────────────┘

internal/db/queries.go
────────────────────────────────────────────────────────
  [HIGH] SQL Injection (L34-36)
      String concatenation in SQL query with user input.
      → Use parameterized queries with placeholders

internal/handlers/auth.go
────────────────────────────────────────────────────────
  [MEDIUM] Unchecked Error (L28)
      Error from password comparison is ignored.
      → Always handle errors explicitly

  [MEDIUM] Weak JWT Secret (L15)
      JWT signing key is hardcoded in source.
      → Load from environment variable

internal/handlers/users.go
────────────────────────────────────────────────────────
  [MEDIUM] Missing Input Validation (L22-25)
      Request body is not validated before use.
      → Add struct validation tags and validator
```

## Common Issues in Go Projects

### SQL Injection

**Vulnerable:**
```go
func GetUser(id string) (*User, error) {
    query := fmt.Sprintf("SELECT * FROM users WHERE id = '%s'", id)
    row := db.QueryRow(query)
    // ...
}
```

**Fixed:**
```go
func GetUser(id string) (*User, error) {
    query := "SELECT * FROM users WHERE id = $1"
    row := db.QueryRow(query, id)
    // ...
}
```

### Unchecked Errors

**Vulnerable:**
```go
func ProcessFile(path string) {
    file, _ := os.Open(path)  // Error ignored!
    defer file.Close()
    // ...
}
```

**Fixed:**
```go
func ProcessFile(path string) error {
    file, err := os.Open(path)
    if err != nil {
        return fmt.Errorf("failed to open file: %w", err)
    }
    defer file.Close()
    // ...
    return nil
}
```

### Hardcoded Secrets

**Vulnerable:**
```go
var jwtSecret = []byte("my-secret-key")

func GenerateToken(userID string) (string, error) {
    token := jwt.New(jwt.SigningMethodHS256)
    return token.SignedString(jwtSecret)
}
```

**Fixed:**
```go
var jwtSecret = []byte(os.Getenv("JWT_SECRET"))

func GenerateToken(userID string) (string, error) {
    if len(jwtSecret) == 0 {
        return "", errors.New("JWT_SECRET not configured")
    }
    token := jwt.New(jwt.SigningMethodHS256)
    return token.SignedString(jwtSecret)
}
```

### Race Conditions

**Vulnerable:**
```go
var counter int

func IncrementCounter() {
    counter++  // Race condition!
}
```

**Fixed:**
```go
var (
    counter int
    mu      sync.Mutex
)

func IncrementCounter() {
    mu.Lock()
    defer mu.Unlock()
    counter++
}

// Or use atomic
var counter int64

func IncrementCounter() {
    atomic.AddInt64(&counter, 1)
}
```

## CI/CD Integration

```yaml
# .github/workflows/security.yml
name: Security Scan

on: [push, pull_request]

jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-go@v5
        with:
          go-version: '1.22'

      - run: go install github.com/codeguard-ai/cli@latest

      - name: Scan
        env:
          CODEGUARD_API_KEY: ${{ secrets.CODEGUARD_API_KEY }}
        run: |
          codeguard scan --format json > results.json
          GRADE=$(cat results.json | jq -r '.grade')
          echo "Security Grade: $GRADE"
          if [[ "$GRADE" == "D" || "$GRADE" == "F" ]]; then
            exit 1
          fi
```

## Makefile Integration

```makefile
.PHONY: security lint test

security:
	codeguard scan

security-ci:
	codeguard scan --format json > security-report.json

# Combine with other checks
check: lint test security
```
