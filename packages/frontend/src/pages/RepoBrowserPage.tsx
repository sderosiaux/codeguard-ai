import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, LayoutDashboard, Code, Loader2, PanelLeftClose, PanelLeftOpen, PanelBottomClose, PanelBottomOpen, Key, X } from 'lucide-react';
import { useRepoByName, useFiles, useIssues, useIssuesByFile, useRecheckRepo } from '../hooks/useApi';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import Resizer from '../components/ui/Resizer';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import IssuePanel from '../components/IssuePanel';
import IssueDashboard from '../components/IssueDashboard';
import ProfileMenu from '../components/ProfileMenu';
import ShareButton from '../components/ShareButton';
import type { Issue, IssuesByFile as IssuesByFileMap } from '../lib/api';

// Check if error message indicates auth/private repo issue
function isAuthError(errorMessage: string | null | undefined): boolean {
  if (!errorMessage) return false;
  const authKeywords = ['authentication', 'username', 'password', 'token', 'private', 'permission', 'denied', 'not found'];
  return authKeywords.some(keyword => errorMessage.toLowerCase().includes(keyword));
}

type TabType = 'dashboard' | 'code';

// Parse line range from URL param like "L=10" or "L=10-15"
function parseLineRange(param: string | null): { start: number; end: number } | null {
  if (!param) return null;
  const match = param.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return null;
  const start = parseInt(match[1], 10);
  const end = match[2] ? parseInt(match[2], 10) : start;
  return { start, end };
}

