# Node.js Project Example

Scanning a Node.js/TypeScript project with CodeGuard AI.

## Project Structure

```
my-express-app/
├── src/
│   ├── routes/
│   │   ├── auth.ts
│   │   ├── users.ts
│   │   └── api.ts
│   ├── middleware/
│   │   └── auth.ts
│   ├── db/
│   │   └── queries.ts
│   └── index.ts
├── package.json
└── tsconfig.json
```

## Running the Scan

```bash
cd my-express-app
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

→ Scanning /Users/dev/my-express-app

✓ Found 12 files to analyze
✓ Analysis complete in 3.8s

┌────────────────────────────────┐
│ Security Report                │
├────────────────────────────────┤
│ Grade: C                       │
│ Files scanned: 12              │
│                                │
│ Critical: 1                    │
│ High:     2                    │
│ Medium:   4                    │
│ Low:      3                    │
└────────────────────────────────┘

src/db/queries.ts
────────────────────────────────────────────────────────
  [CRITICAL] SQL Injection (L23-25)
      User input is directly interpolated into SQL query.
      This allows attackers to execute arbitrary SQL.
      → Use parameterized queries with placeholders

src/routes/auth.ts
────────────────────────────────────────────────────────
  [HIGH] Missing Rate Limiting (L15)
      Login endpoint has no rate limiting protection.
      Vulnerable to brute force attacks.
      → Add rate limiting middleware (e.g., express-rate-limit)

  [HIGH] Weak Password Hashing (L42)
      Using MD5 for password hashing is cryptographically weak.
      → Use bcrypt or argon2 instead

src/routes/users.ts
────────────────────────────────────────────────────────
  [MEDIUM] Missing Input Validation (L8-12)
      User input from request body is not validated.
      → Add validation using zod, joi, or express-validator

  [MEDIUM] Verbose Error Messages (L35)
      Internal error details are exposed to clients.
      → Return generic error messages, log details server-side
```

## Common Issues in Node.js Projects

### SQL Injection

**Vulnerable:**
```typescript
const user = await db.query(
  `SELECT * FROM users WHERE id = ${req.params.id}`
);
```

**Fixed:**
```typescript
const user = await db.query(
  'SELECT * FROM users WHERE id = $1',
  [req.params.id]
);
```

### Missing Rate Limiting

**Vulnerable:**
```typescript
app.post('/login', async (req, res) => {
  // No rate limiting
  const { email, password } = req.body;
  // ...
});
```

**Fixed:**
```typescript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: 'Too many login attempts'
});

app.post('/login', loginLimiter, async (req, res) => {
  // ...
});
```

### XSS via innerHTML

**Vulnerable:**
```typescript
res.send(`<div>${userInput}</div>`);
```

**Fixed:**
```typescript
import { escape } from 'html-escaper';

res.send(`<div>${escape(userInput)}</div>`);
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
          if [[ "$GRADE" == "F" ]]; then
            exit 1
          fi
```

## package.json Script

```json
{
  "scripts": {
    "security": "codeguard scan",
    "security:ci": "codeguard scan --format json"
  }
}
```
