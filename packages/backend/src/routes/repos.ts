import { Router } from 'express';
import { eq, sql, and } from 'drizzle-orm';
import { db, repositories, issues, repositoryShares, analysisRuns } from '../db/index.js';
import type { AnalysisStage, AgentProgress } from '../db/schema.js';
import { randomBytes } from 'crypto';
import { z } from 'zod';
import { cloneRepository, pullRepository, sanitizeGitError } from '../services/github.js';
import { runFullAnalysis, getCommitSha, type AnalysisProgressUpdate } from '../services/analyzer.js';
import type { AnalysisTrigger } from '../db/schema.js';
import { requireAuth, requireWorkspace, requireWriteAccess } from '../middleware/auth.js';
import { spikelog } from '../services/spikelog.js';
import path from 'path';
import fs from 'fs/promises';

// Helper to update analysis progress in database
async function updateAnalysisProgress(
  repoId: number,
  stage: AnalysisStage,
  agentProgress?: AgentProgress[]
): Promise<void> {
  await db
    .update(repositories)
    .set({
      analysisStage: stage,
      agentProgress: agentProgress || null,
      updatedAt: new Date(),
    })
    .where(eq(repositories.id, repoId));
}

const router = Router();

// All repo routes require authentication and workspace
router.use(requireAuth);
router.use(requireWorkspace);

// Validation schemas
const addRepoSchema = z.object({
  githubUrl: z.string().min(1),
  accessToken: z.string().optional(),
});

// Normalize input to full GitHub URL
function normalizeGitHubUrl(input: string): string {
  const trimmed = input.trim();

  // Already a full URL
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    if (!trimmed.includes('github.com')) {
      throw new Error('Must be a GitHub URL');
    }
    return trimmed;
  }

  // Shorthand format: owner/repo
  const shorthandMatch = trimmed.match(/^([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/);
  if (shorthandMatch) {
    return `https://github.com/${shorthandMatch[1]}/${shorthandMatch[2]}`;
  }

  throw new Error('Invalid format. Use "owner/repo" or full GitHub URL');
}

// Helper to extract owner and name from GitHub URL
function parseGitHubUrl(url: string): { owner: string; name: string } {
  const match = url.match(/github\.com\/([^\/]+)\/([^\/]+?)(\.git)?$/);
  if (!match) {
    throw new Error('Invalid GitHub URL format');
  }
  return {
    owner: match[1],
    name: match[2],
  };
}

// GET / - List repos in workspace with issue counts by severity
router.get('/', async (req, res, next) => {
  try {
    // Get repos in current workspace
    const repos = await db
      .select()
      .from(repositories)
      .where(eq(repositories.workspaceId, req.workspaceId!))
      .orderBy(repositories.createdAt);

    // Get issue counts by severity for all repos
    const issueCounts = await db
      .select({
        repositoryId: issues.repositoryId,
        severity: issues.severity,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(issues)
      .groupBy(issues.repositoryId, issues.severity);

    // Build a map of repo ID -> issue counts
    const issueCountsMap: Record<number, Record<string, number>> = {};
    for (const row of issueCounts) {
      if (!issueCountsMap[row.repositoryId]) {
        issueCountsMap[row.repositoryId] = { critical: 0, high: 0, medium: 0, low: 0 };
      }
      issueCountsMap[row.repositoryId][row.severity] = row.count;
    }

    // Merge repos with issue counts
    const reposWithCounts = repos.map((repo) => ({
      ...repo,
      issueCounts: issueCountsMap[repo.id] || { critical: 0, high: 0, medium: 0, low: 0 },
    }));

    res.json(reposWithCounts);
  } catch (error) {
    next(error);
  }
});

// POST / - Add new repo to workspace (requires write access)
router.post('/', requireWriteAccess, async (req, res, next) => {
  try {
    const body = addRepoSchema.parse(req.body);
    const githubUrl = normalizeGitHubUrl(body.githubUrl);
    const { owner, name } = parseGitHubUrl(githubUrl);

    // Check if repo already exists in this workspace
    const existing = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.workspaceId, req.workspaceId!),
          eq(repositories.githubUrl, githubUrl)
        )
      )
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Repository already exists in this workspace' });
    }

    // Insert new repo with pending status
    const [repo] = await db
      .insert(repositories)
      .values({
        workspaceId: req.workspaceId!,
        githubUrl,
        name,
        owner,
        status: 'pending',
        analysisStage: 'queued',
      })
      .returning();

    // Start background process to clone and analyze
    processRepository(repo.id, req.workspaceId!, githubUrl, owner, name, body.accessToken, 'initial').catch((err) => {
      console.error(`Background processing failed for repo ${repo.id}:`, err);
    });

    res.status(201).json(repo);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

// Helper to get repo with issue counts
async function getRepoWithIssueCounts(repoId: number) {
  const [repo] = await db
    .select()
    .from(repositories)
    .where(eq(repositories.id, repoId))
    .limit(1);

  if (!repo) return null;

  const issueCounts = await db
    .select({
      severity: issues.severity,
      count: sql<number>`cast(count(*) as integer)`,
    })
    .from(issues)
    .where(eq(issues.repositoryId, repoId))
    .groupBy(issues.severity);

  return {
    ...repo,
    issueCounts: issueCounts.reduce((acc, { severity, count }) => {
      acc[severity] = count;
      return acc;
    }, {} as Record<string, number>),
  };
}

// GET /by-name/:owner/:name - Get repo by owner/name in workspace
router.get('/by-name/:owner/:name', async (req, res, next) => {
  try {
    const { owner, name } = req.params;

    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.workspaceId, req.workspaceId!),
          eq(repositories.owner, owner),
          eq(repositories.name, name)
        )
      )
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    const repoWithCounts = await getRepoWithIssueCounts(repo.id);
    res.json(repoWithCounts);
  } catch (error) {
    next(error);
  }
});