export default function RepoBrowserPage() {
  const { owner, name, '*': filePath } = useParams<{ owner: string; name: string; '*': string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();

  // Derive activeTab and selectedFile from URL
  const isCodeRoute = location.pathname.includes('/code');
  const activeTab: TabType = isCodeRoute ? 'code' : 'dashboard';
  const selectedFile = isCodeRoute && filePath ? decodeURIComponent(filePath) : null;

  // Parse line range from URL
  const lineRange = parseLineRange(searchParams.get('L'));

  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  // Token dialog state for private repos
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  // Panel sizing and collapse state
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [issuePanelHeight, setIssuePanelHeight] = useState(288);
  const [issuePanelCollapsed, setIssuePanelCollapsed] = useState(false);

  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 500;
  const MIN_ISSUE_PANEL_HEIGHT = 150;
  const MAX_ISSUE_PANEL_HEIGHT = 500;

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((prev) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, prev + delta)));
  }, []);

  const handleIssuePanelResize = useCallback((delta: number) => {
    // Negative delta means dragging up (increasing height)
    setIssuePanelHeight((prev) => Math.min(MAX_ISSUE_PANEL_HEIGHT, Math.max(MIN_ISSUE_PANEL_HEIGHT, prev - delta)));
  }, []);

  const handleSelectIssue = useCallback((issue: Issue | null) => {
    setSelectedIssue(issue);
    // Auto-expand panel when selecting an issue
    if (issue && issuePanelCollapsed) {
      setIssuePanelCollapsed(false);
    }
    // Update URL with line range
    if (issue && selectedFile && issue.lineStart) {
      const lineParam = issue.lineEnd && issue.lineEnd !== issue.lineStart
        ? `${issue.lineStart}-${issue.lineEnd}`
        : `${issue.lineStart}`;
      navigate(`/app/repos/${owner}/${name}/code/${encodeURIComponent(selectedFile)}?L=${lineParam}`, { replace: true });
    } else if (selectedFile && !issue) {
      // Clear line param when deselecting issue
      navigate(`/app/repos/${owner}/${name}/code/${encodeURIComponent(selectedFile)}`, { replace: true });
    }
  }, [issuePanelCollapsed, selectedFile, owner, name, navigate]);

  const { data: repo, isLoading: repoLoading } = useRepoByName(owner, name);
  const repoId = repo?.id ? String(repo.id) : undefined;
  const { data: files } = useFiles(repoId);
  const { data: issues } = useIssues(repoId);
  const { data: issuesByFile } = useIssuesByFile(repoId);
  const recheckMutation = useRecheckRepo();

  // Transform issuesByFile array to map for FileTree component
  const issuesByFileMap = useMemo<IssuesByFileMap>(() => {
    if (!issuesByFile) return {};
    return issuesByFile.reduce((acc, file) => {
      acc[file.filePath] = file.issues;
      return acc;
    }, {} as IssuesByFileMap);
  }, [issuesByFile]);

  // Auto-select issue from URL line params on mount
  useEffect(() => {
    if (!lineRange || !selectedFile || !issuesByFileMap[selectedFile]) return;
    // Find issue that matches the line range
    const matchingIssue = issuesByFileMap[selectedFile].find((issue) => {
      const start = issue.lineStart || 0;
      const end = issue.lineEnd || start;
      return start === lineRange.start && end === lineRange.end;
    });
    if (matchingIssue && matchingIssue !== selectedIssue) {
      setSelectedIssue(matchingIssue);
      setIssuePanelCollapsed(false);
    }
  }, [lineRange, selectedFile, issuesByFileMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecheck = (token?: string) => {
    if (repoId) {
      recheckMutation.mutate({ id: repoId, accessToken: token });
    }
  };

  const handleTokenSubmit = () => {
    if (accessToken.trim()) {
      handleRecheck(accessToken.trim());
      setShowTokenDialog(false);
      setAccessToken('');
    }
  };

  // Show token dialog if repo has auth error
  const hasAuthError = repo?.status === 'error' && isAuthError(repo?.errorMessage);

  // Navigation helpers
  const setSelectedFile = useCallback((file: string | null) => {
    if (file) {
      navigate(`/app/repos/${owner}/${name}/code/${encodeURIComponent(file)}`);
    } else {
      navigate(`/app/repos/${owner}/${name}/code`);
    }
  }, [owner, name, navigate]);

  const handleNavigateToFile = useCallback((file: string, lineStart?: number, lineEnd?: number) => {
    let url = `/app/repos/${owner}/${name}/code/${encodeURIComponent(file)}`;
    if (lineStart) {
      const lineParam = lineEnd && lineEnd !== lineStart ? `${lineStart}-${lineEnd}` : `${lineStart}`;
      url += `?L=${lineParam}`;
    }
    navigate(url);
  }, [owner, name, navigate]);

  if (repoLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-2 text-gray-500">
          <Loader2 className="w-5 h-5 animate-spin" />
          Loading repository...
        </div>
      </div>
    );
  }

  if (!repo) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-red-600">Repository not found</div>
      </div>
    );
  }

  const issueCounts = repo.issueCounts || {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  const totalIssues = issueCounts.critical + issueCounts.high + issueCounts.medium + issueCounts.low;
  const isAnalyzing = repo.status === 'analyzing' || repo.status === 'cloning' || repo.status === 'pending';

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/app')}
              className="flex items-center gap-2"
            >
              <ArrowLeft className="w-4 h-4" />
              Back
            </Button>
            <div>
              <h1 className="text-xl font-bold text-gray-900">
                {repo.owner}/{repo.name}
              </h1>
              <div className="flex items-center gap-2 mt-1">
                {isAnalyzing ? (
                  <Badge variant="default" className="flex items-center gap-1">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    {repo.status === 'pending' ? 'Pending' : repo.status === 'cloning' ? 'Cloning...' : 'Analyzing...'}
                  </Badge>
                ) : repo.status === 'completed' ? (
                  <Badge variant="low">Completed</Badge>
                ) : (
                  <Badge variant="critical">Error</Badge>
                )}
                {repo.status === 'completed' && totalIssues > 0 && (
                  <span className="text-sm text-gray-500">
                    {totalIssues} issues found
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShareButton repoId={repo.id} />
            {hasAuthError ? (
              <Button
                onClick={() => setShowTokenDialog(true)}
                disabled={recheckMutation.isPending}
                className="flex items-center gap-2"
              >
                <Key className="w-4 h-4" />
                Provide Token
              </Button>
            ) : (
              <Button
                onClick={() => handleRecheck()}
                disabled={recheckMutation.isPending || isAnalyzing}
                className="flex items-center gap-2"
              >
                <RefreshCw className={`w-4 h-4 ${recheckMutation.isPending ? 'animate-spin' : ''}`} />
                Recheck
              </Button>
            )}
            <ProfileMenu />
          </div>
        </div>

        {/* Tabs */}
        <div className="flex items-center gap-1 bg-gray-100 p-1 rounded-lg w-fit">
          <button
            onClick={() => navigate(`/app/repos/${owner}/${name}`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 ${
              activeTab === 'dashboard'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <LayoutDashboard className="w-4 h-4" />
            Dashboard
          </button>
          <button
            onClick={() => navigate(`/app/repos/${owner}/${name}/code`)}
            className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 ${
              activeTab === 'code'
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-600 hover:text-gray-900'
            }`}
          >
            <Code className="w-4 h-4" />
            Code Browser
          </button>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {activeTab === 'dashboard' ? (
          issues && issuesByFile ? (
            <IssueDashboard
              issues={issues}
              issuesByFile={issuesByFile}
              onNavigateToFile={handleNavigateToFile}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-gray-500">
                {isAnalyzing ? (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-5 h-5 animate-spin" />
                    Analysis in progress...
                  </div>
                ) : (
                  'No issues found'
                )}
              </div>
            </div>
          )
        ) : (
          <>
            {/* File Tree Sidebar */}
            <div
              className="bg-white border-r border-gray-200 overflow-hidden flex flex-col transition-all duration-200"
              style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
            >
              {!sidebarCollapsed && (
                <>
                  <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">Files</h3>
                    <button
                      onClick={() => setSidebarCollapsed(true)}
                      className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
                      title="Collapse sidebar"
                    >
                      <PanelLeftClose className="w-4 h-4" />
                    </button>
                  </div>
                  <div className="flex-1 overflow-auto">
                    {files ? (
                      <FileTree
                        files={files}
                        issuesByFile={issuesByFileMap}
                        selectedFile={selectedFile}
                        onSelectFile={setSelectedFile}
                      />
                    ) : (
                      <div className="p-4 text-sm text-gray-500">Loading files...</div>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Sidebar Resizer */}
            <Resizer
              direction="horizontal"
              onResize={handleSidebarResize}
              onCollapse={() => setSidebarCollapsed(true)}
              onExpand={() => setSidebarCollapsed(false)}
              isCollapsed={sidebarCollapsed}
              collapseDirection="left"
            />

            {/* Code Editor Area */}
            <div className="flex-1 flex flex-col overflow-hidden min-w-0 relative">
              {/* Collapsed sidebar indicator */}
              {sidebarCollapsed && (
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="absolute left-0 top-1/2 -translate-y-1/2 z-10 bg-white border border-l-0 border-gray-200 rounded-r-md p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-50 shadow-sm transition-colors"
                  title="Expand sidebar"
                >
                  <PanelLeftOpen className="w-4 h-4" />
                </button>
              )}

              {selectedFile && repoId ? (
                <>
                  <CodeEditor
                    repoId={repoId}
                    filePath={selectedFile}
                    issues={issuesByFileMap[selectedFile] || []}
                    onSelectIssue={handleSelectIssue}
                    selectedIssue={selectedIssue}
                    highlightLines={lineRange}
                    owner={owner}
                    name={name}
                  />

                  {selectedIssue && (
                    <>
                      {/* Issue Panel Resizer */}
                      <Resizer
                        direction="vertical"
                        onResize={handleIssuePanelResize}
                        onCollapse={() => setIssuePanelCollapsed(true)}
                        onExpand={() => setIssuePanelCollapsed(false)}
                        isCollapsed={issuePanelCollapsed}
                        collapseDirection="down"
                      />

                      {/* Issue Panel */}
                      <div
                        className="border-t border-gray-200 overflow-hidden bg-white flex flex-col transition-all duration-200"
                        style={{ height: issuePanelCollapsed ? 32 : issuePanelHeight }}
                      >
                        {issuePanelCollapsed ? (
                          <button
                            onClick={() => setIssuePanelCollapsed(false)}
                            className="h-8 w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-gray-700 hover:bg-gray-50 transition-colors"
                          >
                            <PanelBottomOpen className="w-4 h-4" />
                            <span>Show Issue Details</span>
                          </button>
                        ) : (
                          <div className="flex-1 overflow-hidden flex flex-col">
                            <div className="flex items-center justify-end px-2 py-1 bg-gray-50 border-b border-gray-100">
                              <button
                                onClick={() => setIssuePanelCollapsed(true)}
                                className="p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-200 rounded transition-colors"
                                title="Collapse panel"
                              >
                                <PanelBottomClose className="w-4 h-4" />
                              </button>
                            </div>
                            <div className="flex-1 overflow-hidden">
                              <IssuePanel
                                issue={selectedIssue}
                                onClose={() => setSelectedIssue(null)}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center text-gray-500 bg-white">
                  <Code className="w-12 h-12 text-gray-300 mb-4" />
                  <div className="text-lg font-medium mb-1">Select a file to view</div>
                  <div className="text-sm">Choose a file from the tree on the left</div>
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* Token Dialog */}
      {showTokenDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">GitHub Access Token</h3>
              <button
                onClick={() => {
                  setShowTokenDialog(false);
                  setAccessToken('');
                }}
                className="p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6">
              <p className="text-sm text-gray-600 mb-4">
                This appears to be a private repository. Please provide a GitHub personal access token with <code className="bg-gray-100 px-1 rounded">repo</code> scope to access it.
              </p>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent font-mono text-sm"
                onKeyDown={(e) => e.key === 'Enter' && handleTokenSubmit()}
                autoFocus
              />
              <p className="text-xs text-gray-500 mt-2">
                Your token is only used for this request and is not stored.
              </p>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-xl">
              <Button
                variant="ghost"
                onClick={() => {
                  setShowTokenDialog(false);
                  setAccessToken('');
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={handleTokenSubmit}
                disabled={!accessToken.trim() || recheckMutation.isPending}
              >
                {recheckMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Analyzing...
                  </>
                ) : (
                  'Start Analysis'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
