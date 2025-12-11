import { Router } from 'express';
import { db } from '../db/index.js';
import { workspaces, workspaceMembers, workspaceInvites, users } from '../db/schema.js';
import { eq, and, ilike } from 'drizzle-orm';
import { requireAuth, requireWorkspace, requireWorkspaceAdmin, requireWorkspaceOwner } from '../middleware/auth.js';

const router = Router();

// Generate a URL-safe slug from workspace name
function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .substring(0, 50);
}

// GET /api/workspaces - List user's workspaces
router.get('/', requireAuth, async (req, res) => {
  try {
    const memberships = await db
      .select({
        workspace: workspaces,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaceMembers.workspaceId, workspaces.id))
      .where(eq(workspaceMembers.userId, req.user!.id));

    res.json(
      memberships.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
        slug: m.workspace.slug,
        role: m.role,
        isOwner: m.workspace.ownerId === req.user!.id,
        createdAt: m.workspace.createdAt,
      }))
    );
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// POST /api/workspaces - Create a new workspace
router.post('/', requireAuth, async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Workspace name is required' });
  }

  try {
    let slug = generateSlug(name.trim());

    // Ensure slug is unique
    const existingSlugs = await db.select({ slug: workspaces.slug }).from(workspaces);
    const slugSet = new Set(existingSlugs.map((w) => w.slug));
    let counter = 1;
    const baseSlug = slug;
    while (slugSet.has(slug)) {
      slug = `${baseSlug}-${counter++}`;
    }

    const [workspace] = await db
      .insert(workspaces)
      .values({
        name: name.trim(),
        slug,
        ownerId: req.user!.id,
      })
      .returning();

    // Add creator as owner member
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId: req.user!.id,
      role: 'owner',
    });

    res.status(201).json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: 'owner',
      isOwner: true,
      createdAt: workspace.createdAt,
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// GET /api/workspaces/:id - Get workspace details
router.get('/:id', requireAuth, requireWorkspace, async (req, res) => {
  try {
    const [workspace] = await db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, req.params.id));

    if (!workspace) {
      return res.status(404).json({ error: 'Workspace not found' });
    }

    // Get members
    const members = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        avatarUrl: users.avatarUrl,
        role: workspaceMembers.role,
        joinedAt: workspaceMembers.createdAt,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(workspaceMembers.userId, users.id))
      .where(eq(workspaceMembers.workspaceId, workspace.id));

    // Get pending invites
    const invites = await db
      .select({
        id: workspaceInvites.id,
        email: workspaceInvites.email,
        role: workspaceInvites.role,
        expiresAt: workspaceInvites.expiresAt,
        createdAt: workspaceInvites.createdAt,
      })
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, workspace.id));

    res.json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
      role: req.workspaceRole,
      isOwner: workspace.ownerId === req.user!.id,
      createdAt: workspace.createdAt,
      members,
      invites: invites.filter((i) => i.expiresAt > new Date()),
    });
  } catch (error) {
    console.error('Get workspace error:', error);
    res.status(500).json({ error: 'Failed to get workspace' });
  }
});

// PATCH /api/workspaces/:id - Update workspace
router.patch('/:id', requireAuth, requireWorkspace, requireWorkspaceAdmin, async (req, res) => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    return res.status(400).json({ error: 'Workspace name is required' });
  }

  try {
    const [workspace] = await db
      .update(workspaces)
      .set({ name: name.trim(), updatedAt: new Date() })
      .where(eq(workspaces.id, req.params.id))
      .returning();

    res.json({
      id: workspace.id,
      name: workspace.name,
      slug: workspace.slug,
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(500).json({ error: 'Failed to update workspace' });
  }
});