// GET /:id - Get single repo details
router.get('/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const repoWithCounts = await getRepoWithIssueCounts(id);
    if (!repoWithCounts) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    res.json(repoWithCounts);
  } catch (error) {
    next(error);
  }
});

// GET /:id/status - Get analysis status with progress details
router.get('/:id/status', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const [repo] = await db
      .select({
        id: repositories.id,
        status: repositories.status,
        analysisStage: repositories.analysisStage,
        agentProgress: repositories.agentProgress,
        errorMessage: repositories.errorMessage,
        updatedAt: repositories.updatedAt,
      })
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    res.json({
      id: repo.id,
      status: repo.status,
      analysisStage: repo.analysisStage,
      agentProgress: repo.agentProgress,
      errorMessage: repo.errorMessage,
      updatedAt: repo.updatedAt,
    });
  } catch (error) {
    next(error);
  }
});

// GET /:id/history - Get analysis history with issue counts
router.get('/:id/history', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Check repo exists in this workspace
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, id),
          eq(repositories.workspaceId, req.workspaceId!)
        )
      )
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Get all analysis runs for this repo
    const runs = await db
      .select()
      .from(analysisRuns)
      .where(eq(analysisRuns.repositoryId, id))
      .orderBy(sql`${analysisRuns.createdAt} DESC`);

    // Get issue counts by severity for each run
    const issueCounts = await db
      .select({
        analysisRunId: issues.analysisRunId,
        severity: issues.severity,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(issues)
      .where(eq(issues.repositoryId, id))
      .groupBy(issues.analysisRunId, issues.severity);

    // Build map of run ID -> issue counts
    const issueCountsMap: Record<number, Record<string, number>> = {};
    for (const row of issueCounts) {
      if (row.analysisRunId) {
        if (!issueCountsMap[row.analysisRunId]) {
          issueCountsMap[row.analysisRunId] = { critical: 0, high: 0, medium: 0, low: 0 };
        }
        issueCountsMap[row.analysisRunId][row.severity] = row.count;
      }
    }

    // Merge runs with issue counts and compute duration
    const runsWithCounts = runs.map((run) => ({
      id: run.id,
      type: run.type,
      status: run.status,
      commitSha: run.commitSha,
      triggeredBy: run.triggeredBy,
      startedAt: run.startedAt,
      completedAt: run.completedAt,
      durationSeconds: run.startedAt && run.completedAt
        ? Math.round((new Date(run.completedAt).getTime() - new Date(run.startedAt).getTime()) / 1000)
        : null,
      errorMessage: run.errorMessage,
      createdAt: run.createdAt,
      issueCounts: issueCountsMap[run.id] || { critical: 0, high: 0, medium: 0, low: 0 },
    }));

    res.json({
      runs: runsWithCounts,
      githubUrl: repo.githubUrl, // For building commit links
      owner: repo.owner,
      name: repo.name,
    });
  } catch (error) {
    next(error);
  }
});

