import { Router } from 'express';
import { db } from '../db/index.js';
import { apiTokens, workspaceMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import { requireAuth } from '../middleware/auth.js';
import crypto from 'crypto';

const router = Router();

// Generate a secure random token
function generateToken(): string {
  const bytes = crypto.randomBytes(32);
  return `cg_${bytes.toString('base64url')}`;
}

// Hash a token for storage
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// GET /api/tokens - List user's API tokens
router.get('/', requireAuth, async (req, res) => {
  try {
    const tokens = await db
      .select({
        id: apiTokens.id,
        name: apiTokens.name,
        tokenPrefix: apiTokens.tokenPrefix,
        workspaceId: apiTokens.workspaceId,
        lastUsedAt: apiTokens.lastUsedAt,
        expiresAt: apiTokens.expiresAt,
        createdAt: apiTokens.createdAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.userId, req.user!.id))
      .orderBy(apiTokens.createdAt);

    res.json(tokens);
  } catch (error) {
    console.error('List tokens error:', error);
    res.status(500).json({ error: 'Failed to list tokens' });
  }
});

// POST /api/tokens - Create a new API token
router.post('/', requireAuth, async (req, res) => {
  const { name, workspaceId, expiresIn } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Token name is required' });
  }

  if (!workspaceId || typeof workspaceId !== 'string') {
    return res.status(400).json({ error: 'Workspace ID is required' });
  }

  try {
    // Check user is a member of the workspace
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, req.user!.id)
        )
      );

    if (!membership) {
      return res.status(403).json({ error: 'You are not a member of this workspace' });
    }

    // Generate the token
    const token = generateToken();
    const tokenHash = hashToken(token);
    const tokenPrefix = token.substring(0, 11); // "cg_" + first 8 chars

    // Calculate expiration
    let expiresAt: Date | null = null;
    if (expiresIn) {
      expiresAt = new Date();
      switch (expiresIn) {
        case '30d':
          expiresAt.setDate(expiresAt.getDate() + 30);
          break;
        case '90d':
          expiresAt.setDate(expiresAt.getDate() + 90);
          break;
        case '1y':
          expiresAt.setFullYear(expiresAt.getFullYear() + 1);
          break;
        // 'never' or undefined = no expiration
      }
    }

    const [newToken] = await db
      .insert(apiTokens)
      .values({
        userId: req.user!.id,
        workspaceId,
        name: name.trim(),
        tokenHash,
        tokenPrefix,
        expiresAt,
      })
      .returning();

    // Return the full token only on creation (it won't be visible again)
    res.status(201).json({
      id: newToken.id,
      name: newToken.name,
      token, // Full token - only shown once
      tokenPrefix: newToken.tokenPrefix,
      workspaceId: newToken.workspaceId,
      expiresAt: newToken.expiresAt,
      createdAt: newToken.createdAt,
    });
  } catch (error) {
    console.error('Create token error:', error);
    res.status(500).json({ error: 'Failed to create token' });
  }
});

// DELETE /api/tokens/:id - Delete an API token
router.delete('/:id', requireAuth, async (req, res) => {
  try {
    const [token] = await db
      .select()
      .from(apiTokens)
      .where(
        and(
          eq(apiTokens.id, req.params.id),
          eq(apiTokens.userId, req.user!.id)
        )
      );

    if (!token) {
      return res.status(404).json({ error: 'Token not found' });
    }

    await db.delete(apiTokens).where(eq(apiTokens.id, req.params.id));

    res.json({ success: true });
  } catch (error) {
    console.error('Delete token error:', error);
    res.status(500).json({ error: 'Failed to delete token' });
  }
});

export default router;
