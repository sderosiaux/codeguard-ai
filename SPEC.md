# CodeGuard AI - Specification v2

## Overview

AI-powered codebase security and reliability analysis platform. Users add public GitHub repositories, which triggers automated analysis using Claude Code. Results are displayed in an interactive code browser with issues highlighted directly in the source.

## User Flow

1. User opens homepage → sees list of analyzed repositories
2. User adds a GitHub repo URL (public only)
3. System clones repo, launches Claude Code analysis (security + reliability in parallel)
4. User sees analysis progress in real-time (status: pending → analyzing → completed/failed)
5. User clicks on a repo → opens code browser with Monaco editor
6. Files with issues are marked in the file tree
7. Clicking a file shows code with problematic lines highlighted
8. Hovering/clicking highlighted lines shows issue details (severity, description, remediation)
9. User can trigger "Recheck" to re-run analysis on existing repo

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Frontend (React)                        │
│  ┌──────────────┐  ┌──────────────────────────────────────────┐ │
│  │  Repo List   │  │           Code Browser                   │ │
│  │  - Add repo  │  │  ┌────────┐ ┌──────────────────────────┐ │ │
│  │  - Status    │  │  │ File   │ │ Monaco Editor            │ │ │
│  │  - Issues #  │  │  │ Tree   │ │ - Syntax highlighting    │ │ │
│  │  - Recheck   │  │  │        │ │ - Issue decorations      │ │ │
│  └──────────────┘  │  │        │ │ - Hover tooltips         │ │ │
│                    │  └────────┘ └──────────────────────────┘ │ │
│                    └──────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      Backend (Node.js)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ REST API    │  │ Job Queue   │  │ Claude Code Orchestrator│  │
│  │ /repos      │  │ (in-memory) │  │ - Clone repo            │  │
│  │ /files      │  │             │  │ - Run analysis          │  │
│  │ /issues     │  │             │  │ - Parse JSON output     │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                      PostgreSQL                                 │
│  repositories, issues, analysis_runs                            │
└─────────────────────────────────────────────────────────────────┘
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | React 18, TypeScript, Vite |
| UI Components | shadcn/ui, Tailwind CSS |
| Code Editor | Monaco Editor |
| Backend | Node.js, Express, TypeScript |
| Database | PostgreSQL 16 |
| ORM | Drizzle ORM |
| AI Engine | Claude Code CLI (spawned as subprocess) |
| Dev Environment | Docker Compose (PostgreSQL) |
| Monorepo | pnpm workspaces |

## Database Schema

```sql
-- Repositories table
CREATE TABLE repositories (
  id SERIAL PRIMARY KEY,
  github_url TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  owner TEXT NOT NULL,
  default_branch TEXT DEFAULT 'main',
  status TEXT DEFAULT 'pending', -- pending, cloning, analyzing, completed, failed
  error_message TEXT,
  local_path TEXT,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Analysis runs table
CREATE TABLE analysis_runs (
  id SERIAL PRIMARY KEY,
  repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'security' | 'reliability'
  status TEXT DEFAULT 'pending', -- pending, running, completed, failed
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  error_message TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Issues table
CREATE TABLE issues (
  id SERIAL PRIMARY KEY,
  repository_id INTEGER REFERENCES repositories(id) ON DELETE CASCADE,
  analysis_run_id INTEGER REFERENCES analysis_runs(id) ON DELETE CASCADE,
  type TEXT NOT NULL, -- 'security' | 'reliability'
  issue_id TEXT NOT NULL, -- e.g., 'SEC-001', 'REL-042'
  severity TEXT NOT NULL, -- 'critical' | 'high' | 'medium' | 'low'
  category TEXT NOT NULL, -- e.g., 'injection', 'race-condition', 'auth'
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT NOT NULL,
  line_start INTEGER NOT NULL,
  line_end INTEGER,
  code_snippet TEXT,
  remediation TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_issues_repository ON issues(repository_id);
CREATE INDEX idx_issues_file ON issues(repository_id, file_path);
CREATE INDEX idx_analysis_runs_repository ON analysis_runs(repository_id);
```

## API Endpoints

### Repositories

```
GET    /api/repos                    # List all repositories with issue counts
POST   /api/repos                    # Add new repository { github_url }
GET    /api/repos/:id                # Get repository details
POST   /api/repos/:id/recheck        # Trigger re-analysis
DELETE /api/repos/:id                # Remove repository
```

