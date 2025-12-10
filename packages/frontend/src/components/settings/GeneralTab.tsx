import { useState, useEffect } from 'react';
import { Building2, Loader2, Check, AlertTriangle, X } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { renameWorkspace, deleteWorkspace, leaveWorkspace } from '../../lib/api/settings';
import { Button } from '../ui/Button';

export function GeneralTab() {
  const { currentWorkspace, refreshAuth } = useAuth();
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Danger zone states
  const [showDangerDialog, setShowDangerDialog] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  useEffect(() => {
    if (currentWorkspace) {
      setName(currentWorkspace.name);
    }
  }, [currentWorkspace]);

  if (!currentWorkspace) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
        No workspace selected
      </div>
    );
  }

  const isOwner = currentWorkspace.isOwner;
  const isAdmin = currentWorkspace.role === 'admin';
  const canEdit = isOwner || isAdmin;
  const hasChanges = name !== currentWorkspace.name;

  const handleSave = async () => {
    if (!hasChanges || !name.trim()) return;

    setIsSaving(true);
    setError(null);
    setSaveSuccess(false);

    try {
      await renameWorkspace(currentWorkspace.id, name.trim());
      await refreshAuth();
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async () => {
    if (confirmDelete !== currentWorkspace.name) return;

    setIsDeleting(true);
    setError(null);

    try {
      await deleteWorkspace(currentWorkspace.id);
      // Redirect to app - will pick up first available workspace
      window.location.href = '/app';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete workspace');
      setIsDeleting(false);
    }
  };

  const handleLeave = async () => {
    if (!confirm(`Are you sure you want to leave "${currentWorkspace.name}"?`)) return;

    setIsLeaving(true);
    setError(null);

    try {
      await leaveWorkspace(currentWorkspace.id);
      window.location.href = '/app';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to leave workspace');
      setIsLeaving(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Workspace Info */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h3 className="font-semibold text-gray-900">Workspace Settings</h3>
          <p className="text-sm text-gray-500 mt-1">Manage your workspace details</p>
        </div>

        <div className="p-6 space-y-6">
          {/* Workspace icon and info */}
          <div className="flex items-start gap-4">
            <div className="w-16 h-16 rounded-xl bg-gradient-to-br from-emerald-400 to-emerald-600 flex items-center justify-center shadow-lg shadow-emerald-500/25">
              <Building2 className="w-8 h-8 text-white" />
            </div>
            <div className="flex-1">
              <div className="text-sm text-gray-500 mb-1">Workspace Name</div>
              {canEdit ? (
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full max-w-md px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent text-lg font-medium"
                  placeholder="Workspace name"
                />
              ) : (
                <div className="text-lg font-medium text-gray-900">{currentWorkspace.name}</div>
              )}
            </div>
          </div>

          {error && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-600">
              {error}
            </div>
          )}

          {/* Save button */}
          {canEdit && (
            <div className="flex items-center gap-3 pt-2">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || !name.trim() || isSaving}
              >
                {isSaving ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Saving...
                  </>
                ) : saveSuccess ? (
                  <>
                    <Check className="w-4 h-4 mr-2" />
                    Saved!
                  </>
                ) : (
                  'Save Changes'
                )}
              </Button>
              {hasChanges && (
                <button
                  onClick={() => setName(currentWorkspace.name)}
                  className="text-sm text-gray-500 hover:text-gray-700"
                >
                  Cancel
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete/Leave Workspace Button */}
      <div className="pt-4">
        <button
          onClick={() => setShowDangerDialog(true)}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-red-600 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 hover:border-red-300 transition-colors"
        >
          <AlertTriangle className="w-4 h-4" />
          {isOwner ? 'Delete Workspace' : 'Leave Workspace'}
        </button>
      </div>

      {/* Danger Zone Dialog */}
      {showDangerDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-red-200 bg-red-50 rounded-t-xl">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-red-100 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5 text-red-600" />
                </div>
                <div>
                  <h3 className="font-semibold text-red-900">
                    {isOwner ? 'Delete Workspace' : 'Leave Workspace'}
                  </h3>
                  <p className="text-sm text-red-600">This action cannot be undone</p>
                </div>
              </div>
              <button
                onClick={() => {
                  setShowDangerDialog(false);
                  setConfirmDelete('');
                }}
                className="p-1 text-red-400 hover:text-red-600 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Leave workspace (for non-owners) */}
              {!isOwner && (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-medium text-gray-900">Leave Workspace</div>
                    <div className="text-sm text-gray-500">Remove yourself from this workspace</div>
                  </div>
                  <Button
                    variant="ghost"
                    onClick={handleLeave}
                    disabled={isLeaving}
                    className="text-red-600 hover:bg-red-50 hover:text-red-700"
                  >
                    {isLeaving ? (
                      <>
                        <Loader2 className="w-4 h-4 animate-spin mr-2" />
                        Leaving...
                      </>
                    ) : (
                      'Leave'
                    )}
                  </Button>
                </div>
              )}

              {/* Delete workspace (owners only) */}
              {isOwner && (
                <div>
                  <div className="mb-3">
                    <div className="font-medium text-gray-900">Delete Workspace</div>
                    <div className="text-sm text-gray-500">
                      Permanently delete this workspace and all its repositories
                    </div>
                  </div>
                  <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                    <p className="text-sm text-red-700 mb-3">
                      Type <strong>{currentWorkspace.name}</strong> to confirm:
                    </p>
                    <input
                      type="text"
                      value={confirmDelete}
                      onChange={(e) => setConfirmDelete(e.target.value)}
                      placeholder={currentWorkspace.name}
                      className="w-full px-3 py-2 border border-red-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent text-sm mb-3"
                    />
                    <Button
                      onClick={handleDelete}
                      disabled={confirmDelete !== currentWorkspace.name || isDeleting}
                      className="w-full bg-red-600 hover:bg-red-700 text-white justify-center"
                    >
                      {isDeleting ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin mr-2" />
                          Deleting...
                        </>
                      ) : (
                        'Delete Workspace'
                      )}
                    </Button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
