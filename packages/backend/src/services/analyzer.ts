import { spawn } from 'child_process';
import { eq } from 'drizzle-orm';
import { db, analysisRuns, issues } from '../db/index.js';
import { securityPrompt } from '../prompts/security.js';
import { reliabilityPrompt } from '../prompts/reliability.js';
import { parseReportFile } from './parser.js';
import path from 'path';
import fs from 'fs/promises';

// Claude CLI configuration for autonomous operation
const CLAUDE_CMD = process.env.CLAUDE_CMD || 'claude';
const CLAUDE_MAX_TURNS = process.env.CLAUDE_MAX_TURNS || '50';

export async function runAnalysis(
  repoPath: string,
  prompt: string,
  reportFileName: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    console.log(`Running Claude analysis in ${repoPath}...`);
    console.log(`Claude command: ${CLAUDE_CMD}`);

    // Flags for autonomous VM operation:
    // -p: Print mode (non-interactive, runs prompt and exits)
    // --dangerously-skip-permissions: Skip all permission prompts
    // --allowedTools: Restrict tools for security
    // --max-turns: Limit conversation turns to prevent runaway
    // --verbose: Log progress for debugging
    const args = [
      '-p', prompt,
      '--allowedTools', 'Write,Read,Bash,Glob,Grep',
      '--dangerously-skip-permissions',
      '--max-turns', CLAUDE_MAX_TURNS,
    ];

    console.log(`Claude args: ${args.join(' ').substring(0, 100)}...`);

    const claude = spawn(CLAUDE_CMD, args, {
      cwd: repoPath,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    claude.stdout?.on('data', (data) => {
      stdout += data.toString();
      console.log(`[Claude stdout]: ${data}`);
    });

    claude.stderr?.on('data', (data) => {
      stderr += data.toString();
      console.error(`[Claude stderr]: ${data}`);
    });

    claude.on('close', (code) => {
      if (code === 0) {
        console.log(`Claude analysis completed successfully for ${reportFileName}`);
        resolve();
      } else {
        const errorMsg = `Claude exited with code ${code}. stderr: ${stderr}`;
        console.error(errorMsg);
        reject(new Error(errorMsg));
      }
    });

    claude.on('error', (error) => {
      console.error(`Failed to spawn Claude process:`, error);
      reject(error);
    });
  });
}

export async function runFullAnalysis(repositoryId: number, repoPath: string): Promise<void> {
  console.log(`Starting full analysis for repository ${repositoryId} at ${repoPath}`);

  // Create .codeguard directory if it doesn't exist
  const codeguardDir = path.join(repoPath, '.codeguard');
  await fs.mkdir(codeguardDir, { recursive: true });

  // Run security analysis
  await runAnalysisType(
    repositoryId,
    repoPath,
    'security',
    securityPrompt,
    'security-report.json'
  );

  // Run reliability analysis
  await runAnalysisType(
    repositoryId,
    repoPath,
    'reliability',
    reliabilityPrompt,
    'reliability-report.json'
  );

  console.log(`Full analysis completed for repository ${repositoryId}`);
}

async function runAnalysisType(
  repositoryId: number,
  repoPath: string,
  type: 'security' | 'reliability',
  prompt: string,
  reportFileName: string
): Promise<void> {
  // Create analysis run record
  const [analysisRun] = await db
    .insert(analysisRuns)
    .values({
      repositoryId,
      type,
      status: 'running',
      startedAt: new Date(),
    })
    .returning();

  try {
    // Run the analysis
    await runAnalysis(repoPath, prompt, reportFileName);

    // Parse the report file
    const reportPath = path.join(repoPath, '.codeguard', reportFileName);

    try {
      await fs.access(reportPath);
    } catch {
      throw new Error(`Report file not found: ${reportPath}`);
    }

    const reportData = await parseReportFile(reportPath);

    // Insert issues into database
    if (reportData.issues && reportData.issues.length > 0) {
      const issueValues = reportData.issues.map((issue) => ({
        repositoryId,
        analysisRunId: analysisRun.id,
        type,
        issueId: issue.id,
        severity: issue.severity,
        category: issue.category,
        title: issue.title,
        description: issue.description,
        filePath: issue.file_path || null,
        lineStart: issue.line_start || null,
        lineEnd: issue.line_end || null,
        codeSnippet: issue.code_snippet || null,
        remediation: issue.remediation || null,
      }));

      await db.insert(issues).values(issueValues);
      console.log(`Inserted ${issueValues.length} ${type} issues for repository ${repositoryId}`);
    }

    // Update analysis run as completed
    await db
      .update(analysisRuns)
      .set({
        status: 'completed',
        completedAt: new Date(),
      })
      .where(eq(analysisRuns.id, analysisRun.id));
  } catch (error) {
    console.error(`Analysis failed for ${type}:`, error);

    // Update analysis run as error
    await db
      .update(analysisRuns)
      .set({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        completedAt: new Date(),
      })
      .where(eq(analysisRuns.id, analysisRun.id));

    throw error;
  }
}