### Files

```
GET    /api/repos/:id/files          # Get file tree structure
GET    /api/repos/:id/files/*path    # Get file content
```

### Issues

```
GET    /api/repos/:id/issues         # List all issues for repo (filterable)
GET    /api/repos/:id/issues/by-file # Issues grouped by file path
```

## Claude Code Integration

### Execution Model

The backend spawns Claude Code CLI as a subprocess:

```typescript
import { spawn } from 'child_process';

const claude = spawn('claude', [
  '--print',           // Non-interactive mode
  '-p', prompt,        // The analysis prompt
], {
  cwd: repoPath,       // Run in cloned repo directory
  env: {
    ...process.env,
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY
  }
});
```

### Analysis Prompts

Two analysis types run in parallel. Each prompt is detailed and follows a phased approach.

---

#### Security Analysis Prompt

```markdown
# Security Assessment

You are conducting a white-box security assessment on this codebase.

**Create output directory:** `mkdir -p .codeguard`

---

## Phase 1: Reconnaissance

First, understand the codebase architecture:

1. **Tech Stack**: What frameworks, languages, databases are used?
2. **Entry Points**: API routes, form handlers, file uploads, webhooks
3. **Authentication**: How are users authenticated? JWT, sessions, OAuth?
4. **Data Flow**: Where does user input enter and how is it processed?
5. **Sensitive Data**: What secrets, credentials, PII are handled?

Create `.codeguard/attack-surface.json`:
```json
{
  "techStack": ["express", "postgresql", "react"],
  "entryPoints": ["/api/users", "/api/auth/login", ...],
  "authMechanism": "jwt",
  "databases": ["postgresql"],
  "externalServices": ["stripe", "sendgrid"]
}
```

---

## Phase 2: Vulnerability Hunting

Search for these specific vulnerability patterns:

### 2.1 SQL/NoSQL Injection
Look for:
- String concatenation in queries: `"SELECT * FROM users WHERE id = " + userId`
- Template literals without parameterization: `` `SELECT * FROM ${table}` ``
- ORM raw queries with user input
- MongoDB `$where`, `$regex` with user input

Example vulnerable patterns:
```javascript
// VULNERABLE - string concatenation
db.query("SELECT * FROM users WHERE email = '" + email + "'");

// VULNERABLE - template literal
db.query(`SELECT * FROM users WHERE id = ${req.params.id}`);

// VULNERABLE - MongoDB injection
db.users.find({ $where: "this.username == '" + username + "'" });
```

### 2.2 Cross-Site Scripting (XSS)
Look for:
- `innerHTML`, `outerHTML` assignments with user data
- `document.write()` with user input
- `dangerouslySetInnerHTML` in React without sanitization
- Reflected user input in responses without encoding
- DOM manipulation: `element.innerHTML = userInput`

Example vulnerable patterns:
```javascript
// VULNERABLE - innerHTML
element.innerHTML = userInput;

// VULNERABLE - React dangerous
<div dangerouslySetInnerHTML={{__html: userComment}} />

// VULNERABLE - document.write
document.write(location.search);
```

### 2.3 Authentication & Authorization Flaws
Look for:
- Timing attacks: `password === userPassword` instead of constant-time comparison
- JWT with 'none' algorithm accepted
- Weak JWT secrets (short, predictable)
- Missing authorization checks on endpoints
- IDOR: accessing resources by ID without ownership verification
- Session fixation vulnerabilities
- Missing CSRF protection

Example vulnerable patterns:
```javascript
// VULNERABLE - timing attack
if (password === storedPassword) { ... }

// VULNERABLE - IDOR
app.get('/api/orders/:id', (req, res) => {
  const order = await Order.findById(req.params.id); // No ownership check!
  res.json(order);
});

// VULNERABLE - weak JWT
jwt.sign(payload, 'secret'); // Weak secret
```

### 2.4 SSRF (Server-Side Request Forgery)
Look for:
- User-controlled URLs in fetch/axios/http requests
- URL parameters passed to HTTP clients
- Webhook URLs without validation
- Image/file fetching from user URLs

Dangerous patterns:
```javascript
// VULNERABLE - user-controlled URL
const response = await fetch(req.body.url);

