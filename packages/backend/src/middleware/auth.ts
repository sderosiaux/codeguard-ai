import { Request, Response, NextFunction } from 'express';
import { db } from '../db/index.js';
import { users, sessions, workspaceMembers, workspaces } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';

// Extend Express Request type
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        avatarUrl: string | null;
      };
      workspaceId?: string;
      workspaceRole?: string;
    }
  }
}

// Require authentication
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionId = req.cookies?.session;

  if (!sessionId) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  try {
    // Find session
    const [session] = await db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));

    if (!session || session.expiresAt < new Date()) {
      res.clearCookie('session');
      return res.status(401).json({ error: 'Session expired' });
    }

    // Get user
    const [user] = await db.select().from(users).where(eq(users.id, session.userId));

    if (!user) {
      res.clearCookie('session');
      return res.status(401).json({ error: 'User not found' });
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Require workspace membership
export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  // First ensure user is authenticated
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Get workspace from header, query param, or URL path param
  const workspaceId = req.headers['x-workspace-id'] as string
    || req.query.workspaceId as string
    || req.params.id as string;

  if (!workspaceId) {
    return res.status(400).json({ error: 'Workspace ID required' });
  }

  try {
    // Check workspace membership
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.userId, req.user.id)
        )
      );

    if (!membership) {
      return res.status(403).json({ error: 'Not a member of this workspace' });
    }

    req.workspaceId = workspaceId;
    req.workspaceRole = membership.role;

    next();
  } catch (error) {
    console.error('Workspace middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}

// Require workspace admin or owner role
export async function requireWorkspaceAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.workspaceRole || !['owner', 'admin'].includes(req.workspaceRole)) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
}

// Require workspace owner role
export async function requireWorkspaceOwner(req: Request, res: Response, next: NextFunction) {
  if (req.workspaceRole !== 'owner') {
    return res.status(403).json({ error: 'Owner access required' });
  }
  next();
}

// Require write access (owner, admin, or member - not viewer)
export async function requireWriteAccess(req: Request, res: Response, next: NextFunction) {
  if (!req.workspaceRole || req.workspaceRole === 'viewer') {
    return res.status(403).json({ error: 'Write access required. Viewers have read-only access.' });
  }
  next();
}

// Import for API key authentication
import { apiTokens } from '../db/schema.js';
import crypto from 'crypto';

// Hash a token for comparison
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Require API key authentication (for CLI and API access)
export async function requireApiKey(req: Request, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'API key required. Use Authorization: Bearer <token>' });
  }

  const token = authHeader.substring(7);

  if (!token.startsWith('cg_')) {
    return res.status(401).json({ error: 'Invalid API key format' });
  }

  try {
    const tokenHash = hashToken(token);

    // Find the token in database
    const [apiToken] = await db
      .select({
        id: apiTokens.id,
        userId: apiTokens.userId,
        workspaceId: apiTokens.workspaceId,
        expiresAt: apiTokens.expiresAt,
      })
      .from(apiTokens)
      .where(eq(apiTokens.tokenHash, tokenHash));

    if (!apiToken) {
      return res.status(401).json({ error: 'Invalid API key' });
    }

    // Check expiration
    if (apiToken.expiresAt && apiToken.expiresAt < new Date()) {
      return res.status(401).json({ error: 'API key expired' });
    }

    // Get user info
    const [user] = await db.select().from(users).where(eq(users.id, apiToken.userId));

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    // Update last used timestamp (fire and forget)
    db.update(apiTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(apiTokens.id, apiToken.id))
      .catch(() => {}); // Ignore errors

    // Attach user and workspace to request
    req.user = {
      id: user.id,
      email: user.email,
      name: user.name,
      avatarUrl: user.avatarUrl,
    };
    req.workspaceId = apiToken.workspaceId;

    // Get workspace role
    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, apiToken.workspaceId),
          eq(workspaceMembers.userId, user.id)
        )
      );

    req.workspaceRole = membership?.role || 'member';

    next();
  } catch (error) {
    console.error('API key auth error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