// POST /:id/recheck - Trigger re-analysis (requires write access)
router.post('/:id/recheck', requireWriteAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Optional access token for private repos
    const { accessToken } = req.body || {};

    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Update status to pending
    await db
      .update(repositories)
      .set({
        status: 'pending',
        analysisStage: 'queued',
        agentProgress: null,
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id));

    // Start background re-analysis with optional token
    processRepository(id, repo.workspaceId, repo.githubUrl, repo.owner, repo.name, accessToken, 'recheck').catch((err) => {
      console.error(`Re-analysis failed for repo ${id}:`, err);
    });

    // Return the updated repository
    const [updatedRepo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    res.json(updatedRepo);
  } catch (error) {
    next(error);
  }
});

// DELETE /:id - Remove repo (requires write access)
router.delete('/:id', requireWriteAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const [repo] = await db
      .select()
      .from(repositories)
      .where(eq(repositories.id, id))
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Delete local clone if it exists
    if (repo.localPath) {
      try {
        await fs.rm(repo.localPath, { recursive: true, force: true });
      } catch (err) {
        console.error(`Failed to delete local path ${repo.localPath}:`, err);
      }
    }

    // Delete from database (cascade will remove related records)
    await db.delete(repositories).where(eq(repositories.id, id));

    res.json({ message: 'Repository deleted successfully' });
  } catch (error) {
    next(error);
  }
});

