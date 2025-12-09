# Grading System

CodeGuard AI assigns a letter grade (A-F) to provide a quick overview of your codebase's security posture.

## Grade Calculation

Grades are calculated using a weighted scoring system:

### Severity Weights

| Severity | Points |
|----------|--------|
| Critical | 10 |
| High | 5 |
| Medium | 2 |
| Low | 1 |

### Score Formula

```
Score = (Critical × 10) + (High × 5) + (Medium × 2) + (Low × 1)
```

### Grade Thresholds

| Score | Grade | Description |
|-------|-------|-------------|
| 0-5 | **A** | Excellent - Few or no issues |
| 6-15 | **B** | Good - Minor issues only |
| 16-30 | **C** | Fair - Some issues need attention |
| 31-60 | **D** | Poor - Significant issues present |
| 61+ | **F** | Critical - Immediate action required |

## Grade Examples

### Grade A (Score: 0-5)

```
Critical: 0
High: 0
Medium: 2
Low: 1

Score = (0×10) + (0×5) + (2×2) + (1×1) = 5
Grade = A
```

### Grade C (Score: 16-30)

```
Critical: 1
High: 2
Medium: 3
Low: 4

Score = (1×10) + (2×5) + (3×2) + (4×1) = 30
Grade = C
```

### Grade F (Score: 61+)

```
Critical: 5
High: 3
Medium: 2
Low: 10

Score = (5×10) + (3×5) + (2×2) + (10×1) = 79
Grade = F
```

## Improving Your Grade

### Quick Wins

1. **Fix Critical Issues First** - Each critical issue removed improves score by 10 points
2. **Address High Severity** - 5 points per high issue
3. **Batch Medium Fixes** - Group related medium issues for efficient remediation

### Common Improvements

| Action | Point Reduction |
|--------|-----------------|
| Fix SQL injection | -10 (critical) |
| Add input validation | -5 (high) |
| Update weak crypto | -5 (high) |
| Add rate limiting | -2 (medium) |
| Add security headers | -1 (low) |

## Grade Trends

Track your grade over time to measure security improvements:

```bash
# Save scan results with timestamp
codeguard scan --format json > scan-$(date +%Y%m%d).json
```

The web dashboard shows grade history for each repository.

## CI/CD Grade Gates

Enforce minimum grades in your pipeline:

```yaml
# GitHub Actions example
- name: Security Scan
  run: |
    RESULT=$(codeguard scan --format json)
    GRADE=$(echo $RESULT | jq -r '.grade')
    if [[ "$GRADE" == "D" || "$GRADE" == "F" ]]; then
      echo "Security grade $GRADE is below threshold"
      exit 1
    fi
```

## Understanding Your Grade

| Grade | What It Means | Recommended Action |
|-------|---------------|-------------------|
| **A** | Excellent security posture | Maintain current practices |
| **B** | Good with minor issues | Fix issues during regular sprints |
| **C** | Needs attention | Prioritize security work |
| **D** | Significant problems | Create dedicated security sprint |
| **F** | Critical vulnerabilities | Stop feature work, fix immediately |

!!! tip "Context Matters"
    A "C" grade on an internal tool may be acceptable, while a "B" on a public API might require improvement. Adjust your expectations based on risk profile.