// VULNERABLE - image proxy
app.get('/proxy', async (req, res) => {
  const image = await axios.get(req.query.imageUrl);
});
```

Cloud metadata targets to check for:
- `http://169.254.169.254/latest/meta-data/` (AWS)
- `http://metadata.google.internal/` (GCP)
- `http://169.254.169.254/metadata/instance` (Azure)

### 2.5 Command Injection
Look for:
- `exec()`, `spawn()`, `execSync()` with user input
- Shell commands with string concatenation
- Template literals in shell commands

Example vulnerable patterns:
```javascript
// VULNERABLE - command injection
exec('convert ' + req.body.filename + ' output.png');

// VULNERABLE - spawn with shell
spawn('bash', ['-c', `echo ${userInput}`]);
```

### 2.6 Path Traversal
Look for:
- File paths constructed from user input
- Missing path normalization
- `../` sequences not blocked

Example vulnerable patterns:
```javascript
// VULNERABLE - path traversal
const filePath = './uploads/' + req.params.filename;
res.sendFile(filePath);

// VULNERABLE - no normalization
fs.readFile(baseDir + userPath);
```

### 2.7 Insecure Dependencies
Check:
- `package.json` / `requirements.txt` / `pom.xml` for known vulnerable versions
- Outdated packages with CVEs
- Dependencies with known security issues

### 2.8 Hardcoded Secrets
Look for:
- API keys in source code
- Passwords in config files
- Private keys committed
- JWT secrets in code

Patterns:
```javascript
// VULNERABLE - hardcoded secrets
const API_KEY = 'sk-live-abc123...';
const DB_PASSWORD = 'admin123';
```

### 2.9 Security Misconfigurations
Look for:
- CORS with `*` origin and credentials
- Missing security headers (CSP, X-Frame-Options, etc.)
- Debug mode enabled in production
- Verbose error messages exposing internals
- Default credentials

---

## Phase 3: Output

Create `.codeguard/security-report.json`:

```json
{
  "summary": {
    "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW",
    "total": 15,
    "critical": 3,
    "high": 5,
    "medium": 4,
    "low": 3
  },
  "findings": [
    {
      "id": "SEC-001",
      "severity": "critical",
      "category": "injection",
      "title": "SQL Injection in user search",
      "description": "User input is directly concatenated into SQL query without parameterization, allowing attackers to extract or modify database contents.",
      "file": "src/api/users.js",
      "line": 42,
      "endLine": 45,
      "code": "const query = `SELECT * FROM users WHERE name = '${req.query.name}'`;",
      "remediation": "Use parameterized queries: db.query('SELECT * FROM users WHERE name = $1', [req.query.name])",
      "cwe": "CWE-89",
      "cvss": 9.8,
      "references": ["https://owasp.org/www-community/attacks/SQL_Injection"]
    }
  ]
}
```

---

## Rules

1. **Be thorough** - Read files completely, don't skim
2. **Be specific** - Include exact file:line references
3. **Be brutal** - No sugarcoating, this is for production safety
4. **Be actionable** - Every finding needs a concrete fix with code example
5. **No false positives** - Only report issues you're confident about
6. **Prioritize impact** - Focus on what matters (RCE, data breach, auth bypass)

Start the assessment now.
```

---

#### Reliability Analysis Prompt

```markdown
# Reliability Audit (Antithesis Methodology)

You are conducting a distributed systems reliability audit based on the Antithesis reliability methodology.

**Create output directory:** `mkdir -p .codeguard`

---

## Phase 1: Architecture Reconnaissance

First, understand the system architecture:

1. **Threading Model**: What thread pools, executors, event loops exist?
2. **State Management**: What databases, caches, in-memory state?
3. **Network Communication**: HTTP, WebSocket, message queues?
4. **Concurrency Primitives**: Locks, atomics, concurrent collections?
5. **Deployment Model**: Single instance or multi-instance?

Create `.codeguard/architecture-recon.json`:
```json
{
  "threadingModel": "event-loop|thread-pool|async",
  "stateStores": ["postgresql", "redis"],
  "concurrencyPatterns": ["async/await", "promises"],
  "deploymentModel": "single-instance|multi-instance",
  "criticalPaths": ["payment processing", "user auth"]
}
```

---

## Phase 2: Vulnerability Hunting

### Reference: Consistency Anomalies

