import { spawn, execSync } from 'child_process';
import { eq } from 'drizzle-orm';
import { db, analysisRuns, issues } from '../db/index.js';
import { generateOrchestratorPrompt, AgentDefinition } from '../prompts/combined.js';
import { parseReportFile } from './parser.js';
import { postProcessReports, writeUnifiedReport, ProcessedIssue, IssueType } from './postProcessor.js';
import type { AnalysisStage, AgentProgress, AnalysisTrigger } from '../db/schema.js';
import path from 'path';
import fs from 'fs/promises';

/**
 * Get the current HEAD commit SHA from a git repository
 */
export function getCommitSha(repoPath: string): string | null {
  try {
    const sha = execSync('git rev-parse HEAD', {
      cwd: repoPath,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    return sha || null;
  } catch {
    return null;
  }
}

// Progress callback type for real-time updates
export interface AnalysisProgressUpdate {
  stage: AnalysisStage;
  agentProgress?: AgentProgress[];
  detectedStack?: string[];
}

export type ProgressCallback = (update: AnalysisProgressUpdate) => Promise<void>;

// Patterns to identify test files (filter out issues from these)
const TEST_DIR_PATTERNS = /[/\\](test|tests|__tests__|__test__|spec|specs|__mocks__|__fixtures__|fixtures)[/\\]/i;
const TEST_FILE_PATTERNS = /\.(test|spec)\.[^/\\]+$|[_-](test|spec)\.[^/\\]+$|(test|spec)[_-][^/\\]+\.[^/\\]+$/i;
const TEST_CONFIG_PATTERNS = /(jest|vitest|karma|mocha)\.config\.|\.stories?\./i;
const MOCK_FILE_PATTERNS = /\.mock\.|Mock\.[^/\\]+$|[/\\]mock[^/\\]*\.[^/\\]+$/i;

/**
 * Check if a file path is a test file that should be filtered out
 */
function isTestFile(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return (
    TEST_DIR_PATTERNS.test(filePath) ||
    TEST_FILE_PATTERNS.test(filePath) ||
    TEST_CONFIG_PATTERNS.test(filePath) ||
    MOCK_FILE_PATTERNS.test(filePath)
  );
}

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

async function processReport(
  repositoryId: number,
  repoPath: string,
  type: IssueType,
  reportFileName: string
): Promise<void> {
  const reportPath = path.join(repoPath, '.codeguard', reportFileName);

  // Check if report file exists
  try {
    await fs.access(reportPath);
  } catch {
    console.warn(`Report file not found: ${reportPath} - skipping ${type} analysis`);
    return;
  }

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
    const reportData = await parseReportFile(reportPath);

    // Insert issues into database (filter out test files)
    if (reportData.issues && reportData.issues.length > 0) {
      const productionIssues = reportData.issues.filter(
        (issue) => !isTestFile(issue.file_path)
      );

      const filteredCount = reportData.issues.length - productionIssues.length;
      if (filteredCount > 0) {
        console.log(`Filtered out ${filteredCount} issues from test files`);
      }

      if (productionIssues.length > 0) {
        const issueValues = productionIssues.map((issue) => ({
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
    console.error(`Processing ${type} report failed:`, error);

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

export interface AnalysisOptions {
  commitSha?: string | null;
  triggeredBy?: AnalysisTrigger;
  triggeredByUserId?: string | null;
}

export async function runFullAnalysis(
  repositoryId: number,
  repoPath: string,
  onProgress?: ProgressCallback,
  options?: AnalysisOptions
): Promise<number> {
  console.log(`Starting full analysis for repository ${repositoryId} at ${repoPath}`);

  // Capture start time for accurate duration tracking
  const analysisStartTime = new Date();

  // Create .codeguard directory if it doesn't exist
  const codeguardDir = path.join(repoPath, '.codeguard');
  await fs.mkdir(codeguardDir, { recursive: true });

  // Stage 1: Detecting tech stack
  await onProgress?.({ stage: 'detecting' });

  // Generate orchestrator prompt with specialized agents
  const { prompt, agents, tieredResult } = await generateOrchestratorPrompt(repoPath);
  const detectedStack = Array.from(tieredResult.detectedStack.types);

  // Log which agents will run
  console.log(`Detected stack: ${detectedStack.join(', ') || 'Generic'}`);
  console.log(`Spawning ${agents.length} specialized agents:`);
  agents.forEach(a => console.log(`  - ${a.name} (${a.tier}) → ${a.outputFile}`));

  // Create analysis run record at START for accurate duration tracking
  const [analysisRun] = await db
    .insert(analysisRuns)
    .values({
      repositoryId,
      type: 'full',
      status: 'running',
      commitSha: options?.commitSha || null,
      triggeredBy: options?.triggeredBy || 'initial',
      triggeredByUserId: options?.triggeredByUserId || null,
      startedAt: analysisStartTime,
    })
    .returning();

  // Stage 2: Running agents
  const agentProgress: AgentProgress[] = agents.map(a => ({
    id: a.id,
    name: a.name,
    status: 'running' as const,
    startedAt: new Date().toISOString(),
  }));

  await onProgress?.({
    stage: 'analyzing',
    agentProgress,
    detectedStack,
  });

  // Run orchestrator (spawns all agents in parallel)
  await runAnalysis(repoPath, prompt, 'orchestrator');

  // Stage 3: Post-processing
  // Mark all agents as completed (since Claude finished)
  const completedAgentProgress = agentProgress.map(a => ({
    ...a,
    status: 'completed' as const,
    completedAt: new Date().toISOString(),
  }));

  await onProgress?.({
    stage: 'processing',
    agentProgress: completedAgentProgress,
    detectedStack,
  });

  console.log('Post-processing agent reports...');
  const processedIssues = await postProcessReports(repoPath);

  // Filter out test files
  const productionIssues = processedIssues.filter(
    issue => !isTestFile(issue.file_path)
  );

  const filteredCount = processedIssues.length - productionIssues.length;
  if (filteredCount > 0) {
    console.log(`Filtered out ${filteredCount} issues from test files`);
  }

  // Write unified report for debugging/reference
  await writeUnifiedReport(repoPath, productionIssues);

  // Insert all issues with their assigned types
  if (productionIssues.length > 0) {
    const issueValues = productionIssues.map((issue, index) => ({
      repositoryId,
      analysisRunId: analysisRun.id,
      type: issue.type,
      issueId: issue.id || `ISSUE-${index + 1}`,
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
    console.log(`Inserted ${issueValues.length} issues for repository ${repositoryId}`);
  } else {
    console.log('No production issues found (analysis run recorded)');
  }

  // Update analysis run as completed with accurate end time
  await db
    .update(analysisRuns)
    .set({
      status: 'completed',
      completedAt: new Date(),
    })
    .where(eq(analysisRuns.id, analysisRun.id));

  // Stage 4: Completed
  await onProgress?.({
    stage: 'completed',
    agentProgress: completedAgentProgress,
    detectedStack,
  });

  console.log(`Full analysis completed for repository ${repositoryId}`);

  return analysisRun.id;
}

