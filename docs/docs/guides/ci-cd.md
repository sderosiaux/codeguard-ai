# CI/CD Integration

Integrate CodeGuard AI into your continuous integration pipeline.

## Overview

CodeGuard CLI supports CI/CD integration through:

- **JSON output** - Machine-readable results
- **Exit codes** - Fail builds based on findings
- **Environment variables** - Secure credential management

## Quick Start

```yaml
# Generic CI example
- name: Install CodeGuard
  run: go install github.com/codeguard-ai/cli@latest

- name: Run Security Scan
  env:
    CODEGUARD_API_KEY: ${{ secrets.CODEGUARD_API_KEY }}
  run: codeguard scan --format json > results.json

- name: Check Results
  run: |
    GRADE=$(cat results.json | jq -r '.grade')
    echo "Security Grade: $GRADE"
    if [[ "$GRADE" == "F" ]]; then
      exit 1
    fi
```

## JSON Output Format

```json
{
  "grade": "B",
  "score": 12,
  "filesScanned": 45,
  "issueCount": 7,
  "issues": [
    {
      "severity": "high",
      "title": "SQL Injection",
      "file": "src/db/queries.ts",
      "line": 23,
      "description": "User input interpolated into SQL query"
    }
  ]
}
```

## Fail Conditions

### By Grade

```bash
GRADE=$(codeguard scan --format json | jq -r '.grade')

case $GRADE in
  A|B) echo "Pass: Grade $GRADE" ;;
  C)   echo "Warning: Grade $GRADE"; exit 0 ;;
  D|F) echo "Fail: Grade $GRADE"; exit 1 ;;
esac
```

### By Severity Count

```bash
RESULT=$(codeguard scan --format json)

CRITICAL=$(echo $RESULT | jq '.issues | map(select(.severity == "critical")) | length')
HIGH=$(echo $RESULT | jq '.issues | map(select(.severity == "high")) | length')

if [ "$CRITICAL" -gt 0 ]; then
  echo "Found $CRITICAL critical issues"
  exit 1
fi

if [ "$HIGH" -gt 5 ]; then
  echo "Found $HIGH high severity issues (threshold: 5)"
  exit 1
fi
```

### By Total Score

```bash
SCORE=$(codeguard scan --format json | jq '.score')

if [ "$SCORE" -gt 30 ]; then
  echo "Security score $SCORE exceeds threshold 30"
  exit 1
fi
```

## Caching

Speed up CI by caching the CodeGuard binary:

### GitHub Actions

```yaml
- uses: actions/cache@v4
  with:
    path: ~/go/bin/codeguard
    key: codeguard-${{ runner.os }}
```

### GitLab CI

```yaml
cache:
  paths:
    - $GOPATH/bin/codeguard
```

## Artifacts

Save scan results as artifacts for later review:

```yaml
- name: Upload Results
  uses: actions/upload-artifact@v4
  with:
    name: security-report
    path: results.json
```

## PR Comments

Post results as PR comments (GitHub example):

```yaml
- name: Comment on PR
  uses: actions/github-script@v7
  with:
    script: |
      const fs = require('fs');
      const results = JSON.parse(fs.readFileSync('results.json', 'utf8'));

      const body = `## Security Scan Results

      **Grade:** ${results.grade}
      **Issues:** ${results.issueCount}

      | Severity | Count |
      |----------|-------|
      | Critical | ${results.issues.filter(i => i.severity === 'critical').length} |
      | High | ${results.issues.filter(i => i.severity === 'high').length} |
      | Medium | ${results.issues.filter(i => i.severity === 'medium').length} |
      | Low | ${results.issues.filter(i => i.severity === 'low').length} |
      `;

      github.rest.issues.createComment({
        owner: context.repo.owner,
        repo: context.repo.repo,
        issue_number: context.issue.number,
        body
      });
```

## Best Practices

1. **Use secrets for API keys** - Never hardcode credentials
2. **Cache the binary** - Faster CI runs
3. **Set appropriate thresholds** - Start permissive, tighten over time
4. **Review results before blocking** - Avoid false positive frustration
5. **Run on PRs** - Catch issues before merge
