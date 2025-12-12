import { Clock, GitCommit, Play, RefreshCw, Zap, CheckCircle2, XCircle, ExternalLink, User, AlertTriangle } from 'lucide-react';
import type { AnalysisRun, AnalysisTrigger } from '../lib/api';

interface AnalysisHistoryProps {
  runs: AnalysisRun[];
  owner: string;
  name: string;
  isLoading?: boolean;
  isError?: boolean;
  errorMessage?: string;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '-';
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
}

function formatDate(dateString: string | null): string {
  if (!dateString) return '-';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getTriggerInfo(trigger: AnalysisTrigger | null): { label: string; icon: typeof Play; color: string } {
  switch (trigger) {
    case 'initial':
      return { label: 'Initial', icon: Play, color: 'text-blue-600 bg-blue-50' };
    case 'recheck':
      return { label: 'Recheck', icon: RefreshCw, color: 'text-purple-600 bg-purple-50' };
    case 'api':
      return { label: 'API', icon: Zap, color: 'text-amber-600 bg-amber-50' };
    case 'scheduled':
      return { label: 'Scheduled', icon: Clock, color: 'text-gray-600 bg-gray-100' };
    default:
      return { label: 'Unknown', icon: Play, color: 'text-gray-500 bg-gray-50' };
  }
}

function StatusBadge({ status }: { status: AnalysisRun['status'] }) {
  const config = {
    completed: { icon: CheckCircle2, label: 'Completed', className: 'text-emerald-700 bg-emerald-50 border-emerald-200' },
    error: { icon: XCircle, label: 'Failed', className: 'text-red-700 bg-red-50 border-red-200' },
    running: { icon: Clock, label: 'Running', className: 'text-blue-700 bg-blue-50 border-blue-200' },
    pending: { icon: Clock, label: 'Pending', className: 'text-gray-600 bg-gray-50 border-gray-200' },
  }[status];

  const Icon = config.icon;

  return (
    <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium border ${config.className}`}>
      <Icon className="w-3 h-3" />
      {config.label}
    </span>
  );
}

function IssueBadges({ counts }: { counts: AnalysisRun['issueCounts'] }) {
  const total = counts.critical + counts.high + counts.medium + counts.low;
  if (total === 0) {
    return <span className="text-gray-400 text-sm">No issues</span>;
  }

  return (
    <div className="flex items-center gap-1.5">
      {counts.critical > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
          {counts.critical}
        </span>
      )}
      {counts.high > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-orange-100 text-orange-700">
          {counts.high}
        </span>
      )}
      {counts.medium > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-yellow-100 text-yellow-700">
          {counts.medium}
        </span>
      )}
      {counts.low > 0 && (
        <span className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-700">
          {counts.low}
        </span>
      )}
    </div>
  );
}

export default function AnalysisHistory({ runs, owner, name, isLoading, isError, errorMessage }: AnalysisHistoryProps) {
  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-600" />
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <AlertTriangle className="w-12 h-12 text-amber-400 mx-auto mb-3" />
          <p className="text-gray-700 font-medium">Failed to load history</p>
          <p className="text-sm text-gray-500 mt-1">{errorMessage || 'An error occurred while fetching analysis history'}</p>
        </div>
      </div>
    );
  }

  if (runs.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="text-center">
          <Clock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">No analysis history yet</p>
          <p className="text-sm text-gray-400 mt-1">Run an analysis to see history</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-auto p-6">
      <div className="max-w-6xl mx-auto">
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Date</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Duration</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Issues</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Commit</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-600 uppercase tracking-wider">Triggered By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {runs.map((run) => {
                const triggerInfo = getTriggerInfo(run.triggeredBy);
                const TriggerIcon = triggerInfo.icon;
                const commitUrl = run.commitSha
                  ? `https://github.com/${owner}/${name}/commit/${run.commitSha}`
                  : null;

                return (
                  <tr key={run.id} className="hover:bg-gray-50 transition-colors">
                    {/* Date */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-900">{formatDate(run.startedAt || run.createdAt)}</span>
                    </td>

                    {/* Duration */}
                    <td className="px-4 py-3">
                      <span className="text-sm text-gray-600 font-mono">
                        {formatDuration(run.durationSeconds)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="px-4 py-3">
                      <StatusBadge status={run.status} />
                      {run.status === 'error' && run.errorMessage && (
                        <div className="mt-1">
                          <span className="text-xs text-red-600 truncate block max-w-[200px]" title={run.errorMessage}>
                            {run.errorMessage}
                          </span>
                        </div>
                      )}
                    </td>

                    {/* Issues */}
                    <td className="px-4 py-3">
                      <IssueBadges counts={run.issueCounts} />
                    </td>

                    {/* Commit */}
                    <td className="px-4 py-3">
                      {run.commitSha ? (
                        <a
                          href={commitUrl!}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1.5 text-sm font-mono text-gray-600 hover:text-emerald-600 transition-colors"
                        >
                          <GitCommit className="w-3.5 h-3.5" />
                          {run.commitSha.substring(0, 7)}
                          <ExternalLink className="w-3 h-3 opacity-50" />
                        </a>
                      ) : (
                        <span className="text-sm text-gray-400">-</span>
                      )}
                    </td>

                    {/* Triggered By */}
                    <td className="px-4 py-3">
                      {run.triggeredByUserName ? (
                        <div className="flex items-center gap-2">
                          <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium text-gray-700 bg-gray-100">
                            <User className="w-3 h-3" />
                            {run.triggeredByUserName}
                          </span>
                          <span className="text-xs text-gray-400">
                            ({triggerInfo.label.toLowerCase()})
                          </span>
                        </div>
                      ) : (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${triggerInfo.color}`}>
                          <TriggerIcon className="w-3 h-3" />
                          {triggerInfo.label}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
