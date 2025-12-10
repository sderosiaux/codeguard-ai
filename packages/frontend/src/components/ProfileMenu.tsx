import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogOut, Settings, Building2, Check, Plus } from 'lucide-react';
import { createWorkspace } from '../lib/api/settings';

interface ProfileMenuProps {
  showWorkspace?: boolean;
}

export default function ProfileMenu({ showWorkspace = true }: ProfileMenuProps) {
  const { user, workspaces, currentWorkspace, setCurrentWorkspace, refreshAuth, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  if (!user) return null;

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-full transition-all"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="w-9 h-9 rounded-full border-2 border-gray-200 hover:border-emerald-400 transition-colors object-cover"
          />
        ) : (
          <div className="w-9 h-9 rounded-full bg-emerald-100 flex items-center justify-center border-2 border-gray-200 hover:border-emerald-400 transition-colors">
            <User className="w-5 h-5 text-emerald-600" />
          </div>
        )}
      </button>

      {isOpen && (
        <div className="absolute right-0 mt-2 w-64 bg-white rounded-xl border border-gray-200 shadow-xl py-2 z-[100]">
          {/* User info */}
          <div className="px-4 py-3 border-b border-gray-100">
            <div className="font-medium text-gray-900">{user.name}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
          </div>

          {/* Workspaces */}
          {showWorkspace && workspaces.length > 0 && (
            <div className="border-b border-gray-100">
              <div className="px-4 py-2">
                <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
                  Workspaces
                </div>
              </div>
              <div className="max-h-40 overflow-y-auto">
                {workspaces.map((workspace) => {
                  const isActive = workspace.id === currentWorkspace?.id;
                  return (
                    <button
                      key={workspace.id}
                      onClick={() => {
                        if (!isActive) {
                          setCurrentWorkspace(workspace);
                          setIsOpen(false);
                          window.location.reload();
                        }
                      }}
                      className={`w-full flex items-center gap-2 px-4 py-2 text-sm transition-colors ${
                        isActive ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'
                      }`}
                    >
                      <div className={`w-6 h-6 rounded-md flex items-center justify-center ${
                        isActive ? 'bg-emerald-200' : 'bg-gray-100'
                      }`}>
                        <Building2 className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-700' : 'text-gray-500'}`} />
                      </div>
                      <span className="flex-1 text-left truncate">{workspace.name}</span>
                      {workspace.isOwner && (
                        <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                          Owner
                        </span>
                      )}
                      {isActive && <Check className="w-4 h-4 text-emerald-600" />}
                    </button>
                  );
                })}
              </div>

              {/* Create workspace inline */}
              {isCreating ? (
                <div className="px-4 py-2 border-t border-gray-100">
                  <input
                    type="text"
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    placeholder="Workspace name"
                    className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent"
                    autoFocus
                    onKeyDown={async (e) => {
                      if (e.key === 'Enter' && newWorkspaceName.trim()) {
                        setCreateError(null);
                        try {
                          const newWs = await createWorkspace(newWorkspaceName.trim());
                          await refreshAuth();
                          setCurrentWorkspace({
                            id: newWs.id,
                            name: newWs.name,
                            slug: newWs.slug,
                            role: 'owner',
                            isOwner: true,
                          });
                          setIsCreating(false);
                          setNewWorkspaceName('');
                          setIsOpen(false);
                          window.location.reload();
                        } catch (err) {
                          setCreateError(err instanceof Error ? err.message : 'Failed to create');
                        }
                      } else if (e.key === 'Escape') {
                        setIsCreating(false);
                        setNewWorkspaceName('');
                        setCreateError(null);
                      }
                    }}
                  />
                  {createError && (
                    <p className="text-xs text-red-500 mt-1">{createError}</p>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Press Enter to create, Esc to cancel</p>
                </div>
              ) : (
                <button
                  onClick={() => setIsCreating(true)}
                  className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50 transition-colors border-t border-gray-100"
                >
                  <Plus className="w-4 h-4 text-gray-400" />
                  Create workspace
                </button>
              )}
            </div>
          )}

          {/* Menu items */}
          <div className="py-1">
            <button
              onClick={() => {
                setIsOpen(false);
                navigate('/app/settings');
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Settings className="w-4 h-4 text-gray-400" />
              Settings
            </button>
          </div>

          {/* Logout */}
          <div className="border-t border-gray-100 pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                logout();
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