| Code | Name | Description |
|------|------|-------------|
| **P0** | Dirty Write | Transaction overwrites another's uncommitted write |
| **P1** | Dirty Read | Reading uncommitted data |
| **P2** | Non-Repeatable Read | Value changes between reads in same transaction |
| **P3** | Phantom | Set of records changes during transaction |
| **P4** | Lost Update | Concurrent writes, one silently lost |
| **A5A** | Read Skew | Partial observation of multi-object update |
| **A5B** | Write Skew | Two transactions write different objects, neither sees other |

---

### 2.1 Concurrency Bugs

#### Race Conditions (Check-Then-Act)
```javascript
// VULNERABLE - check-then-act race
if (!cache.has(key)) {
  cache.set(key, computeExpensiveValue()); // Another thread may set between check and set
}

// VULNERABLE - read-modify-write
const count = await redis.get('counter');
await redis.set('counter', count + 1); // Lost update if concurrent
```

#### Non-Atomic Compound Operations
```javascript
// VULNERABLE - non-atomic check and update
const user = await db.findById(id);
if (user.balance >= amount) {
  user.balance -= amount;
  await user.save(); // Race: balance could have changed
}
```

#### Memory Visibility Issues (for languages with threads)
```java
// VULNERABLE - non-volatile shared state
private boolean running = true; // Should be volatile

// VULNERABLE - double-checked locking without volatile
if (instance == null) {
  synchronized(lock) {
    if (instance == null) {
      instance = new Singleton(); // Unsafe publication
    }
  }
}
```

### 2.2 Error Handling Deficiencies

#### Swallowed Exceptions
```javascript
// VULNERABLE - swallowed error
try {
  await processPayment();
} catch (error) {
  console.log('Payment failed'); // Error lost, no rethrow
}

// VULNERABLE - missing error handler
promise.then(result => process(result)); // Missing .catch()

// VULNERABLE - async without await
async function save() {
  db.insert(data); // Not awaited - errors lost
}
```

#### Missing Cleanup
```javascript
// VULNERABLE - resource leak on error
const connection = await pool.getConnection();
const result = await connection.query(sql); // If this throws, connection leaks
connection.release();

// CORRECT
const connection = await pool.getConnection();
try {
  return await connection.query(sql);
} finally {
  connection.release();
}
```

### 2.3 Fault Tolerance Gaps

#### Missing Timeouts
```javascript
// VULNERABLE - no timeout
const response = await fetch(externalApi); // Can hang forever

// VULNERABLE - infinite retry
while (true) {
  try {
    return await callService();
  } catch (e) {
    continue; // Infinite loop if service is down
  }
}
```

#### No Circuit Breaker
```javascript
// VULNERABLE - cascading failure
async function handleRequest() {
  const data = await slowExternalService(); // If slow, all requests queue up
  return process(data);
}
```

#### Missing Retry Logic
```javascript
// VULNERABLE - transient failure not retried
try {
  await sendEmail();
} catch (error) {
  throw new Error('Email failed'); // Network blip = permanent failure
}
```

### 2.4 Resource Management

#### Unbounded Growth
```javascript
// VULNERABLE - unbounded queue
const queue = [];
app.post('/job', (req, res) => {
  queue.push(req.body); // No limit - OOM under load
});

// VULNERABLE - unbounded cache
const cache = new Map();
function getUser(id) {
  if (!cache.has(id)) {
    cache.set(id, fetchUser(id)); // Never evicted - memory leak
  }
  return cache.get(id);
}
```

#### Connection Leaks
```javascript
// VULNERABLE - connection not released on error path
async function query(sql) {
  const conn = await pool.getConnection();
  const result = await conn.query(sql);
  conn.release();
  return result; // If query throws, connection leaks
}
```

### 2.5 Consistency Violations

#### Lost Updates (P4)
```javascript
// VULNERABLE - lost update
const item = await db.findById(id);
item.quantity += orderQuantity;
await item.save(); // Concurrent order loses update

// FIX: Use atomic update
await db.updateOne({ _id: id }, { $inc: { quantity: orderQuantity } });
```

#### Read-Your-Writes Violation
```javascript
// VULNERABLE - read from replica after write
await primaryDb.insert(user);
const saved = await replicaDb.findById(user.id); // May not see own write
```

#### Stale Reads
```javascript
// VULNERABLE - cache without invalidation
const user = cache.get(userId) || await db.findById(userId);
// If user updated elsewhere, stale data served

// VULNERABLE - long cache TTL
cache.set(key, value, { ttl: 3600 }); // Hour-old data could be wrong
```

