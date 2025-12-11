const API_BASE = import.meta.env.VITE_API_URL || '/api';

// Helper to get current workspace ID from localStorage
function getWorkspaceId(): string | null {
  return localStorage.getItem('currentWorkspaceId');
}

// Helper to build headers with workspace ID
function buildHeaders(customHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  const workspaceId = getWorkspaceId();
  if (workspaceId) {
    headers['X-Workspace-Id'] = workspaceId;
  }
  return headers;
}

// Authenticated fetch wrapper
async function authFetch(url: string, options: RequestInit = {}): Promise<Response> {
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: buildHeaders(options.headers as Record<string, string>),
  });

  if (response.status === 401) {
    // Redirect to login on auth failure
    window.location.href = '/login';
    throw new Error('Authentication required');
  }

  return response;
}

export interface Repository {
  id: number;
  workspaceId: string;
  githubUrl: string;
  owner: string;
  name: string;
  status: 'pending' | 'cloning' | 'analyzing' | 'completed' | 'failed' | 'error';
  errorMessage?: string | null;
  localPath?: string | null;
  createdAt: string;
  updatedAt: string;
  issueCounts?: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
}

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
}

export type IssueType =
  | 'security'
  | 'reliability'
  | 'kafka'
  | 'database'
  | 'distributed'
  | 'concurrency'
  | 'resilience';

export interface Issue {
  id: number;
  repositoryId: number;
  analysisRunId: number;
  type: IssueType;
  issueId: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  category: string;
  title: string;
  description: string;
  filePath: string | null;
  lineStart: number | null;
  lineEnd: number | null;
  codeSnippet: string | null;
  remediation: string | null;
  createdAt: string;
}

export interface IssuesByFile {
  [filePath: string]: Issue[];
}

export interface FileIssues {
  filePath: string;
  issueCount: number;
  issues: Issue[];
}

export async function fetchRepos(): Promise<Repository[]> {
  const response = await authFetch(`${API_BASE}/repos`);
  if (!response.ok) throw new Error('Failed to fetch repositories');
  return response.json();
}

export async function fetchRepo(id: string): Promise<Repository> {
  const response = await authFetch(`${API_BASE}/repos/${id}`);
  if (!response.ok) throw new Error('Failed to fetch repository');
  return response.json();
}

export async function fetchRepoByName(owner: string, name: string): Promise<Repository> {
  const response = await authFetch(`${API_BASE}/repos/by-name/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`);
  if (!response.ok) throw new Error('Failed to fetch repository');
  return response.json();
}

export interface CreateRepoParams {
  githubUrl: string;
  accessToken?: string;
}

export async function createRepo(params: CreateRepoParams): Promise<Repository> {
  const response = await authFetch(`${API_BASE}/repos`, {
    method: 'POST',
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Failed to create repository');
  return response.json();
}

export async function recheckRepo(id: string | number, accessToken?: string): Promise<Repository> {
  const response = await authFetch(`${API_BASE}/repos/${id}/recheck`, {
    method: 'POST',
    body: JSON.stringify({ accessToken }),
  });
  if (!response.ok) throw new Error('Failed to recheck repository');
  return response.json();
}

export async function deleteRepo(id: string | number): Promise<void> {
  const response = await authFetch(`${API_BASE}/repos/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete repository');
}

export async function fetchFiles(repoId: string): Promise<FileNode[]> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/files`);
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
}

export async function fetchFileContent(
  repoId: string,
  path: string
): Promise<string> {
  const response = await authFetch(
    `${API_BASE}/repos/${repoId}/files/${encodeURIComponent(path)}`
  );
  if (!response.ok) throw new Error('Failed to fetch file content');
  const data = await response.json();
  return data.content;
}

export async function fetchIssues(repoId: string): Promise<Issue[]> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/issues`);
  if (!response.ok) throw new Error('Failed to fetch issues');
  return response.json();
}

export async function fetchIssuesByFile(repoId: string): Promise<FileIssues[]> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/issues/by-file`);
  if (!response.ok) throw new Error('Failed to fetch issues by file');
  return response.json();
}

// Share management types and functions
export interface RepositoryShare {
  id: string;
  repositoryId: number;
  token: string;
  createdBy: string;
  expiresAt: string | null;
  createdAt: string;
}

export type ShareExpiration = 'never' | '1d' | '7d' | '30d';

export interface CreateShareParams {
  expiresIn?: ShareExpiration;
}

export async function fetchRepoShares(repoId: string | number): Promise<RepositoryShare[]> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/shares`);
  if (!response.ok) throw new Error('Failed to fetch shares');
  return response.json();
}

export async function createRepoShare(
  repoId: string | number,
  params?: CreateShareParams
): Promise<RepositoryShare> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/shares`, {
    method: 'POST',
    body: JSON.stringify(params || {}),
  });
  if (!response.ok) throw new Error('Failed to create share link');
  return response.json();
}

export async function deleteRepoShare(
  repoId: string | number,
  shareId: string
): Promise<void> {
  const response = await authFetch(`${API_BASE}/repos/${repoId}/shares/${shareId}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete share link');
}
