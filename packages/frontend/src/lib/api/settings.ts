const API_URL = import.meta.env.VITE_API_URL || '/api';

// Types
export interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  workspaceId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

export interface CreateTokenResponse extends ApiToken {
  token: string;
}

export interface CreateTokenParams {
  name: string;
  workspaceId: string;
  expiresIn?: string;
}

export interface WorkspaceMember {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  joinedAt: string;
}

export interface WorkspaceInvite {
  id: string;
  email: string;
  role: string;
  expiresAt: string;
  createdAt: string;
}

export interface WorkspaceDetails {
  id: string;
  name: string;
  slug: string;
  role: string;
  isOwner: boolean;
  createdAt: string;
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
}

// Shared fetch helper with credentials
async function apiFetch<T>(
  url: string,
  options?: RequestInit
): Promise<T> {
  const response = await fetch(`${API_URL}${url}`, {
    credentials: 'include',
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'Request failed');
  }

  return response.json();
}

// Token API
export async function fetchTokens(): Promise<ApiToken[]> {
  return apiFetch('/tokens');
}

export async function createToken(params: CreateTokenParams): Promise<CreateTokenResponse> {
  return apiFetch('/tokens', {
    method: 'POST',
    body: JSON.stringify(params),
  });
}

export async function deleteToken(id: string): Promise<void> {
  await apiFetch(`/tokens/${id}`, {
    method: 'DELETE',
  });
}

// Workspace API
export async function fetchWorkspaceDetails(workspaceId: string): Promise<WorkspaceDetails> {
  return apiFetch(`/workspaces/${workspaceId}`);
}

export async function inviteMember(params: {
  workspaceId: string;
  email: string;
  role: string;
}): Promise<void> {
  await apiFetch(`/workspaces/${params.workspaceId}/invite`, {
    method: 'POST',
    body: JSON.stringify({ email: params.email, role: params.role }),
  });
}

export async function removeMember(params: {
  workspaceId: string;
  userId: string;
}): Promise<void> {
  await apiFetch(`/workspaces/${params.workspaceId}/members/${params.userId}`, {
    method: 'DELETE',
  });
}

export async function cancelInvite(params: {
  workspaceId: string;
  inviteId: string;
}): Promise<void> {
  await apiFetch(`/workspaces/${params.workspaceId}/invites/${params.inviteId}`, {
    method: 'DELETE',
  });
}

export async function updateMemberRole(params: {
  workspaceId: string;
  userId: string;
  role: string;
}): Promise<void> {
  await apiFetch(`/workspaces/${params.workspaceId}/members/${params.userId}`, {
    method: 'PATCH',
    body: JSON.stringify({ role: params.role }),
  });
}

// Workspace CRUD
export interface CreateWorkspaceResponse {
  id: string;
  name: string;
  slug: string;
  ownerId: string;
  createdAt: string;
}

export async function createWorkspace(name: string): Promise<CreateWorkspaceResponse> {
  return apiFetch('/workspaces', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function deleteWorkspace(workspaceId: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}`, {
    method: 'DELETE',
  });
}

export async function leaveWorkspace(workspaceId: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}/leave`, {
    method: 'POST',
  });
}

export async function renameWorkspace(workspaceId: string, name: string): Promise<void> {
  await apiFetch(`/workspaces/${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify({ name }),
  });
}
