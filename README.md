# CodeGuard AI

**AI-powered security and reliability analysis for your codebase.**

CodeGuard AI scans your GitHub repositories using Claude AI to identify security vulnerabilities, reliability issues, and code quality problems before they reach production.

---

## Why CodeGuard AI?

Traditional static analysis tools rely on pattern matching and predefined rules. CodeGuard AI uses large language models to understand your code contextually—catching subtle issues that rule-based scanners miss.

- **Contextual Understanding**: Analyzes code semantics, not just syntax patterns
- **Natural Language Explanations**: Get clear, actionable remediation guidance
- **Cross-File Analysis**: Understands how components interact across your codebase
- **Zero Configuration**: No rules to write, no false-positive tuning required

---

## What It Detects

### Security Vulnerabilities

| Category | Examples |
|----------|----------|
| **Authentication** | Weak password policies, missing MFA, insecure session management |
| **Authorization** | Broken access controls, privilege escalation, IDOR vulnerabilities |
| **Input Validation** | SQL injection, XSS, command injection, path traversal |
| **Cryptography** | Weak algorithms, hardcoded secrets, improper key management |
| **Data Protection** | PII exposure, insecure data storage, missing encryption |
| **API Security** | Missing rate limiting, insecure endpoints, CORS misconfigurations |

### Reliability Issues

| Category | Examples |
|----------|----------|
| **Error Handling** | Uncaught exceptions, silent failures, missing error boundaries |
| **Resource Management** | Memory leaks, unclosed connections, file handle exhaustion |
| **Async Operations** | Race conditions, unhandled promises, deadlock potential |
| **Data Integrity** | Missing transactions, inconsistent state, validation gaps |
| **Fault Tolerance** | Missing retries, no circuit breakers, cascading failure risks |

### Code Quality

| Category | Examples |
|----------|----------|
| **Performance** | N+1 queries, unnecessary re-renders, blocking operations |
| **Scalability** | Bottlenecks, inefficient algorithms, missing caching |
| **Type Safety** | Unsafe type assertions, missing null checks, any abuse |
| **Maintainability** | Complex functions, tight coupling, missing abstractions |

---

## How It Works

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Import Repo    │────▶│  AI Analysis    │────▶│  Browse Issues  │
│  from GitHub    │     │  with Claude    │     │  in Context     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **Import** — Paste any public GitHub repository URL
2. **Analyze** — Claude AI examines each file for security and reliability issues
3. **Review** — Browse findings in an interactive code viewer with inline annotations
4. **Fix** — Follow AI-generated remediation guidance to resolve issues

---

## Features

### Issue Dashboard
Hierarchical view of all findings organized by category (Security, Reliability, Performance, Code Quality) with severity indicators and quick navigation.

### Interactive Code Browser
Monaco-powered editor with:
- Inline issue highlighting by severity
- Hover cards with issue details and quick fixes
- Minimap markers for rapid navigation
- File tree filtered to show only affected files

### Severity Classification
Issues are classified into four severity levels:
- **Critical** — Immediate security risks, potential for exploitation
- **High** — Significant vulnerabilities requiring prompt attention
- **Medium** — Issues that should be addressed in normal development
- **Low** — Best practice improvements and code quality suggestions

### Smart Filtering
Filter issues by:
- Severity level (critical, high, medium, low)
- Type (security vs reliability)
- Category (authentication, error handling, etc.)
- File or directory

---

## Supported Languages

CodeGuard AI analyzes code in:

- TypeScript / JavaScript
- Python
- Java
- Go
- Rust
- C / C++
- C#
- Ruby
- PHP

---

## Example Findings

### SQL Injection Risk
```typescript
// ❌ Vulnerable
const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);

// ✅ Recommended
const user = await db.query('SELECT * FROM users WHERE id = $1', [userId]);
```
*CodeGuard AI identifies string interpolation in SQL queries and suggests parameterized queries.*

### Unhandled Promise Rejection
```typescript
// ❌ Missing error handling
async function fetchData() {
  const response = await fetch('/api/data');
  return response.json();
}

// ✅ Recommended
async function fetchData() {
  const response = await fetch('/api/data');
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}
```
*CodeGuard AI detects missing error handling for async operations and network requests.*

### Hardcoded Secrets
```typescript
// ❌ Exposed credentials
const apiKey = 'sk-1234567890abcdef';

// ✅ Recommended
const apiKey = process.env.API_KEY;
```
*CodeGuard AI identifies hardcoded API keys, passwords, and tokens in source code.*

---

## Architecture

```
codeguard-ai/
├── packages/
│   ├── frontend/          # React + Vite + Tailwind
│   │   ├── components/    # UI components
│   │   ├── pages/         # Route pages
│   │   └── hooks/         # React Query hooks
│   │
│   └── backend/           # Express + TypeScript
│       ├── routes/        # API endpoints
│       ├── services/      # Business logic
│       └── db/            # Drizzle ORM + PostgreSQL
```

**Tech Stack:**
- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS, Monaco Editor
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM
- **Database**: PostgreSQL
- **AI**: Claude API (Anthropic)

---

## CLI

Scan code directly from your terminal:

```bash
# Install
cd packages/cli && go build -o codeguard .

# Authenticate (get API key from Settings page)
./codeguard auth login

# Scan a directory
./codeguard scan ./my-project
```

---

## Roadmap

### Completed
- [x] **Private repository support** — Add GitHub access tokens for private repos
- [x] **Analysis history** — Track all analysis runs with commit SHA, duration, and trigger info
- [x] **Shareable links** — Generate share links for analysis results
- [x] **Multi-category filtering** — Filter issues by type (security, Kafka, database, etc.)
- [x] **Google OAuth** — Secure authentication with Google accounts
- [x] **Real-time progress** — Live feedback during repository analysis
- [x] **CodeGuard CLI** — Scan code from terminal with API key authentication

### Planned
- [ ] GitHub App integration for automatic PR scanning
- [ ] CI/CD pipeline integration (GitHub Actions, GitLab CI)
- [ ] Custom rule configuration
- [ ] Team collaboration features
- [ ] SARIF export for IDE integration
- [ ] Self-hosted deployment option

---

## License

MIT

---

<p align="center">
  Built with developer love by <a href="https://github.com/sderosiaux">@sderosiaux</a>
</p>
