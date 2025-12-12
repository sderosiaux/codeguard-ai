import { useState, useMemo, useCallback, useEffect } from 'react';
import { useParams, useNavigate, useLocation, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw, LayoutDashboard, Code, Loader2, PanelLeftClose, PanelLeftOpen, Key, X, History, FolderSync, AlertCircle, Filter } from 'lucide-react';
import { useRepoByName, useFiles, useIssues, useIssuesByFile, useRecheckRepo, useRepoStatus, useAnalysisHistory } from '../hooks/useApi';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import Resizer from '../components/ui/Resizer';
import FileTree from '../components/FileTree';
import CodeEditor from '../components/CodeEditor';
import IssueDashboard from '../components/IssueDashboard';
import AnalysisProgress from '../components/AnalysisProgress';
import AnalysisHistory from '../components/AnalysisHistory';
import ProfileMenu from '../components/ProfileMenu';
import ShareButton from '../components/ShareButton';
import type { Issue, IssuesByFile as IssuesByFileMap, IssueType } from '../lib/api';

type TabType = 'dashboard' | 'code' | 'history';

// Issue type filter configuration
const ISSUE_TYPE_CONFIG: { type: IssueType; label: string; color: string }[] = [
  { type: 'security', label: 'Security', color: 'bg-red-100 text-red-700 border-red-200 hover:bg-red-200' },
  { type: 'resilience', label: 'Resilience', color: 'bg-orange-100 text-orange-700 border-orange-200 hover:bg-orange-200' },
  { type: 'concurrency', label: 'Concurrency', color: 'bg-purple-100 text-purple-700 border-purple-200 hover:bg-purple-200' },
  { type: 'kafka', label: 'Kafka', color: 'bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-200' },
  { type: 'database', label: 'Database', color: 'bg-cyan-100 text-cyan-700 border-cyan-200 hover:bg-cyan-200' },
  { type: 'distributed', label: 'Distributed', color: 'bg-indigo-100 text-indigo-700 border-indigo-200 hover:bg-indigo-200' },
];

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
  // Use regex to match /code at end or /code/ to avoid matching repo names like "codeguard-ai"
  const isCodeRoute = /\/code(\/|$)/.test(location.pathname);
  const isHistoryRoute = /\/history(\/|$)/.test(location.pathname);
  const activeTab: TabType = isCodeRoute ? 'code' : isHistoryRoute ? 'history' : 'dashboard';
  const selectedFile = isCodeRoute && filePath ? decodeURIComponent(filePath) : null;

  // Parse line range from URL
  const lineRange = parseLineRange(searchParams.get('L'));

  const [selectedIssue, setSelectedIssue] = useState<Issue | null>(null);

  // Filter state for issue types (empty = show all)
  const [activeTypeFilters, setActiveTypeFilters] = useState<Set<IssueType>>(new Set());

  // Token dialog state for private repos
  const [showTokenDialog, setShowTokenDialog] = useState(false);
  const [accessToken, setAccessToken] = useState('');

  // Panel sizing and collapse state
  const [sidebarWidth, setSidebarWidth] = useState(320);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  const MIN_SIDEBAR_WIDTH = 200;
  const MAX_SIDEBAR_WIDTH = 800;

  const handleSidebarResize = useCallback((delta: number) => {
    setSidebarWidth((prev) => Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, prev + delta)));
  }, []);

  const handleSelectIssue = useCallback((issue: Issue | null) => {
    setSelectedIssue(issue);
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
  }, [selectedFile, owner, name, navigate]);

  const { data: repo, isLoading: repoLoading } = useRepoByName(owner, name);
  const repoId = repo?.id ? String(repo.id) : undefined;
  const isAnalyzingStatus = repo?.status === 'analyzing' || repo?.status === 'cloning' || repo?.status === 'pending';
  const { data: repoStatus } = useRepoStatus(repoId, isAnalyzingStatus);
  const { data: files, isError: filesError, isLoading: filesLoading } = useFiles(repoId);
  const { data: issues } = useIssues(repoId);
  const { data: issuesByFile } = useIssuesByFile(repoId);
  const { data: analysisHistory, isLoading: historyLoading, isError: historyError, error: historyErrorMsg } = useAnalysisHistory(repoId);
  const recheckMutation = useRecheckRepo();

  // Detect if repo needs re-sync (files failed to load but repo status is "completed")
  const needsResync = filesError && repo?.status === 'completed' && !isAnalyzingStatus;

  // Transform issuesByFile array to map for FileTree component
  const issuesByFileMap = useMemo<IssuesByFileMap>(() => {
    if (!issuesByFile) return {};
    return issuesByFile.reduce((acc, file) => {
      acc[file.filePath] = file.issues;
      return acc;
    }, {} as IssuesByFileMap);
  }, [issuesByFile]);

  // Toggle a type filter on/off
  const toggleTypeFilter = useCallback((type: IssueType) => {
    setActiveTypeFilters(prev => {
      const next = new Set(prev);
      if (next.has(type)) {
        next.delete(type);
      } else {
        next.add(type);
      }
      return next;
    });
  }, []);

  // Clear all filters
  const clearTypeFilters = useCallback(() => {
    setActiveTypeFilters(new Set());
  }, []);

  // Filtered issues map based on active type filters
  const filteredIssuesByFileMap = useMemo<IssuesByFileMap>(() => {
    if (activeTypeFilters.size === 0) return issuesByFileMap;

    const filtered: IssuesByFileMap = {};
    for (const [filePath, fileIssues] of Object.entries(issuesByFileMap)) {
      const matchingIssues = fileIssues.filter(issue => activeTypeFilters.has(issue.type));
      if (matchingIssues.length > 0) {
        filtered[filePath] = matchingIssues;
      }
    }
    return filtered;
  }, [issuesByFileMap, activeTypeFilters]);

  // Count issues by type for filter badges
  const issueCountsByType = useMemo(() => {
    const counts: Partial<Record<IssueType, number>> = {};
    if (!issuesByFile) return counts;

    for (const file of issuesByFile) {
      for (const issue of file.issues) {
        counts[issue.type] = (counts[issue.type] || 0) + 1;
      }
    }
    return counts;
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
    }
  }, [lineRange, selectedFile, issuesByFileMap]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRecheck = (token?: string) => {
    if (repoId) {
      recheckMutation.mutate({ id: repoId, accessToken: token });
    }
  };

  const handleTokenSubmit = () => {
    // Token is optional - submit with token if provided, otherwise without
    handleRecheck(accessToken.trim() || undefined);
    setShowTokenDialog(false);
    setAccessToken('');
  };

  // Show token option if repo is in error state (any error, not just auth errors)
  // Private repos can fail with various error messages
  const hasError = repo?.status === 'error';

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
                {repo.status === 'error' && repo.errorMessage && (
                  <span className="text-sm text-red-500 max-w-md truncate" title={repo.errorMessage}>
                    {repo.errorMessage}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ShareButton repoId={repo.id} />
            {hasError ? (
              <Button
                onClick={() => setShowTokenDialog(true)}
                disabled={recheckMutation.isPending}
                className="flex items-center gap-2"
              >
                <Key className="w-4 h-4" />
                Retry with Token
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

        {/* Tabs - hidden when analyzing */}
        {!isAnalyzing && repo.status !== 'error' && (
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
            <button
              onClick={() => navigate(`/app/repos/${owner}/${name}/history`)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-all duration-150 ${
                activeTab === 'history'
                  ? 'bg-white text-gray-900 shadow-sm'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <History className="w-4 h-4" />
              History
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Show progress overlay when analyzing */}
        {isAnalyzing ? (
          <AnalysisProgress
            stage={repoStatus?.analysisStage || repo.analysisStage}
            agentProgress={repoStatus?.agentProgress || repo.agentProgress}
            errorMessage={repo.errorMessage}
          />
        ) : repo.status === 'error' ? (
          <AnalysisProgress
            stage="error"
            agentProgress={null}
            errorMessage={repo.errorMessage}
          />
        ) : activeTab === 'history' ? (
          <AnalysisHistory
            runs={analysisHistory?.runs || []}
            owner={owner || ''}
            name={name || ''}
            isLoading={historyLoading}
            isError={historyError}
            errorMessage={historyErrorMsg instanceof Error ? historyErrorMsg.message : undefined}
          />
        ) : needsResync ? (
          /* Repository files are missing - needs re-sync */
          <div className="flex-1 flex items-center justify-center bg-white">
            <div className="text-center max-w-md px-6">
              <div className="w-16 h-16 bg-amber-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <FolderSync className="w-8 h-8 text-amber-500" />
              </div>
              <h2 className="text-xl font-semibold text-gray-900 mb-2">Repository needs re-sync</h2>
              <p className="text-gray-500 mb-6">
                The local copy of this repository is no longer available. This can happen after server maintenance or if the repository was moved.
              </p>
              <Button
                onClick={() => handleRecheck()}
                disabled={recheckMutation.isPending}
                className="inline-flex items-center gap-2"
              >
                {recheckMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Re-syncing...
                  </>
                ) : (
                  <>
                    <RefreshCw className="w-4 h-4" />
                    Re-sync Repository
                  </>
                )}
              </Button>
              <p className="text-xs text-gray-400 mt-4">
                This will clone the repository again and re-run the analysis.
              </p>
            </div>
          </div>
        ) : activeTab === 'dashboard' ? (
          issues && issuesByFile ? (
            <IssueDashboard
              issues={issues}
              issuesByFile={issuesByFile}
              onNavigateToFile={handleNavigateToFile}
            />
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-gray-500">No issues found</div>
            </div>
          )
        ) : (
          <>
            {/* File Tree Sidebar */}
            <div
              className="bg-white border-r border-gray-200 overflow-hidden flex flex-col"
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

                  {/* Type Filter Bar */}
                  {Object.keys(issueCountsByType).length > 0 && (
                    <div className="p-2 border-b border-gray-100 bg-gray-50/50">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Filter className="w-3.5 h-3.5 text-gray-400" />
                        <span className="text-xs font-medium text-gray-500">Filter by type</span>
                        {activeTypeFilters.size > 0 && (
                          <button
                            onClick={clearTypeFilters}
                            className="ml-auto text-xs text-gray-400 hover:text-gray-600"
                          >
                            Clear
                          </button>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {ISSUE_TYPE_CONFIG.filter(cfg => issueCountsByType[cfg.type]).map(({ type, label, color }) => {
                          const count = issueCountsByType[type] || 0;
                          const isActive = activeTypeFilters.has(type);
                          return (
                            <button
                              key={type}
                              onClick={() => toggleTypeFilter(type)}
                              className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border transition-all ${
                                isActive
                                  ? color
                                  : 'bg-white text-gray-500 border-gray-200 hover:border-gray-300'
                              }`}
                            >
                              {label}
                              <span className={`${isActive ? 'opacity-70' : 'text-gray-400'}`}>
                                {count}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      {activeTypeFilters.size > 0 && (
                        <div className="mt-1.5 text-xs text-gray-400">
                          Showing {Object.keys(filteredIssuesByFileMap).length} files with {
                            Object.values(filteredIssuesByFileMap).reduce((sum, issues) => sum + issues.length, 0)
                          } issues
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex-1 overflow-auto">
                    {files ? (
                      <FileTree
                        files={files}
                        issuesByFile={filteredIssuesByFileMap}
                        selectedFile={selectedFile}
                        onSelectFile={setSelectedFile}
                      />
                    ) : filesError ? (
                      <div className="p-4 text-center">
                        <AlertCircle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
                        <p className="text-sm text-gray-600 mb-2">Files unavailable</p>
                        <button
                          onClick={() => handleRecheck()}
                          disabled={recheckMutation.isPending}
                          className="text-xs text-emerald-600 hover:text-emerald-700 font-medium"
                        >
                          Re-sync repository
                        </button>
                      </div>
                    ) : filesLoading ? (
                      <div className="p-4 flex items-center gap-2 text-sm text-gray-500">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Loading files...
                      </div>
                    ) : (
                      <div className="p-4 text-sm text-gray-500">No files found</div>
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
                    issues={filteredIssuesByFileMap[selectedFile] || []}
                    onSelectIssue={handleSelectIssue}
                    selectedIssue={selectedIssue}
                    highlightLines={lineRange}
                    owner={owner}
                    name={name}
                  />

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
              <h3 className="text-lg font-semibold text-gray-900">Retry Analysis</h3>
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
              {repo?.errorMessage && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <p className="text-sm text-red-700 font-medium mb-1">Previous error:</p>
                  <p className="text-sm text-red-600 font-mono break-all">{repo.errorMessage}</p>
                </div>
              )}
              <p className="text-sm text-gray-600 mb-4">
                If this is a private repository, provide a GitHub personal access token with <code className="bg-gray-100 px-1 rounded">repo</code> scope. Leave empty for public repositories.
              </p>
              <input
                type="password"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
                placeholder="ghp_xxxxxxxxxxxx (optional)"
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
                disabled={recheckMutation.isPending}
              >
                {recheckMutation.isPending ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin mr-2" />
                    Analyzing...
                  </>
                ) : (
                  'Retry Analysis'
                )}
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
