# Python Project Example

Scanning a Python/Django project with CodeGuard AI.

## Project Structure

```
my-django-app/
├── myapp/
│   ├── views.py
│   ├── models.py
│   ├── urls.py
│   └── utils.py
├── config/
│   ├── settings.py
│   └── urls.py
├── requirements.txt
└── manage.py
```

## Running the Scan

```bash
cd my-django-app
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

→ Scanning /Users/dev/my-django-app

✓ Found 8 files to analyze
✓ Analysis complete in 2.9s

┌────────────────────────────────┐
│ Security Report                │
├────────────────────────────────┤
│ Grade: D                       │
│ Files scanned: 8               │
│                                │
│ Critical: 2                    │
│ High:     3                    │
│ Medium:   2                    │
│ Low:      4                    │
└────────────────────────────────┘

config/settings.py
────────────────────────────────────────────────────────
  [CRITICAL] Debug Mode Enabled (L28)
      DEBUG = True should never be used in production.
      Exposes sensitive information and stack traces.
      → Set DEBUG = False and use environment variable

  [CRITICAL] Hardcoded Secret Key (L23)
      SECRET_KEY is hardcoded in settings file.
      → Move to environment variable

  [HIGH] ALLOWED_HOSTS Not Configured (L31)
      ALLOWED_HOSTS = ['*'] allows any domain.
      → Specify exact allowed hosts

myapp/views.py
────────────────────────────────────────────────────────
  [HIGH] SQL Injection (L45-47)
      Raw SQL query with string formatting.
      → Use Django ORM or parameterized queries

  [HIGH] Unsafe Deserialization (L62)
      Using pickle.loads() on untrusted data.
      → Use JSON or validate pickle source

myapp/utils.py
────────────────────────────────────────────────────────
  [MEDIUM] Weak Random Generation (L12)
      Using random module for security-sensitive operation.
      → Use secrets module instead
```

## Common Issues in Python Projects

### SQL Injection

**Vulnerable:**
```python
def get_user(user_id):
    cursor.execute(f"SELECT * FROM users WHERE id = {user_id}")
```

**Fixed:**
```python
def get_user(user_id):
    cursor.execute("SELECT * FROM users WHERE id = %s", [user_id])

# Or with Django ORM
User.objects.get(id=user_id)
```

### Unsafe Deserialization

**Vulnerable:**
```python
import pickle

def load_data(data):
    return pickle.loads(data)  # Arbitrary code execution!
```

**Fixed:**
```python
import json

def load_data(data):
    return json.loads(data)  # Safe
```

### Weak Cryptography

**Vulnerable:**
```python
import hashlib

def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()
```

**Fixed:**
```python
from passlib.hash import argon2

def hash_password(password):
    return argon2.hash(password)
```

### Hardcoded Secrets

**Vulnerable:**
```python
# settings.py
SECRET_KEY = 'my-super-secret-key-123'
DEBUG = True
```

**Fixed:**
```python
# settings.py
import os

SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')
DEBUG = os.environ.get('DEBUG', 'False') == 'True'
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
          CRITICAL=$(cat results.json | jq '.issues | map(select(.severity == "critical")) | length')
          if [ "$CRITICAL" -gt 0 ]; then
            echo "Found $CRITICAL critical issues"
            exit 1
          fi
```

## Makefile Integration

```makefile
.PHONY: security

security:
	codeguard scan

security-ci:
	codeguard scan --format json > security-report.json
```
