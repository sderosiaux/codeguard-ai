import { Router } from 'express';
import { OAuth2Client } from 'google-auth-library';
import { db } from '../db/index.js';
import { users, sessions, workspaces, workspaceMembers, workspaceInvites } from '../db/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import { spikelog } from '../services/spikelog.js';

const router = Router();

const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:5173';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

// Determine redirect URI based on environment
const getRedirectUri = () => {
  if (process.env.NODE_ENV === 'production') {
    return 'https://security-guard-ai.vercel.app/api/auth/google/callback';
  }
  return 'http://localhost:3001/api/auth/google/callback';
};

const oauthClient = new OAuth2Client(
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  getRedirectUri()
);

// Generate a URL-safe slug from workspace name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// Create session and return cookie
async function createSession(userId: string): Promise<string> {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 30); // 30 days

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      expiresAt,
    })
    .returning();

  return session.id;
}

// GET /api/auth/google - Redirect to Google OAuth
router.get('/google', (req, res) => {
  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
    ],
    prompt: 'select_account',
  });

  res.redirect(authUrl);
});

// GET /api/auth/google/callback - Handle OAuth callback
router.get('/google/callback', async (req, res) => {
  const { code } = req.query;

  if (!code || typeof code !== 'string') {
    return res.redirect(`${FRONTEND_URL}/login?error=no_code`);
  }

  try {
    // Exchange code for tokens
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);

    // Get user info
    const ticket = await oauthClient.verifyIdToken({
      idToken: tokens.id_token!,
      audience: GOOGLE_CLIENT_ID,
    });

    const payload = ticket.getPayload();
    if (!payload || !payload.email) {
      return res.redirect(`${FRONTEND_URL}/login?error=invalid_token`);
    }

    const { email, name, picture, sub: googleId } = payload;

    // Find or create user
    let [user] = await db.select().from(users).where(eq(users.googleId, googleId!));

    if (!user) {
      // Check if user exists by email (might have been invited)
      [user] = await db.select().from(users).where(eq(users.email, email));

      if (user) {
        // Link Google account to existing user
        [user] = await db
          .update(users)
          .set({ googleId, avatarUrl: picture, name: name || email.split('@')[0] })
          .where(eq(users.id, user.id))
          .returning();
      } else {
        // Create new user
        [user] = await db
          .insert(users)
          .values({
            email,
            name: name || email.split('@')[0],
            avatarUrl: picture,
            googleId,
          })
          .returning();

        // Create default personal workspace
        const workspaceName = `${name || email.split('@')[0]}'s Workspace`;
        let slug = generateSlug(workspaceName);

        // Ensure slug is unique
        const existingSlugs = await db.select({ slug: workspaces.slug }).from(workspaces);
        const slugSet = new Set(existingSlugs.map(w => w.slug));
        let counter = 1;
        const baseSlug = slug;
        while (slugSet.has(slug)) {
          slug = `${baseSlug}-${counter++}`;
        }

        const [workspace] = await db
          .insert(workspaces)
          .values({
            name: workspaceName,
            slug,
            ownerId: user.id,
          })
          .returning();

        // Add user as workspace owner member
        await db.insert(workspaceMembers).values({
          workspaceId: workspace.id,
          userId: user.id,
          role: 'owner',
        });
      }
    } else {
      // Update user info
      [user] = await db
        .update(users)
        .set({ avatarUrl: picture, name: name || user.name, updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
    }

    // Process pending workspace invitations for this user (case-insensitive)
    const pendingInvites = await db
      .select()
      .from(workspaceInvites)
      .where(ilike(workspaceInvites.email, email));

    for (const invite of pendingInvites) {
      // Check if user is already a member (avoid duplicates)
      const [existingMember] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.userId, user.id)
          )
        );

      if (!existingMember && invite.expiresAt > new Date()) {
        await db.insert(workspaceMembers).values({
          workspaceId: invite.workspaceId,
          userId: user.id,
          role: invite.role,
        });
      }
      // Delete the invitation regardless
      await db.delete(workspaceInvites).where(eq(workspaceInvites.id, invite.id));
    }

    // Create session
    const sessionId = await createSession(user.id);

    // Track OAuth login
    spikelog.oauthLogin();

    // Set session cookie and redirect
    res.cookie('session', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
      path: '/',
    });

    res.redirect(`${FRONTEND_URL}/app`);
  } catch (error) {
    console.error('Google OAuth error:', error);
    res.redirect(`${FRONTEND_URL}/login?error=oauth_failed`);
  }
});

// GET /api/auth/me - Get current user
router.get('/me', async (req, res) => {
  const sessionId = req.cookies?.session;

  if (!sessionId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Find session with user
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

    // Get user's workspaces
    const memberships = await db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, user.id));

    res.json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        avatarUrl: user.avatarUrl,
      },
      workspaces: memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        isOwner: m.workspace.ownerId === user.id,
      })),
    });
  } catch (error) {
    console.error('Auth check error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST /api/auth/logout - Logout
router.post('/logout', async (req, res) => {
  const sessionId = req.cookies?.session;

  if (sessionId) {
    try {
      await db.delete(sessions).where(eq(sessions.id, sessionId));
    } catch (error) {
      console.error('Logout error:', error);
    }
  }

  res.clearCookie('session', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
    path: '/',
  });

  res.json({ success: true });
});

export default router;
