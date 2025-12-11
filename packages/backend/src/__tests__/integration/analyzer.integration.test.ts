import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, '..', 'fixtures');
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude';
const TEST_TIMEOUT = 120_000; // 2 minutes per test

interface Issue {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file_path?: string;
  line_start?: number;
  remediation?: string;
}

interface Report {
  agent: string;
  issues: Issue[];
}

interface ExpectedIssue {
  id: string;
  category: string;
  severity: string[];
  filePattern: string;
  descriptionContains: string[];
}

/**
 * Run a single-agent analysis on a fixture directory
 */
async function runSingleAgentAnalysis(
  fixturePath: string,
  agentPrompt: string,
  outputFile: string
): Promise<Report | null> {
  const codeguardDir = path.join(fixturePath, '.codeguard');
  await fs.mkdir(codeguardDir, { recursive: true });

  const prompt = `${agentPrompt}

Analyze the code in this directory and write your findings to ${outputFile}.
Be thorough but focus only on real issues, not style preferences.`;

  return new Promise((resolve, reject) => {
    const args = [
      '-p', prompt,
      '--allowedTools', 'Write,Read,Glob,Grep',
      '--dangerously-skip-permissions',
      '--max-turns', '30',
    ];

    const claude = spawn(CLAUDE_CMD, args, {
      cwd: fixturePath,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderr = '';
    claude.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    claude.on('close', async (code) => {
      if (code !== 0) {
        console.error(`Claude exited with code ${code}: ${stderr}`);
        resolve(null);
        return;
      }

      try {
        const reportPath = path.join(fixturePath, outputFile);
        const content = await fs.readFile(reportPath, 'utf-8');
        resolve(JSON.parse(content));
      } catch (err) {
        console.error(`Failed to read report: ${err}`);
        resolve(null);
      }
    });

    claude.on('error', (err) => {
      reject(err);
    });
  });
}

/**
 * Check if an issue matches expected criteria
 */
function issueMatchesExpected(issue: Issue, expected: ExpectedIssue): boolean {
  // Check file pattern
  if (expected.filePattern && issue.file_path) {
    if (!issue.file_path.includes(expected.filePattern)) {
      return false;
    }
  }

  // Check severity (any of the expected severities)
  if (!expected.severity.includes(issue.severity.toLowerCase())) {
    return false;
  }

  // Check description contains keywords (any of them)
  const fullText = `${issue.title} ${issue.description}`.toLowerCase();
  const hasKeyword = expected.descriptionContains.some(keyword =>
    fullText.includes(keyword.toLowerCase())
  );
  if (!hasKeyword) {
    return false;
  }

  return true;
}

/**
 * Clean up .codeguard directory after tests
 */
async function cleanupCodeguardDir(fixturePath: string) {
  const codeguardDir = path.join(fixturePath, '.codeguard');
  try {
    await fs.rm(codeguardDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}

// Security agent prompt (simplified for testing)
const SECURITY_PROMPT = `You are a Security Auditor. Find security vulnerabilities in this code:
- SQL injection
- Command injection
- Hardcoded secrets/credentials
- XSS vulnerabilities
- Authentication flaws

Output JSON format:
{
  "agent": "security",
  "issues": [
    {
      "id": "SEC-001",
      "severity": "critical|high|medium|low",
      "category": "injection|secrets|auth|xss",
      "title": "Brief title",
      "description": "What's wrong",
      "file_path": "path/to/file",
      "line_start": 42,
      "remediation": "How to fix"
    }
  ]
}`;

// Resilience agent prompt (simplified for testing)
const RESILIENCE_PROMPT = `You are a Resilience Auditor. Find reliability issues in this code:
- Swallowed exceptions (empty catch blocks)
- Missing error handling
- Fire-and-forget async calls
- Race conditions
- Resource leaks

Output JSON format:
{
  "agent": "resilience",
  "issues": [
    {
      "id": "RES-001",
      "severity": "critical|high|medium|low",
      "category": "error-handling|async|race-condition|resource-leak",
      "title": "Brief title",
      "description": "What's wrong",
      "file_path": "path/to/file",
      "line_start": 42,
      "remediation": "How to fix"
    }
  ]
}`;

describe('LLM Integration Tests (Eval)', () => {
  describe('vulnerable-app detection', () => {
    const vulnerableAppPath = path.join(fixturesDir, 'vulnerable-app');
    let expectedIssues: { minimumExpected: ExpectedIssue[] };
    let securityReport: Report | null = null;
    let resilienceReport: Report | null = null;

    beforeAll(async () => {
      // Load expected issues
      const expectedPath = path.join(vulnerableAppPath, 'expected-issues.json');
      expectedIssues = JSON.parse(await fs.readFile(expectedPath, 'utf-8'));

      // Run both analyses in parallel
      console.log('Running LLM analysis on vulnerable-app (this may take ~60s)...');
      [securityReport, resilienceReport] = await Promise.all([
        runSingleAgentAnalysis(
          vulnerableAppPath,
          SECURITY_PROMPT,
          '.codeguard/security-report.json'
        ),
        runSingleAgentAnalysis(
          vulnerableAppPath,
          RESILIENCE_PROMPT,
          '.codeguard/resilience-report.json'
        ),
      ]);
    }, TEST_TIMEOUT * 2);

    afterAll(async () => {
      await cleanupCodeguardDir(vulnerableAppPath);
    });

    it('should generate security report', () => {
      expect(securityReport).not.toBeNull();
      expect(securityReport?.issues).toBeDefined();
    });

    it('should generate resilience report', () => {
      expect(resilienceReport).not.toBeNull();
      expect(resilienceReport?.issues).toBeDefined();
    });

    it('should detect SQL injection', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'sql-injection')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should detect command injection', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'command-injection')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should detect hardcoded secret', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'hardcoded-secret')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should detect swallowed exception', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'swallowed-exception')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should detect fire-and-forget async', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'fire-and-forget')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should detect race condition', () => {
      const expected = expectedIssues.minimumExpected.find(e => e.id === 'race-condition')!;
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      const found = allIssues.some(issue => issueMatchesExpected(issue, expected));
      expect(found).toBe(true);
    });

    it('should find at least 4 of 6 expected issues (66% threshold)', () => {
      const allIssues = [...(securityReport?.issues || []), ...(resilienceReport?.issues || [])];
      let foundCount = 0;

      for (const expected of expectedIssues.minimumExpected) {
        if (allIssues.some(issue => issueMatchesExpected(issue, expected))) {
          foundCount++;
        }
      }

      console.log(`Found ${foundCount}/${expectedIssues.minimumExpected.length} expected issues`);
      expect(foundCount).toBeGreaterThanOrEqual(4);
    });
  });

  describe('clean-app detection', () => {
    const cleanAppPath = path.join(fixturesDir, 'clean-app');
    let securityReport: Report | null = null;

    beforeAll(async () => {
      console.log('Running LLM analysis on clean-app...');
      securityReport = await runSingleAgentAnalysis(
        cleanAppPath,
        SECURITY_PROMPT,
        '.codeguard/security-report.json'
      );
    }, TEST_TIMEOUT);

    afterAll(async () => {
      await cleanupCodeguardDir(cleanAppPath);
    });

    it('should generate report', () => {
      expect(securityReport).not.toBeNull();
    });

    it('should find zero or minimal critical/high issues (low false positive rate)', () => {
      const criticalHighIssues = (securityReport?.issues || []).filter(
        issue => ['critical', 'high'].includes(issue.severity.toLowerCase())
      );

      console.log(`Found ${criticalHighIssues.length} critical/high issues in clean-app`);
      // Allow at most 1 false positive at critical/high level
      expect(criticalHighIssues.length).toBeLessThanOrEqual(1);
    });
  });
});