// DELETE /api/workspaces/:id - Delete workspace
router.delete('/:id', requireAuth, requireWorkspace, requireWorkspaceOwner, async (req, res) => {
  try {
    await db.delete(workspaces).where(eq(workspaces.id, req.params.id));
    res.json({ success: true });
  } catch (error) {
    console.error('Delete workspace error:', error);
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

// POST /api/workspaces/:id/invite - Invite a member
router.post('/:id/invite', requireAuth, requireWorkspace, requireWorkspaceAdmin, async (req, res) => {
  const { email, role = 'member' } = req.body;

  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Email is required' });
  }

  if (!['admin', 'member', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    // Check if user is already a member (case-insensitive email match)
    const [existingUser] = await db.select().from(users).where(ilike(users.email, email));

    if (existingUser) {
      const [existingMember] = await db
        .select()
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, req.params.id),
            eq(workspaceMembers.userId, existingUser.id)
          )
        );

      if (existingMember) {
        return res.status(400).json({ error: 'User is already a member' });
      }

      // Add existing user directly
      await db.insert(workspaceMembers).values({
        workspaceId: req.params.id,
        userId: existingUser.id,
        role,
      });

      return res.status(201).json({ message: 'Member added successfully' });
    }

    // Check for existing invite
    const [existingInvite] = await db
      .select()
      .from(workspaceInvites)
      .where(
        and(
          eq(workspaceInvites.workspaceId, req.params.id),
          eq(workspaceInvites.email, email.toLowerCase())
        )
      );

    if (existingInvite && existingInvite.expiresAt > new Date()) {
      return res.status(400).json({ error: 'Invite already sent' });
    }

    // Create invite
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7); // 7 days

    if (existingInvite) {
      await db
        .update(workspaceInvites)
        .set({ role, expiresAt, invitedBy: req.user!.id })
        .where(eq(workspaceInvites.id, existingInvite.id));
    } else {
      await db.insert(workspaceInvites).values({
        workspaceId: req.params.id,
        email: email.toLowerCase(),
        role,
        invitedBy: req.user!.id,
        expiresAt,
      });
    }

    res.status(201).json({ message: 'Invite sent successfully' });
  } catch (error) {
    console.error('Invite member error:', error);
    res.status(500).json({ error: 'Failed to send invite' });
  }
});

// DELETE /api/workspaces/:id/members/:userId - Remove a member
router.delete('/:id/members/:userId', requireAuth, requireWorkspace, requireWorkspaceAdmin, async (req, res) => {
  const { userId } = req.params;

  try {
    // Can't remove owner
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, req.params.id));

    if (workspace.ownerId === userId) {
      return res.status(400).json({ error: 'Cannot remove workspace owner' });
    }

    // Only owner can remove admins
    const [memberToRemove] = await db
      .select()
      .from(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, req.params.id), eq(workspaceMembers.userId, userId))
      );

    if (memberToRemove?.role === 'admin' && req.workspaceRole !== 'owner') {
      return res.status(403).json({ error: 'Only owner can remove admins' });
    }

    await db
      .delete(workspaceMembers)
      .where(
        and(eq(workspaceMembers.workspaceId, req.params.id), eq(workspaceMembers.userId, userId))
      );

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(500).json({ error: 'Failed to remove member' });
  }
});

// PATCH /api/workspaces/:id/members/:userId - Update member role
router.patch('/:id/members/:userId', requireAuth, requireWorkspace, requireWorkspaceOwner, async (req, res) => {
  const { userId } = req.params;
  const { role } = req.body;

  if (!['admin', 'member', 'viewer'].includes(role)) {
    return res.status(400).json({ error: 'Invalid role' });
  }

  try {
    // Can't change owner's role
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, req.params.id));

    if (workspace.ownerId === userId) {
      return res.status(400).json({ error: 'Cannot change owner role' });
    }

    await db
      .update(workspaceMembers)
      .set({ role })
      .where(
        and(eq(workspaceMembers.workspaceId, req.params.id), eq(workspaceMembers.userId, userId))
      );

    res.json({ success: true });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(500).json({ error: 'Failed to update member role' });
  }
});

// DELETE /api/workspaces/:id/invites/:inviteId - Cancel invite
router.delete('/:id/invites/:inviteId', requireAuth, requireWorkspace, requireWorkspaceAdmin, async (req, res) => {
  try {
    await db.delete(workspaceInvites).where(eq(workspaceInvites.id, req.params.inviteId));
    res.json({ success: true });
  } catch (error) {
    console.error('Cancel invite error:', error);
    res.status(500).json({ error: 'Failed to cancel invite' });
  }
});

// POST /api/workspaces/:id/leave - Leave workspace
router.post('/:id/leave', requireAuth, requireWorkspace, async (req, res) => {
  try {
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, req.params.id));

    if (workspace.ownerId === req.user!.id) {
      return res.status(400).json({ error: 'Owner cannot leave workspace. Transfer ownership or delete the workspace.' });
    }

    await db
      .delete(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, req.params.id),
          eq(workspaceMembers.userId, req.user!.id)
        )
      );

    res.json({ success: true });
  } catch (error) {
    console.error('Leave workspace error:', error);
    res.status(500).json({ error: 'Failed to leave workspace' });
  }
});

export default router;
