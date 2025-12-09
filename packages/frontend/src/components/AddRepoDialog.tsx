import { useState } from 'react';
import { Dialog } from './ui/Dialog';
import { Button } from './ui/Button';
import { useCreateRepo } from '../hooks/useApi';
import { Github, AlertCircle, Key, Eye, EyeOff } from 'lucide-react';

interface AddRepoDialogProps {
  open: boolean;
  onClose: () => void;
}

export default function AddRepoDialog({ open, onClose }: AddRepoDialogProps) {
  const [githubUrl, setGithubUrl] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  const [error, setError] = useState('');
  const createMutation = useCreateRepo();

  const validateInput = (input: string) => {
    const trimmed = input.trim();
    // Full URL format
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
      return trimmed.includes('github.com');
    }
    // Shorthand format: owner/repo
    return /^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (!githubUrl.trim()) {
      setError('Please enter a repository');
      return;
    }

    if (!validateInput(githubUrl)) {
      setError('Use owner/repo format (e.g., facebook/react) or full GitHub URL');
      return;
    }

    try {
      await createMutation.mutateAsync({ githubUrl, accessToken: accessToken || undefined });
      setGithubUrl('');
      setAccessToken('');
      onClose();
    } catch (err) {
      setError((err as Error).message || 'Failed to add repository');
    }
  };

  const handleClose = () => {
    setGithubUrl('');
    setAccessToken('');
    setShowToken(false);
    setError('');
    onClose();
  };

  return (
    <Dialog open={open} onClose={handleClose} title="Add Repository">
      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label
            htmlFor="github-url"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            GitHub Repository
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Github className="w-5 h-5 text-gray-400" />
            </div>
            <input
              id="github-url"
              type="text"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="owner/repo or https://github.com/owner/repo"
              className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 focus:bg-white transition-all duration-200"
            />
          </div>
          {error && (
            <div className="mt-3 flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}
        </div>

        {/* Optional Access Token for Private Repos */}
        <div>
          <label
            htmlFor="access-token"
            className="block text-sm font-medium text-gray-700 mb-2"
          >
            Access Token <span className="text-gray-400 font-normal">(optional, for private repos)</span>
          </label>
          <div className="relative">
            <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
              <Key className="w-5 h-5 text-gray-400" />
            </div>
            <input
              id="access-token"
              type={showToken ? 'text' : 'password'}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="ghp_xxxxxxxxxxxx"
              className="w-full pl-10 pr-12 py-3 bg-gray-50 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500 focus:bg-white transition-all duration-200"
            />
            <button
              type="button"
              onClick={() => setShowToken(!showToken)}
              className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
            >
              {showToken ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
            </button>
          </div>
          <p className="mt-2 text-xs text-gray-500">
            Generate a token at GitHub → Settings → Developer settings → Personal access tokens
          </p>
        </div>

        <div className="pt-2 flex justify-end gap-3">
          <Button type="button" variant="ghost" onClick={handleClose} className="text-gray-500 hover:text-gray-700">
            Cancel
          </Button>
          <Button type="submit" disabled={createMutation.isPending}>
            {createMutation.isPending ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin mr-2" />
                Adding...
              </>
            ) : (
              'Add Repository'
            )}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
