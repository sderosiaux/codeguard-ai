import { useState } from 'react';
import { X, Building2, Loader2 } from 'lucide-react';
import { Button } from './ui/Button';
import { createWorkspace } from '../lib/api/settings';
import { useAuth } from '../contexts/AuthContext';

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function CreateWorkspaceDialog({ isOpen, onClose }: Props) {
  const { refreshAuth, setCurrentWorkspace } = useAuth();
  const [name, setName] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setIsLoading(true);
    setError(null);

    try {
      const newWorkspace = await createWorkspace(name.trim());
      // Refresh auth to get updated workspaces list
      await refreshAuth();
      // Switch to the new workspace
      setCurrentWorkspace({
        id: newWorkspace.id,
        name: newWorkspace.name,
        slug: newWorkspace.slug,
        role: 'owner',
        isOwner: true,
      });
      onClose();
      setName('');
      // Reload to fetch workspace-specific data
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create workspace');
    } finally {
      setIsLoading(false);
    }
  };

  const handleClose = () => {
    if (!isLoading) {
      onClose();
      setName('');
      setError(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <h3 className="text-lg font-semibold text-gray-900">Create Workspace</h3>
          </div>
          <button
            onClick={handleClose}
            disabled={isLoading}
            className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="p-6">
            <p className="text-sm text-gray-600 mb-4">
              Create a new workspace to organize repositories and collaborate with your team.
            </p>

            <label className="block text-sm font-medium text-gray-700 mb-2">
              Workspace Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. My Company, Personal Projects"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
              disabled={isLoading}
              autoFocus
            />
            <p className="text-xs text-gray-500 mt-2">
              A URL-friendly slug will be automatically generated from the name.
            </p>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
                {error}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-xl">
            <Button
              type="button"
              variant="ghost"
              onClick={handleClose}
              disabled={isLoading}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={!name.trim() || isLoading}
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin mr-2" />
                  Creating...
                </>
              ) : (
                'Create Workspace'
              )}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