// Background processing function
async function processRepository(
  repoId: number,
  workspaceId: string,
  githubUrl: string,
  owner: string,
  name: string,
  accessToken?: string,
  triggeredBy: AnalysisTrigger = 'initial'
): Promise<void> {
  const repoName = `${owner}/${name}`;
  const startTime = Date.now();

  try {
    // Delete old issues before re-analyzing
    await db.delete(issues).where(eq(issues.repositoryId, repoId));

    // Update status to cloning with stage tracking
    await db
      .update(repositories)
      .set({
        status: 'cloning',
        analysisStage: 'cloning',
        agentProgress: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    // Clone or pull repository
    const reposDir = process.env.REPOS_DIR || path.join(process.cwd(), 'repos');
    const workspaceDir = path.join(reposDir, workspaceId);
    await fs.mkdir(workspaceDir, { recursive: true });
    const localPath = path.join(workspaceDir, `${owner}-${name}`);

    // Check if directory already exists
    let dirExists = false;
    try {
      await fs.access(localPath);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    try {
      if (dirExists) {
        try {
          // Pull latest changes
          await pullRepository(localPath);
        } catch (pullError) {
          // Handle "dubious ownership" or other pull errors by re-cloning
          const errorMsg = pullError instanceof Error ? pullError.message : '';
          console.log(`Pull failed for ${localPath}: ${errorMsg.substring(0, 100)}...`);

          if (errorMsg.includes('dubious ownership') || errorMsg.includes('fatal:')) {
            console.log(`Deleting and re-cloning ${localPath}...`);
            try {
              await fs.rm(localPath, { recursive: true, force: true });
            } catch (rmError) {
              console.error(`Failed to delete ${localPath}:`, rmError);
              // Try to continue anyway - maybe clone will overwrite
            }
            await cloneRepository(githubUrl, localPath, accessToken);
          } else {
            throw pullError;
          }
        }
        // Remove old .codeguard folder for fresh analysis
        const codeguardPath = path.join(localPath, '.codeguard');
        try {
          await fs.rm(codeguardPath, { recursive: true, force: true });
        } catch {
          // Ignore if doesn't exist
        }
      } else {
        // Clone fresh (with optional token for private repos)
        await cloneRepository(githubUrl, localPath, accessToken);
      }
    } catch (cloneError) {
      // Track clone failure specifically - sanitize for logging
      const sanitizedError = sanitizeGitError(cloneError);
      spikelog.cloneFailure(repoName, sanitizedError);
      // Throw sanitized error so it's stored properly in DB
      throw new Error(sanitizedError);
    }

    // Update status to analyzing
    await db
      .update(repositories)
      .set({
        status: 'analyzing',
        analysisStage: 'detecting',
        localPath,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    // Get commit SHA for history tracking
    const commitSha = getCommitSha(localPath);

    // Run analysis with progress callback
    await runFullAnalysis(
      repoId,
      localPath,
      async (update: AnalysisProgressUpdate) => {
        await updateAnalysisProgress(repoId, update.stage, update.agentProgress);
      },
      { commitSha, triggeredBy }
    );

    // Get issue count for tracking
    const [issueCount] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(issues)
      .where(eq(issues.repositoryId, repoId));

    // Update status to completed
    await db
      .update(repositories)
      .set({
        status: 'completed',
        analysisStage: 'completed',
        agentProgress: null, // Clear agent progress on completion
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    // Track success metrics
    const durationSeconds = (Date.now() - startTime) / 1000;
    spikelog.analysisDuration(durationSeconds, repoName);
    spikelog.analysisResult(true, repoName);
    spikelog.issuesFound(issueCount?.count || 0, repoName);

    // Track total active repositories count
    const [activeRepoCount] = await db
      .select({ count: sql<number>`cast(count(*) as integer)` })
      .from(repositories)
      .where(eq(repositories.status, 'completed'));
    spikelog.activeRepositories(activeRepoCount?.count || 0);
  } catch (error) {
    console.error(`Processing failed for repo ${repoId}:`, error);
    await db
      .update(repositories)
      .set({
        status: 'error',
        analysisStage: 'error',
        agentProgress: null,
        errorMessage: sanitizeGitError(error),
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    // Track failure
    spikelog.analysisResult(false, repoName);
  }
}

// ==================== SHARE MANAGEMENT ====================

// Validation schema for creating shares
const createShareSchema = z.object({
  expiresIn: z.enum(['never', '1d', '7d', '30d']).optional(),
});

// GET /:id/shares - List all shares for a repo
router.get('/:id/shares', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Check repo exists in this workspace
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, id),
          eq(repositories.workspaceId, req.workspaceId!)
        )
      )
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    const shares = await db
      .select()
      .from(repositoryShares)
      .where(eq(repositoryShares.repositoryId, id))
      .orderBy(repositoryShares.createdAt);

    res.json(shares);
  } catch (error) {
    next(error);
  }
});

// POST /:id/shares - Create a new share link (requires write access)
router.post('/:id/shares', requireWriteAccess, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    const body = createShareSchema.parse(req.body || {});

    // Check repo exists in this workspace
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, id),
          eq(repositories.workspaceId, req.workspaceId!)
        )
      )
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Generate a unique token
    const token = randomBytes(16).toString('hex');

    // Calculate expiration date
    let expiresAt: Date | null = null;
    if (body.expiresIn && body.expiresIn !== 'never') {
      const now = new Date();
      switch (body.expiresIn) {
        case '1d':
          expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000);
          break;
        case '7d':
          expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
          break;
        case '30d':
          expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
          break;
      }
    }

    const [share] = await db
      .insert(repositoryShares)
      .values({
        repositoryId: id,
        token,
        createdBy: req.user!.id,
        expiresAt,
      })
      .returning();

    res.status(201).json(share);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

// DELETE /:id/shares/:shareId - Delete a share link (requires write access)
router.delete('/:id/shares/:shareId', requireWriteAccess, async (req, res, next) => {
  try {
    const repoId = parseInt(req.params.id);
    const shareId = req.params.shareId;

    if (isNaN(repoId)) {
      return res.status(400).json({ error: 'Invalid repository ID' });
    }

    // Check repo exists in this workspace
    const [repo] = await db
      .select()
      .from(repositories)
      .where(
        and(
          eq(repositories.id, repoId),
          eq(repositories.workspaceId, req.workspaceId!)
        )
      )
      .limit(1);

    if (!repo) {
      return res.status(404).json({ error: 'Repository not found' });
    }

    // Delete the share
    const deleted = await db
      .delete(repositoryShares)
      .where(
        and(
          eq(repositoryShares.id, shareId),
          eq(repositoryShares.repositoryId, repoId)
        )
      )
      .returning();

    if (deleted.length === 0) {
      return res.status(404).json({ error: 'Share link not found' });
    }

    res.json({ message: 'Share link deleted successfully' });
  } catch (error) {
    next(error);
  }
});

export default router;
