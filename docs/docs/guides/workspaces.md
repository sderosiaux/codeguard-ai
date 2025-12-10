# Workspaces & Team Management

Organize your repositories and collaborate with your team using workspaces.

## What are Workspaces?

Workspaces are isolated containers for your repositories. Each workspace has:

- Its own set of repositories
- Separate API tokens
- Team members with different roles
- Independent settings

## Creating a Workspace

1. Click your profile avatar in the top-right corner
2. Under **Workspaces**, click **Create workspace**
3. Type a name and press **Enter**

The new workspace becomes active immediately.

## Switching Workspaces

1. Click your profile avatar
2. Click any workspace in the list
3. The page reloads with that workspace's repositories

Your selection is remembered across sessions.

## Team Roles

Workspaces support four roles with different permissions:

| Role | View Repos | Add/Delete Repos | Manage Members | Delete Workspace |
|------|-----------|------------------|----------------|------------------|
| **Viewer** | Yes | No | No | No |
| **Member** | Yes | Yes | No | No |
| **Admin** | Yes | Yes | Yes | No |
| **Owner** | Yes | Yes | Yes | Yes |

## Inviting Team Members

1. Go to **Settings** > **Members** tab
2. Enter the person's email address
3. Select their role (Viewer, Member, or Admin)
4. Click **Send Invite**

The invitee receives an email with a link to join. Invitations expire after 7 days.

## Managing Members

### Changing Roles
1. Go to **Settings** > **Members**
2. Find the member in the list
3. Click the role dropdown
4. Select the new role

!!! note "Role Restrictions"
    - Only owners can change admin roles
    - Owners cannot be demoted (transfer ownership first)

### Removing Members
1. Go to **Settings** > **Members**
2. Click the remove button next to the member
3. Confirm the removal

### Canceling Invitations
Pending invitations appear in the **Pending Invites** section. Click the X to cancel.

## Workspace Settings

### Renaming a Workspace
1. Go to **Settings** > **General**
2. Edit the workspace name
3. Click **Save Changes**

### Deleting a Workspace

!!! danger "This is permanent"
    Deleting a workspace removes all its repositories and data. This cannot be undone.

1. Go to **Settings** > **General**
2. Click **Delete Workspace**
3. Type the workspace name to confirm
4. Click **Delete Workspace**

### Leaving a Workspace (Non-Owners)
1. Go to **Settings** > **General**
2. Click **Leave Workspace**
3. Confirm your choice

## Best Practices

### For Teams
- Create separate workspaces for different projects or clients
- Use the **Admin** role for team leads who need to manage members
- Use **Member** for developers who need to add and scan repositories
- Use **Viewer** for stakeholders who only need to see results

### For Personal Use
- Your default workspace is created automatically on signup
- Create additional workspaces to separate personal and work projects
