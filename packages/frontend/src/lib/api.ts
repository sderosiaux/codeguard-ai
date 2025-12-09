const API_BASE = '/api';

export interface Repository {
  id: number;
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

export interface Issue {
  id: number;
  repositoryId: number;
  analysisRunId: number;
  type: 'security' | 'reliability';
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
  const response = await fetch(`${API_BASE}/repos`);
  if (!response.ok) throw new Error('Failed to fetch repositories');
  return response.json();
}

export async function fetchRepo(id: string): Promise<Repository> {
  const response = await fetch(`${API_BASE}/repos/${id}`);
  if (!response.ok) throw new Error('Failed to fetch repository');
  return response.json();
}

export async function createRepo(githubUrl: string): Promise<Repository> {
  const response = await fetch(`${API_BASE}/repos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ githubUrl }),
  });
  if (!response.ok) throw new Error('Failed to create repository');
  return response.json();
}

export async function recheckRepo(id: string | number): Promise<Repository> {
  const response = await fetch(`${API_BASE}/repos/${id}/recheck`, {
    method: 'POST',
  });
  if (!response.ok) throw new Error('Failed to recheck repository');
  return response.json();
}

export async function deleteRepo(id: string | number): Promise<void> {
  const response = await fetch(`${API_BASE}/repos/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) throw new Error('Failed to delete repository');
}

export async function fetchFiles(repoId: string): Promise<FileNode[]> {
  const response = await fetch(`${API_BASE}/repos/${repoId}/files`);
  if (!response.ok) throw new Error('Failed to fetch files');
  return response.json();
}

export async function fetchFileContent(
  repoId: string,
  path: string
): Promise<string> {
  const response = await fetch(
    `${API_BASE}/repos/${repoId}/files/${encodeURIComponent(path)}`
  );
  if (!response.ok) throw new Error('Failed to fetch file content');
  const data = await response.json();
  return data.content;
}

export async function fetchIssues(repoId: string): Promise<Issue[]> {
  const response = await fetch(`${API_BASE}/repos/${repoId}/issues`);
  if (!response.ok) throw new Error('Failed to fetch issues');
  return response.json();
}

export async function fetchIssuesByFile(repoId: string): Promise<FileIssues[]> {
  const response = await fetch(`${API_BASE}/repos/${repoId}/issues/by-file`);
  if (!response.ok) throw new Error('Failed to fetch issues by file');
  return response.json();
}
