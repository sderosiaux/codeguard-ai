import { Router } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { randomUUID } from 'crypto';

const router = Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Types
interface FileContent {
  path: string;
  content: string;
}

interface Issue {
  id: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  filePath: string;
  lineStart: number;
  lineEnd: number;
  suggestion: string;
}

type ScanStatus = 'pending' | 'analyzing' | 'completed' | 'error';

interface ScanJob {
  id: string;
  status: ScanStatus;
  filesCount: number;
  createdAt: Date;
  completedAt?: Date;
  issues?: Issue[];
  grade?: string;
  score?: number;
  error?: string;
}

// In-memory store for scan jobs (use Redis/DB in production)
const scanJobs = new Map<string, ScanJob>();

// Clean up old jobs (older than 1 hour)
setInterval(() => {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  for (const [id, job] of scanJobs.entries()) {
    if (job.createdAt.getTime() < oneHourAgo) {
      scanJobs.delete(id);
    }
  }
}, 5 * 60 * 1000); // Run every 5 minutes

// Calculate grade from issue counts
function calculateGrade(issues: Issue[]): { grade: string; score: number } {
  const counts = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const issue of issues) {
    counts[issue.severity]++;
  }

  const score = counts.critical * 10 + counts.high * 5 + counts.medium * 2 + counts.low * 1;

  let grade: string;
  if (score === 0) grade = 'A';
  else if (score <= 5) grade = 'A';
  else if (score <= 15) grade = 'B';
  else if (score <= 30) grade = 'C';
  else if (score <= 60) grade = 'D';
  else grade = 'F';

  return { grade, score };
}

// Build the analysis prompt with file contents
function buildAnalysisPrompt(files: FileContent[]): string {
  const fileList = files.map(f => `### ${f.path}\n\`\`\`\n${f.content.substring(0, 10000)}\n\`\`\``).join('\n\n');

  return `You are a security auditor analyzing code for potential vulnerabilities.

## Files to Analyze

${fileList}

## Your Task

Analyze these files for security vulnerabilities and code quality issues. Focus on:

1. **Security Issues**
   - SQL/NoSQL injection
   - XSS vulnerabilities
   - Authentication/authorization flaws
   - Hardcoded secrets
   - Command injection
   - Path traversal
   - Insecure cryptography

2. **Code Quality**
   - Error handling issues
   - Resource leaks
   - Race conditions
   - Null pointer risks

## Output Format

Return ONLY a JSON object with this exact structure (no markdown, no explanation):

{
  "issues": [
    {
      "id": "SEC-001",
      "severity": "critical|high|medium|low",
      "category": "Security|Input Validation|Authentication|Cryptography|Error Handling|Code Quality",
      "title": "Brief title",
      "description": "Detailed description of the issue",
      "filePath": "path/to/file.ext",
      "lineStart": 10,
      "lineEnd": 15,
      "suggestion": "How to fix this issue"
    }
  ]
}

## Severity Guidelines

- **critical**: Easily exploitable, high impact (RCE, SQL injection, auth bypass)
- **high**: Serious issues requiring attention (XSS, CSRF, data exposure)
- **medium**: Issues requiring specific conditions (weak crypto, missing validation)
- **low**: Best practice violations (info disclosure, missing headers)

Return ONLY valid JSON. No markdown code blocks, no explanations.`;
}

// Run analysis in background
async function runAnalysis(scanId: string, files: FileContent[]): Promise<void> {
  const job = scanJobs.get(scanId);
  if (!job) return;

  try {
    job.status = 'analyzing';

    const prompt = buildAnalysisPrompt(files);

    const message = await anthropic.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });

    const textContent = message.content.find(block => block.type === 'text');
    if (!textContent || textContent.type !== 'text') {
      throw new Error('No text response from Claude');
    }

    // Parse JSON response
    let analysisResult: { issues: Issue[] };
    try {
      let jsonStr = textContent.text.trim();

      // Remove markdown code blocks if present
      if (jsonStr.startsWith('```json')) {
        jsonStr = jsonStr.slice(7);
      } else if (jsonStr.startsWith('```')) {
        jsonStr = jsonStr.slice(3);
      }
      if (jsonStr.endsWith('```')) {
        jsonStr = jsonStr.slice(0, -3);
      }
      jsonStr = jsonStr.trim();

      analysisResult = JSON.parse(jsonStr);
    } catch {
      console.error('Failed to parse Claude response:', textContent.text);
      analysisResult = { issues: [] };
    }

    const { grade, score } = calculateGrade(analysisResult.issues || []);

    job.status = 'completed';
    job.completedAt = new Date();
    job.issues = analysisResult.issues || [];
    job.grade = grade;
    job.score = score;

    console.log(`Scan ${scanId} complete: ${job.issues.length} issues, grade ${grade}`);
  } catch (error) {
    console.error(`Scan ${scanId} failed:`, error);
    job.status = 'error';
    job.completedAt = new Date();
    job.error = error instanceof Error ? error.message : 'Unknown error';
  }
}

// POST /api/cli/scan - Start a new scan (returns immediately with scan ID)
router.post('/scan', async (req, res) => {
  try {
    const { files } = req.body as { files: FileContent[] };

    if (!files || !Array.isArray(files) || files.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const scanId = randomUUID();
    const job: ScanJob = {
      id: scanId,
      status: 'pending',
      filesCount: files.length,
      createdAt: new Date(),
    };

    scanJobs.set(scanId, job);

    console.log(`Started scan ${scanId}: ${files.length} files`);

    // Start analysis in background (don't await)
    runAnalysis(scanId, files);

    // Return immediately with scan ID
    res.status(202).json({
      scanId,
      status: 'pending',
      filesCount: files.length,
      message: 'Scan started. Poll GET /api/cli/scan/:scanId for results.',
    });
  } catch (error) {
    console.error('CLI scan error:', error);
    res.status(500).json({
      error: 'Failed to start scan',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
});

// GET /api/cli/scan/:scanId - Get scan status and results
router.get('/scan/:scanId', (req, res) => {
  const { scanId } = req.params;

  const job = scanJobs.get(scanId);
  if (!job) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  if (job.status === 'completed') {
    res.json({
      scanId: job.id,
      status: job.status,
      filesScanned: job.filesCount,
      issues: job.issues,
      grade: job.grade,
      score: job.score,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } else if (job.status === 'error') {
    res.json({
      scanId: job.id,
      status: job.status,
      filesScanned: job.filesCount,
      error: job.error,
      createdAt: job.createdAt,
      completedAt: job.completedAt,
    });
  } else {
    // pending or analyzing
    res.json({
      scanId: job.id,
      status: job.status,
      filesScanned: job.filesCount,
      createdAt: job.createdAt,
    });
  }
});

export default router;
