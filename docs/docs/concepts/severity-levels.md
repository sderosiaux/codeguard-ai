# Severity Levels

CodeGuard AI categorizes issues into four severity levels based on exploitability and potential impact.

## Critical

!!! danger "Critical"
    Vulnerabilities that can be easily exploited and lead to significant damage.

**Characteristics:**

- Easily exploitable with public tools/techniques
- Can lead to complete system compromise
- No authentication required to exploit
- High business impact

**Examples:**

- Remote Code Execution (RCE)
- SQL injection allowing data extraction
- Authentication bypass
- Hardcoded admin credentials
- Unauthenticated API with sensitive operations

**Remediation Priority:** Immediate - Fix before deploying to production

---

## High

!!! warning "High"
    Serious vulnerabilities requiring immediate attention.

**Characteristics:**

- Exploitable with some effort
- Can lead to significant data exposure
- May require specific conditions
- Moderate to high business impact

**Examples:**

- Stored XSS vulnerabilities
- CSRF on sensitive actions
- Sensitive data exposure in logs
- Insecure direct object references
- Missing authentication on endpoints

**Remediation Priority:** Within 24-48 hours

---

## Medium

!!! note "Medium"
    Vulnerabilities that require specific conditions to exploit.

**Characteristics:**

- Requires specific conditions or insider access
- Limited impact if exploited
- May be defense-in-depth issues
- Low to moderate business impact

**Examples:**

- Reflected XSS
- Weak cryptographic algorithms
- Missing rate limiting
- Verbose error messages
- Session fixation

**Remediation Priority:** Within 1-2 weeks

---

## Low

!!! tip "Low"
    Best practice violations or minor issues.

**Characteristics:**

- Difficult to exploit
- Minimal impact
- Informational findings
- Code quality improvements

**Examples:**

- Missing security headers
- Information disclosure (version numbers)
- Deprecated function usage
- Commented-out code with credentials
- Missing input validation (non-security)

**Remediation Priority:** During regular maintenance

---

## Severity in Context

The same vulnerability type may have different severities based on context:

| Vulnerability | Public API | Internal Tool | Admin Panel |
|--------------|------------|---------------|-------------|
| SQL Injection | Critical | High | High |
| Missing Auth | Critical | Medium | High |
| XSS | High | Medium | Low |
| Verbose Errors | Medium | Low | Low |

CodeGuard AI considers context when assigning severity, but you should adjust based on your specific risk tolerance and deployment environment.

## Filtering by Severity

### CLI

Show all issues including low severity:

```bash
codeguard scan --all
```

By default, low severity issues are hidden to reduce noise.

### CI/CD

Fail the build only on critical/high issues:

```bash
codeguard scan --format json | jq '.issues | map(select(.severity == "critical" or .severity == "high")) | length'
```
