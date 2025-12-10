import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../contexts/AuthContext';
import ProfileMenu from '../components/ProfileMenu';
import { Button } from '../components/ui/Button';
import { Dialog } from '../components/ui/Dialog';
import {
  Shield,
  Key,
  Plus,
  Trash2,
  Copy,
  Check,
  Clock,
  AlertCircle,
  ArrowLeft,
  BookOpen,
  Terminal,
} from 'lucide-react';
import { Link } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL || '/api';

interface ApiToken {
  id: string;
  name: string;
  tokenPrefix: string;
  workspaceId: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
}

interface CreateTokenResponse extends ApiToken {
  token: string;
}

async function fetchTokens(): Promise<ApiToken[]> {
  const response = await fetch(`${API_URL}/tokens`, {
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to fetch tokens');
  return response.json();
}

async function createToken(params: {
  name: string;
  workspaceId: string;
  expiresIn?: string;
}): Promise<CreateTokenResponse> {
  const response = await fetch(`${API_URL}/tokens`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  if (!response.ok) throw new Error('Failed to create token');
  return response.json();
}

async function deleteToken(id: string): Promise<void> {
  const response = await fetch(`${API_URL}/tokens/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  if (!response.ok) throw new Error('Failed to delete token');
}

export default function SettingsPage() {
  const { currentWorkspace, workspaces } = useAuth();
  const queryClient = useQueryClient();
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newTokenName, setNewTokenName] = useState('');
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState(currentWorkspace?.id || '');
  const [expiresIn, setExpiresIn] = useState('never');
  const [newlyCreatedToken, setNewlyCreatedToken] = useState<string | null>(null);
  const [copiedToken, setCopiedToken] = useState(false);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: tokens, isLoading, error } = useQuery({
    queryKey: ['tokens'],
    queryFn: fetchTokens,
  });

  const createMutation = useMutation({
    mutationFn: createToken,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      setNewlyCreatedToken(data.token);
      setNewTokenName('');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteToken,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tokens'] });
      setDeleteConfirmId(null);
    },
  });

  const handleCreate = () => {
    if (!newTokenName.trim() || !selectedWorkspaceId) return;
    createMutation.mutate({
      name: newTokenName.trim(),
      workspaceId: selectedWorkspaceId,
      expiresIn: expiresIn === 'never' ? undefined : expiresIn,
    });
  };

  const handleCopyToken = async () => {
    if (newlyCreatedToken) {
      await navigator.clipboard.writeText(newlyCreatedToken);
      setCopiedToken(true);
      setTimeout(() => setCopiedToken(false), 2000);
    }
  };

  const handleCloseCreateDialog = () => {
    setIsCreateDialogOpen(false);
    setNewlyCreatedToken(null);
    setNewTokenName('');
    setExpiresIn('never');
    setCopiedToken(false);
    createMutation.reset();
  };

  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return 'Never';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  };

  const getWorkspaceName = (workspaceId: string) => {
    const workspace = workspaces.find(w => w.id === workspaceId);
    return workspace?.name || 'Unknown';
  };

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      {/* Animated Background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] bg-emerald-200/40 rounded-full blur-[120px] animate-pulse-subtle" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[500px] h-[500px] bg-emerald-200/30 rounded-full blur-[100px] animate-pulse-subtle" style={{ animationDelay: '1s' }} />
        <div
          className="absolute inset-0 opacity-[0.4]"
          style={{
            backgroundImage: `linear-gradient(rgb(16 185 129 / 0.03) 1px, transparent 1px), linear-gradient(90deg, rgb(16 185 129 / 0.03) 1px, transparent 1px)`,
            backgroundSize: '50px 50px',
          }}
        />
      </div>

      {/* Header */}
      <header className="relative z-50 bg-white/70 backdrop-blur-md border-b border-gray-200/50 sticky top-0">
        <div className="max-w-7xl mx-auto px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-6">
              <Link to="/app" className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                <div className="relative">
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
                    <Shield className="w-5 h-5 text-white" />
                  </div>
                </div>
                <span className="text-xl font-bold tracking-tight text-gray-900">
                  CodeGuard<span className="text-emerald-600">AI</span>
                </span>
              </Link>
              <div className="h-6 w-px bg-gray-200" />
              <Link
                to="/app"
                className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Dashboard
              </Link>
            </div>

            <div className="flex items-center gap-3">
              <a
                href="/docs"
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition-colors"
              >
                <BookOpen className="w-4 h-4" />
                Docs
              </a>
              <ProfileMenu />
            </div>
          </div>
        </div>
      </header>

      <main className="relative z-10 max-w-4xl mx-auto px-6 lg:px-8 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
          <p className="text-gray-500 mt-1">Manage your API tokens and integrations</p>
        </div>

        {/* API Tokens Section */}
        <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-100 flex items-center justify-center">
                  <Key className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="text-lg font-semibold text-gray-900">API Tokens</h2>
                  <p className="text-sm text-gray-500">Use tokens to authenticate with the MCP server</p>
                </div>
              </div>
              <Button onClick={() => setIsCreateDialogOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" />
                Create Token
              </Button>
            </div>
          </div>

          {/* MCP Info Banner */}
          <div className="px-6 py-4 bg-gray-50 border-b border-gray-100">
            <div className="flex items-start gap-3">
              <Terminal className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                <p className="text-gray-700">
                  API tokens authenticate requests to the <strong>MCP (Model Context Protocol)</strong> server.
                  Use them to integrate CodeGuard AI with Claude, Cursor, or other MCP-compatible tools.
                </p>
                <a href="/docs/integrations/mcp/" className="text-emerald-600 hover:text-emerald-700 font-medium mt-1 inline-block">
                  View MCP documentation →
                </a>
              </div>
            </div>
          </div>

          {/* Tokens List */}
          <div className="divide-y divide-gray-100">
            {isLoading && (
              <div className="px-6 py-12 text-center">
                <div className="animate-spin rounded-full h-8 w-8 border-2 border-emerald-500 border-t-transparent mx-auto" />
                <p className="mt-3 text-sm text-gray-500">Loading tokens...</p>
              </div>
            )}

            {error && (
              <div className="px-6 py-12 text-center">
                <AlertCircle className="w-8 h-8 text-red-400 mx-auto" />
                <p className="mt-3 text-sm text-red-600">Failed to load tokens</p>
              </div>
            )}

            {!isLoading && !error && tokens?.length === 0 && (
              <div className="px-6 py-12 text-center">
                <div className="w-16 h-16 rounded-2xl bg-gray-100 flex items-center justify-center mx-auto mb-4">
                  <Key className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="font-medium text-gray-900 mb-1">No API tokens yet</h3>
                <p className="text-sm text-gray-500 mb-4">Create a token to start using the MCP server</p>
                <Button onClick={() => setIsCreateDialogOpen(true)} variant="outline" className="gap-2">
                  <Plus className="w-4 h-4" />
                  Create your first token
                </Button>
              </div>
            )}

            {tokens?.map((token) => (
              <div key={token.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-lg bg-gray-100 flex items-center justify-center">
                    <Key className="w-5 h-5 text-gray-500" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-900">{token.name}</span>
                      <span className="px-2 py-0.5 text-xs font-mono bg-gray-100 text-gray-600 rounded">
                        {token.tokenPrefix}...
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-sm text-gray-500">
                      <span>Workspace: {getWorkspaceName(token.workspaceId)}</span>
                      <span className="text-gray-300">•</span>
                      <span className="flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5" />
                        {token.lastUsedAt ? `Used ${formatDate(token.lastUsedAt)}` : 'Never used'}
                      </span>
                      {token.expiresAt && (
                        <>
                          <span className="text-gray-300">•</span>
                          <span>Expires {formatDate(token.expiresAt)}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmId(token.id)}
                  className="text-gray-400 hover:text-red-500"
                >
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* Create Token Dialog */}
      <Dialog
        open={isCreateDialogOpen}
        onClose={handleCloseCreateDialog}
        title={newlyCreatedToken ? 'Token Created' : 'Create API Token'}
      >
        {newlyCreatedToken ? (
          <div className="space-y-4">
            <div className="flex items-start gap-3 p-4 bg-emerald-50 border border-emerald-200 rounded-xl">
              <Check className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="text-sm text-emerald-800">
                <p className="font-medium">Token created successfully!</p>
                <p className="mt-1">
                  Make sure to copy your token now. You won't be able to see it again.
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Your API Token</label>
              <div className="flex items-center gap-2">
                <code className="flex-1 px-3 py-2.5 bg-gray-900 text-emerald-400 text-sm font-mono rounded-lg overflow-x-auto">
                  {newlyCreatedToken}
                </code>
                <Button
                  onClick={handleCopyToken}
                  variant="outline"
                  className="shrink-0 gap-2"
                >
                  {copiedToken ? (
                    <>
                      <Check className="w-4 h-4 text-emerald-500" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" />
                      Copy
                    </>
                  )}
                </Button>
              </div>
            </div>

            <div className="flex justify-end pt-4 border-t border-gray-100">
              <Button onClick={handleCloseCreateDialog}>Done</Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Token Name</label>
              <input
                type="text"
                value={newTokenName}
                onChange={(e) => setNewTokenName(e.target.value)}
                placeholder="e.g., Claude Desktop, Cursor IDE"
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Workspace</label>
              <select
                value={selectedWorkspaceId}
                onChange={(e) => setSelectedWorkspaceId(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                {workspaces.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Expiration</label>
              <select
                value={expiresIn}
                onChange={(e) => setExpiresIn(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent bg-white"
              >
                <option value="never">Never expires</option>
                <option value="30d">30 days</option>
                <option value="90d">90 days</option>
                <option value="1y">1 year</option>
              </select>
            </div>

            {createMutation.isError && (
              <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                <AlertCircle className="w-4 h-4 shrink-0" />
                Failed to create token. Please try again.
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
              <Button variant="outline" onClick={handleCloseCreateDialog}>
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={!newTokenName.trim() || !selectedWorkspaceId || createMutation.isPending}
              >
                {createMutation.isPending ? 'Creating...' : 'Create Token'}
              </Button>
            </div>
          </div>
        )}
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={!!deleteConfirmId}
        onClose={() => setDeleteConfirmId(null)}
        title="Delete Token"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Are you sure you want to delete this token? Any integrations using this token will stop working.
          </p>

          {deleteMutation.isError && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              <AlertCircle className="w-4 h-4 shrink-0" />
              Failed to delete token. Please try again.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-100">
            <Button variant="outline" onClick={() => setDeleteConfirmId(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => deleteConfirmId && deleteMutation.mutate(deleteConfirmId)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Delete Token'}
            </Button>
          </div>
        </div>
      </Dialog>
    </div>
  );
}