### 2.6 Distributed Coordination Issues (Multi-Instance)

#### Useless Local Locks
```javascript
// VULNERABLE - local lock in distributed system
const mutex = new Mutex();

async function processPayment() {
  await mutex.acquire();
  try {
    // In multi-instance deployment, other instances not blocked!
    await updateBalance();
  } finally {
    mutex.release();
  }
}
```

#### Missing Distributed Lock
```javascript
// VULNERABLE - concurrent cron jobs across instances
cron.schedule('0 * * * *', async () => {
  await processAllOrders(); // All instances run simultaneously
});
```

---

## Phase 3: Output

Create `.codeguard/reliability-report.json`:

```json
{
  "summary": {
    "riskLevel": "CRITICAL|HIGH|MEDIUM|LOW",
    "total": 12,
    "critical": 2,
    "high": 4,
    "medium": 3,
    "low": 3,
    "multiInstanceSafe": false
  },
  "findings": [
    {
      "id": "REL-001",
      "severity": "critical",
      "category": "concurrency",
      "title": "Race condition in balance update",
      "description": "Non-atomic read-modify-write pattern causes lost updates when concurrent requests modify the same balance. This is a P4 (Lost Update) anomaly.",
      "file": "src/services/wallet.js",
      "line": 87,
      "endLine": 91,
      "code": "const wallet = await Wallet.findById(id);\nwallet.balance += amount;\nawait wallet.save();",
      "remediation": "Use atomic update: await Wallet.updateOne({ _id: id }, { $inc: { balance: amount } })",
      "pattern": "Lost Update (P4)",
      "businessImpact": "Users can double-spend or lose money"
    }
  ],
  "systemicIssues": [
    {
      "id": "SYS-001",
      "title": "No distributed coordination",
      "description": "The system uses local mutexes but has no distributed locking mechanism. Multi-instance deployment will cause data corruption.",
      "affectedComponents": ["PaymentService", "InventoryService"],
      "remediation": "Implement distributed locking using Redis SETNX or database advisory locks"
    }
  ]
}
```

---

## Rules

1. **Be thorough** - Read files completely, trace data flows
2. **Be specific** - Include exact file:line references
3. **Be brutal** - No sugarcoating, this is for production safety
4. **Be actionable** - Every finding needs a concrete fix
5. **Think systemic** - Identify patterns and architectural issues
6. **Consider deployment** - Is this safe for multi-instance?

Start the audit now.
```

## Frontend Components

### Homepage (`/`)

```
┌─────────────────────────────────────────────────────────────┐
│  CodeGuard AI                              [+ Add Repository]│
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ owner/repo-name                                         ││
│  │ ● Completed   🔴 12 Critical  🟠 8 High  🟡 15 Medium   ││
│  │ Last analyzed: 2 hours ago                   [Recheck]  ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ owner/another-repo                                      ││
│  │ ◐ Analyzing... (Security: done, Reliability: running)   ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
│  ┌─────────────────────────────────────────────────────────┐│
│  │ owner/new-repo                                          ││
│  │ ○ Pending - Waiting to start                            ││
│  └─────────────────────────────────────────────────────────┘│
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Code Browser (`/repos/:id`)

```
┌─────────────────────────────────────────────────────────────────────┐
│  ← Back    owner/repo-name    🔴 12  🟠 8  🟡 15  🟢 3    [Recheck] │
├────────────────┬────────────────────────────────────────────────────┤
│ 📁 src         │  src/auth/login.ts                                 │
│   📁 auth      │ ─────────────────────────────────────────────────  │
│     📄 login.ts│  38│   const query = `SELECT * FROM users          │
│   🔴 (3)       │  39│     WHERE email = '${email}'`;  ← 🔴 CRITICAL │
│   📁 api       │  40│   const result = await db.query(query);       │
│     📄 users.ts│  41│   return result.rows[0];                      │
│   🟠 (2)       │  42│ }                                             │
│   📄 index.ts  │                                                    │
│ 📁 lib         │  ┌─────────────────────────────────────────────┐   │
│   📄 db.ts     │  │ SEC-001: SQL Injection (Critical)           │   │
│   🟡 (1)       │  │                                             │   │
│ 📄 package.json│  │ User input directly interpolated into SQL   │   │
│                │  │ query without sanitization.                 │   │
│                │  │                                             │   │
│                │  │ Remediation: Use parameterized queries      │   │
│                │  │ const query = 'SELECT * FROM users WHERE    │   │
│                │  │   email = $1';                              │   │
│                │  │ await db.query(query, [email]);             │   │
│                │  └─────────────────────────────────────────────┘   │
└────────────────┴────────────────────────────────────────────────────┘
```

