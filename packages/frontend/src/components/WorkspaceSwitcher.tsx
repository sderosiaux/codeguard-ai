import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { Building2, ChevronDown, Check, Plus, Users } from 'lucide-react';
import CreateWorkspaceDialog from './CreateWorkspaceDialog';

interface Props {
  className?: string;
}

export default function WorkspaceSwitcher({ className = '' }: Props) {
  const navigate = useNavigate();
  const { workspaces, currentWorkspace, setCurrentWorkspace } = useAuth();
  const [isOpen, setIsOpen] = useState(false);
  const [showCreateDialog, setShowCreateDialog] = useState(false);
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

  if (!currentWorkspace || workspaces.length === 0) return null;

  const getRoleBadge = (role: string, isOwner: boolean) => {
    if (isOwner) return { text: 'Owner', className: 'bg-emerald-100 text-emerald-700' };
    if (role === 'admin') return { text: 'Admin', className: 'bg-blue-100 text-blue-700' };
    return { text: 'Member', className: 'bg-gray-100 text-gray-600' };
  };

  return (
    <div className={`relative ${className}`} ref={menuRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-200 hover:border-gray-300 bg-white hover:bg-gray-50 transition-all"
      >
        <div className="w-6 h-6 rounded-md bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center">
          <Building2 className="w-3.5 h-3.5 text-white" />
        </div>
        <span className="text-sm font-medium text-gray-900 max-w-[120px] truncate">
          {currentWorkspace.name}
        </span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>

      {isOpen && (
        <div className="absolute left-0 mt-2 w-72 bg-white rounded-xl border border-gray-200 shadow-xl py-2 z-50">
          {/* Header */}
          <div className="px-4 py-2 border-b border-gray-100">
            <div className="text-xs font-medium text-gray-400 uppercase tracking-wide">
              Switch Workspace
            </div>
          </div>

          {/* Workspace list */}
          <div className="py-1 max-h-64 overflow-y-auto">
            {workspaces.map((workspace) => {
              const isActive = workspace.id === currentWorkspace.id;
              const badge = getRoleBadge(workspace.role, workspace.isOwner);

              return (
                <button
                  key={workspace.id}
                  onClick={() => {
                    setCurrentWorkspace(workspace);
                    setIsOpen(false);
                    // Reload the page to fetch workspace-specific data
                    window.location.reload();
                  }}
                  className={`w-full flex items-center gap-3 px-4 py-2.5 transition-colors ${
                    isActive ? 'bg-emerald-50' : 'hover:bg-gray-50'
                  }`}
                >
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                    isActive
                      ? 'bg-gradient-to-br from-emerald-400 to-emerald-600'
                      : 'bg-gray-100'
                  }`}>
                    <Building2 className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-500'}`} />
                  </div>
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-gray-900">{workspace.name}</div>
                    <div className="text-xs text-gray-500">{workspace.slug}</div>
                  </div>
                  <span className={`text-xs px-1.5 py-0.5 rounded ${badge.className}`}>
                    {badge.text}
                  </span>
                  {isActive && (
                    <Check className="w-4 h-4 text-emerald-600" />
                  )}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          <div className="border-t border-gray-100 pt-1">
            <button
              onClick={() => {
                setIsOpen(false);
                setShowCreateDialog(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <Plus className="w-4 h-4 text-gray-400" />
              Create Workspace
            </button>
            {(currentWorkspace.isOwner || currentWorkspace.role === 'admin') && (
              <button
                onClick={() => {
                  setIsOpen(false);
                  navigate('/app/settings?tab=members');
                }}
                className="w-full flex items-center gap-3 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                <Users className="w-4 h-4 text-gray-400" />
                Manage Members
              </button>
            )}
          </div>
        </div>
      )}

      {/* Create Workspace Dialog */}
      <CreateWorkspaceDialog
        isOpen={showCreateDialog}
        onClose={() => setShowCreateDialog(false)}
      />
    </div>
  );
}
