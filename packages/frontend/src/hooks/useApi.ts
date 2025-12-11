import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as api from '../lib/api';
import type { FileIssues } from '../lib/api';

export function useRepos() {
  return useQuery({
    queryKey: ['repos'],
    queryFn: api.fetchRepos,
    refetchInterval: 5000, // Poll every 5 seconds to update status
  });
}

export function useRepo(id: string | undefined) {
  return useQuery({
    queryKey: ['repos', id],
    queryFn: () => api.fetchRepo(id!),
    enabled: !!id,
    refetchInterval: 5000, // Poll while analyzing
  });
}

export function useRepoByName(owner: string | undefined, name: string | undefined) {
  return useQuery({
    queryKey: ['repos', 'by-name', owner, name],
    queryFn: () => api.fetchRepoByName(owner!, name!),
    enabled: !!owner && !!name,
    refetchInterval: 5000, // Poll while analyzing
  });
}

export function useRepoStatus(repoId: string | number | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ['repoStatus', repoId],
    queryFn: () => api.fetchRepoStatus(repoId!),
    enabled: !!repoId && enabled,
    refetchInterval: 2000, // Poll every 2 seconds for live progress
  });
}

export function useFiles(repoId: string | undefined) {
  return useQuery({
    queryKey: ['files', repoId],
    queryFn: () => api.fetchFiles(repoId!),
    enabled: !!repoId,
  });
}

export function useFileContent(repoId: string | undefined, path: string | null) {
  return useQuery({
    queryKey: ['fileContent', repoId, path],
    queryFn: () => api.fetchFileContent(repoId!, path!),
    enabled: !!repoId && !!path,
  });
}

export function useIssues(repoId: string | undefined) {
  return useQuery({
    queryKey: ['issues', repoId],
    queryFn: () => api.fetchIssues(repoId!),
    enabled: !!repoId,
  });
}

export function useIssuesByFile(repoId: string | undefined) {
  return useQuery<FileIssues[]>({
    queryKey: ['issuesByFile', repoId],
    queryFn: () => api.fetchIssuesByFile(repoId!),
    enabled: !!repoId,
  });
}

export function useCreateRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: api.createRepo,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

export function useRecheckRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, accessToken }: { id: string | number; accessToken?: string }) =>
      api.recheckRepo(id, accessToken),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
      queryClient.invalidateQueries({ queryKey: ['repos', String(data.id)] });
      queryClient.invalidateQueries({ queryKey: ['issues', String(data.id)] });
      queryClient.invalidateQueries({ queryKey: ['issuesByFile', String(data.id)] });
    },
  });
}

export function useDeleteRepo() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string | number) => api.deleteRepo(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['repos'] });
    },
  });
}

// Analysis history hook
export function useAnalysisHistory(repoId: string | number | undefined) {
  return useQuery({
    queryKey: ['analysisHistory', repoId],
    queryFn: () => api.fetchAnalysisHistory(repoId!),
    enabled: !!repoId,
  });
}

// Share management hooks
export function useRepoShares(repoId: string | number | undefined) {
  return useQuery({
    queryKey: ['shares', repoId],
    queryFn: () => api.fetchRepoShares(repoId!),
    enabled: !!repoId,
  });
}

export function useCreateShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, params }: { repoId: string | number; params?: api.CreateShareParams }) =>
      api.createRepoShare(repoId, params),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shares', variables.repoId] });
    },
  });
}

export function useDeleteShare() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ repoId, shareId }: { repoId: string | number; shareId: string }) =>
      api.deleteRepoShare(repoId, shareId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['shares', variables.repoId] });
    },
  });
}