## Project Structure

```
codeguard-ai/
├── package.json              # Workspace root
├── pnpm-workspace.yaml
├── docker-compose.yml        # PostgreSQL for dev
├── .env.example
│
├── packages/
│   ├── backend/
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── drizzle.config.ts
│   │   └── src/
│   │       ├── index.ts              # Express app entry
│   │       ├── db/
│   │       │   ├── schema.ts         # Drizzle schema
│   │       │   └── index.ts          # DB connection
│   │       ├── routes/
│   │       │   ├── repos.ts
│   │       │   ├── files.ts
│   │       │   └── issues.ts
│   │       ├── services/
│   │       │   ├── github.ts         # Clone repos
│   │       │   ├── analyzer.ts       # Claude Code orchestration
│   │       │   └── parser.ts         # Parse JSON reports
│   │       └── prompts/
│   │           ├── security.ts
│   │           └── reliability.ts
│   │
│   └── frontend/
│       ├── package.json
│       ├── tsconfig.json
│       ├── vite.config.ts
│       ├── tailwind.config.js
│       ├── index.html
│       └── src/
│           ├── main.tsx
│           ├── App.tsx
│           ├── components/
│           │   ├── ui/               # shadcn components
│           │   ├── RepoList.tsx
│           │   ├── RepoCard.tsx
│           │   ├── AddRepoDialog.tsx
│           │   ├── CodeBrowser.tsx
│           │   ├── FileTree.tsx
│           │   ├── CodeEditor.tsx    # Monaco wrapper
│           │   └── IssueTooltip.tsx
│           ├── hooks/
│           │   ├── useRepos.ts
│           │   ├── useFiles.ts
│           │   └── useIssues.ts
│           ├── lib/
│           │   ├── api.ts            # API client
│           │   └── monaco.ts         # Monaco config
│           └── pages/
│               ├── HomePage.tsx
│               └── RepoBrowserPage.tsx
│
└── SPEC.md
```

## Environment Variables

```bash
# .env
DATABASE_URL=postgresql://codeguard:codeguard@localhost:5432/codeguard
ANTHROPIC_API_KEY=sk-ant-...
REPOS_BASE_PATH=/tmp/codeguard-repos    # Where repos are cloned
PORT=3001
```

## Docker Compose (Development)

```yaml
version: '3.8'
services:
  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: codeguard
      POSTGRES_PASSWORD: codeguard
      POSTGRES_DB: codeguard
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Start PostgreSQL
docker-compose up -d

# Run database migrations
pnpm --filter backend db:push

# Start backend (port 3001)
pnpm --filter backend dev

# Start frontend (port 5173)
pnpm --filter frontend dev
```

## MVP Scope

### Included
- [x] Add public GitHub repository by URL
- [x] Clone repository locally
- [x] Run security + reliability analysis via Claude Code
- [x] Store issues in PostgreSQL
- [x] Display repository list with status and issue counts
- [x] Code browser with file tree
- [x] Monaco editor with issue highlighting
- [x] Issue details on hover/click
- [x] Recheck functionality
- [x] Real-time status updates (polling)
- [x] Light theme

### Not Included (Future)
- [x] Private repositories (OAuth)
- [x] User authentication
- [ ] AI Fix Suggestions - "Fix with AI" button that generates patched code via Claude
- [ ] Diff View - Monaco diff editor showing original vs fixed code
- [ ] Ignore Rules - `.codeguardignore` file to skip specific issues/files/categories
- [ ] Export reports (PDF/JSON)
- [ ] Dashboard with trends
- [ ] Webhooks for auto-recheck on push
- [ ] Multiple analysis profiles
- [ ] Issue tracking/resolution status

## Design Guidelines

- Professional, minimalist UI (Linear/Stripe style)
- Color-coded severity badges:
  - Critical: `red-500` / `#ef4444`
  - High: `orange-500` / `#f97316`
  - Medium: `yellow-500` / `#eab308`
  - Low: `green-500` / `#22c55e`
- Smooth hover transitions (150ms)
- File tree with issue count badges
- Monaco decorations for highlighted lines
- Collapsible issue panel
