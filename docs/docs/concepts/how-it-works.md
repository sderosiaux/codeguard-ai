# How It Works

CodeGuard AI uses advanced AI models to analyze your source code for security vulnerabilities and code quality issues.

## Architecture Overview

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   CLI/Web   │────▶│   Backend   │────▶│  Claude AI  │
│   Client    │     │    API      │     │   Analysis  │
└─────────────┘     └─────────────┘     └─────────────┘
       │                   │                   │
       │                   ▼                   │
       │            ┌─────────────┐            │
       │            │  Database   │◀───────────┘
       │            │  (Results)  │
       │            └─────────────┘
       │                   │
       ▼                   ▼
┌─────────────────────────────────────────────┐
│              Security Report                 │
│  - Issues with severity & locations         │
│  - Code snippets & remediation              │
│  - Overall grade (A-F)                      │
└─────────────────────────────────────────────┘
```

## Analysis Process

### 1. File Collection

The scanner collects source files from your codebase:

- Identifies files by extension (`.ts`, `.py`, `.go`, etc.)
- Skips ignored directories (`node_modules`, `.git`, `vendor`)
- Respects file size limits (default: 100KB per file)

### 2. AI Analysis

Files are sent to Claude AI with specialized security prompts:

- **Security Analysis** - Authentication, input validation, cryptography
- **Reliability Analysis** - Error handling, resource management, race conditions

The AI understands code context, not just patterns, enabling detection of:

- Complex vulnerabilities that span multiple files
- Logic flaws that simple scanners miss
- Context-dependent security issues

### 3. Issue Generation

The AI generates structured issues with:

- **Severity** - Critical, High, Medium, Low
- **Category** - Security, Input Validation, etc.
- **Location** - File path and line numbers
- **Description** - What the issue is
- **Remediation** - How to fix it

### 4. Grading

A weighted score determines the overall grade:

| Severity | Points |
|----------|--------|
| Critical | 10 |
| High | 5 |
| Medium | 2 |
| Low | 1 |

| Score | Grade |
|-------|-------|
| 0-5 | A |
| 6-15 | B |
| 16-30 | C |
| 31-60 | D |
| 61+ | F |

## AI vs Traditional Scanners

| Feature | CodeGuard AI | Traditional SAST |
|---------|--------------|------------------|
| Detection Method | Understands code semantics | Pattern matching |
| False Positives | Low (context-aware) | High (rule-based) |
| Custom Logic | Catches business logic flaws | Limited to known patterns |
| Setup | Zero configuration | Extensive rule configuration |
| Language Support | Universal (AI understands all) | Per-language rules |

## Security Considerations

- **Code Privacy** - Files are sent to the API for analysis
- **Data Retention** - Results are stored in your account
- **API Security** - All communication is encrypted (HTTPS)

For sensitive codebases, consider:

- Self-hosting the backend
- Using the CLI with local-only mode (coming soon)
