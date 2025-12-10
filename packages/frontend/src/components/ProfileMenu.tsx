import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { User, LogOut, Settings, Building2 } from 'lucide-react';

interface ProfileMenuProps {
  showWorkspace?: boolean;
}

export default function ProfileMenu({ showWorkspace = true }: ProfileMenuProps) {
  const { user, currentWorkspace, logout } = useAuth();
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
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
        className="rounded-full hover:ring-2 hover:ring-emerald-500/50 transition-all"
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt={user.name}
            className="w-9 h-9 rounded-full border-2 border-gray-200 hover:border-emerald-400 transition-colors"
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

          {/* Current workspace */}
          {showWorkspace && currentWorkspace && (
            <div className="px-4 py-2 border-b border-gray-100">
              <div className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">
                Current Workspace
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-md bg-emerald-100 flex items-center justify-center">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600" />
                </div>
                <span className="text-sm font-medium text-gray-900">
                  {currentWorkspace.name}
                </span>
                {currentWorkspace.isOwner && (
                  <span className="text-xs px-1.5 py-0.5 bg-emerald-100 text-emerald-700 rounded">
                    Owner
                  </span>
                )}
              </div>
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
