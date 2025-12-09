# CodeGuard AI

**AI-powered security scanner for your codebase**

CodeGuard AI analyzes your source code for security vulnerabilities, best practice violations, and potential bugs using advanced AI models.

<div class="grid cards" markdown>

-   :material-rocket-launch:{ .lg .middle } __Get Started in 5 Minutes__

    ---

    Install the CLI and scan your first project

    [:octicons-arrow-right-24: Quick Start](getting-started/quickstart.md)

-   :material-shield-check:{ .lg .middle } __Security Analysis__

    ---

    Understand how CodeGuard AI detects vulnerabilities

    [:octicons-arrow-right-24: How It Works](concepts/how-it-works.md)

-   :material-console:{ .lg .middle } __CLI Reference__

    ---

    Complete reference for all CLI commands

    [:octicons-arrow-right-24: Commands](reference/commands.md)

-   :material-github:{ .lg .middle } __CI/CD Integration__

    ---

    Add security scanning to your pipeline

    [:octicons-arrow-right-24: GitHub Actions](guides/github-actions.md)

</div>

## Features

- **AI-Powered Analysis** - Uses Claude AI to understand code context and detect real vulnerabilities
- **Multiple Languages** - Supports 15+ programming languages including TypeScript, Python, Go, and more
- **Security Grades** - Get A-F grades based on weighted severity scoring
- **CLI & Web Interface** - Scan locally or through the web dashboard
- **CI/CD Ready** - JSON output for easy integration with your pipeline

## Supported Languages

| Language | Extensions |
|----------|------------|
| JavaScript/TypeScript | `.js`, `.jsx`, `.ts`, `.tsx` |
| Python | `.py` |
| Go | `.go` |
| Java | `.java` |
| Ruby | `.rb` |
| PHP | `.php` |
| C/C++ | `.c`, `.cpp`, `.h`, `.hpp` |
| C# | `.cs` |
| Rust | `.rs` |
| Swift | `.swift` |
| Kotlin | `.kt`, `.kts` |
| Scala | `.scala` |
| Solidity | `.sol` |

## Quick Example

```bash
# Install the CLI
go install github.com/codeguard-ai/cli@latest

# Scan your project
codeguard scan ./my-project

# Output as JSON for CI
codeguard scan --format json ./my-project
```

## Security Categories

CodeGuard AI checks for vulnerabilities across these categories:

- **Authentication & Authorization** - Weak auth, session issues, access control
- **Input Validation** - SQL injection, XSS, command injection, path traversal
- **Cryptography** - Weak encryption, hardcoded secrets, insecure randomness
- **API Security** - Missing rate limiting, data exposure
- **Error Handling** - Information leakage, missing error handling
- **Configuration** - Insecure defaults, debug mode, exposed endpoints
