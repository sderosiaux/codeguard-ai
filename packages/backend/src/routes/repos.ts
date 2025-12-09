import { Router } from 'express';
import { eq, sql } from 'drizzle-orm';
import { db, repositories, issues } from '../db/index.js';
import { z } from 'zod';
import { cloneRepository, pullRepository } from '../services/github.js';
import { runFullAnalysis } from '../services/analyzer.js';
import path from 'path';
import fs from 'fs/promises';

const router = Router();

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

// GET / - List all repos with issue counts by severity
router.get('/', async (req, res, next) => {
  try {
    // Get all repos first
    const repos = await db
      .select()
      .from(repositories)
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

// POST / - Add new repo
router.post('/', async (req, res, next) => {
  try {
    const body = addRepoSchema.parse(req.body);
    const githubUrl = normalizeGitHubUrl(body.githubUrl);
    const { owner, name } = parseGitHubUrl(githubUrl);

    // Check if repo already exists
    const existing = await db
      .select()
      .from(repositories)
      .where(eq(repositories.githubUrl, githubUrl))
      .limit(1);

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Repository already exists' });
    }

    // Insert new repo with pending status
    const [repo] = await db
      .insert(repositories)
      .values({
        githubUrl,
        name,
        owner,
        status: 'pending',
      })
      .returning();

    // Start background process to clone and analyze
    processRepository(repo.id, githubUrl, owner, name, body.accessToken).catch((err) => {
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

// GET /:id - Get single repo details
router.get('/:id', async (req, res, next) => {
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

    // Get issue counts by severity
    const issueCounts = await db
      .select({
        severity: issues.severity,
        count: sql<number>`cast(count(*) as integer)`,
      })
      .from(issues)
      .where(eq(issues.repositoryId, id))
      .groupBy(issues.severity);

    res.json({
      ...repo,
      issueCounts: issueCounts.reduce((acc, { severity, count }) => {
        acc[severity] = count;
        return acc;
      }, {} as Record<string, number>),
    });
  } catch (error) {
    next(error);
  }
});

// POST /:id/recheck - Trigger re-analysis
router.post('/:id/recheck', async (req, res, next) => {
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

    // Update status to pending
    await db
      .update(repositories)
      .set({
        status: 'pending',
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, id));

    // Start background re-analysis
    processRepository(id, repo.githubUrl, repo.owner, repo.name).catch((err) => {
      console.error(`Re-analysis failed for repo ${id}:`, err);
    });

    res.json({ message: 'Re-analysis started' });
  } catch (error) {
    next(error);
  }
});

// DELETE /:id - Remove repo
router.delete('/:id', async (req, res, next) => {
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
  githubUrl: string,
  owner: string,
  name: string,
  accessToken?: string
): Promise<void> {
  try {
    // Delete old issues before re-analyzing
    await db.delete(issues).where(eq(issues.repositoryId, repoId));

    // Update status to cloning
    await db
      .update(repositories)
      .set({ status: 'cloning', updatedAt: new Date() })
      .where(eq(repositories.id, repoId));

    // Clone or pull repository
    const reposDir = process.env.REPOS_DIR || path.join(process.cwd(), 'repos');
    await fs.mkdir(reposDir, { recursive: true });
    const localPath = path.join(reposDir, `${owner}-${name}-${repoId}`);

    // Check if directory already exists
    let dirExists = false;
    try {
      await fs.access(localPath);
      dirExists = true;
    } catch {
      dirExists = false;
    }

    if (dirExists) {
      // Pull latest changes (note: will fail for private repos without stored token)
      await pullRepository(localPath);
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

    // Update status to analyzing
    await db
      .update(repositories)
      .set({
        status: 'analyzing',
        localPath,
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));

    // Run analysis
    await runFullAnalysis(repoId, localPath);

    // Update status to completed
    await db
      .update(repositories)
      .set({
        status: 'completed',
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));
  } catch (error) {
    console.error(`Processing failed for repo ${repoId}:`, error);
    await db
      .update(repositories)
      .set({
        status: 'error',
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
        updatedAt: new Date(),
      })
      .where(eq(repositories.id, repoId));
  }
}

export default router;
