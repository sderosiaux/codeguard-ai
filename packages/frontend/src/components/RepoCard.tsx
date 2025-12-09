import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Clock, RefreshCw, XCircle, Loader2, ChevronRight, Shield, Timer } from 'lucide-react';
import { useRecheckRepo, useDeleteRepo } from '../hooks/useApi';
import type { Repository } from '../lib/api';

// Calculate security grade based on weighted issue score
function calculateGrade(issueCounts: { critical: number; high: number; medium: number; low: number }): {
  grade: string;
  color: string;
  bgColor: string;
  borderColor: string;
} {
  const { critical, high, medium, low } = issueCounts;
  const total = critical + high + medium + low;

  // No issues = A
  if (total === 0) {
    return { grade: 'A', color: 'text-emerald-600', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' };
  }

  // Calculate weighted score (higher = worse)
  // Critical: 10pts, High: 5pts, Medium: 2pts, Low: 1pt
  const score = critical * 10 + high * 5 + medium * 2 + low * 1;

  // Grade based on score thresholds
  if (score <= 5) {
    return { grade: 'A', color: 'text-emerald-600', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' };
  }
  if (score <= 15) {
    return { grade: 'B', color: 'text-emerald-600', bgColor: 'bg-emerald-50', borderColor: 'border-emerald-200' };
  }
  if (score <= 30) {
    return { grade: 'C', color: 'text-yellow-600', bgColor: 'bg-yellow-50', borderColor: 'border-yellow-200' };
  }
  if (score <= 60) {
    return { grade: 'D', color: 'text-orange-600', bgColor: 'bg-orange-50', borderColor: 'border-orange-200' };
  }
  return { grade: 'F', color: 'text-red-600', bgColor: 'bg-red-50', borderColor: 'border-red-200' };
}

interface RepoCardProps {
  repo: Repository;
}

export default function RepoCard({ repo }: RepoCardProps) {
  const navigate = useNavigate();
  const recheckMutation = useRecheckRepo();
  const deleteMutation = useDeleteRepo();
  const [elapsedTime, setElapsedTime] = useState('');

  const handleRecheck = (e: React.MouseEvent) => {
    e.stopPropagation();
    recheckMutation.mutate(repo.id);
  };

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (confirm(`Delete ${repo.owner}/${repo.name}?`)) {
      deleteMutation.mutate(repo.id);
    }
  };

  const isAnalyzing = repo.status === 'pending' || repo.status === 'cloning' || repo.status === 'analyzing';

  // Track elapsed time during analysis
  useEffect(() => {
    if (!isAnalyzing) {
      setElapsedTime('');
      return;
    }

    const startTime = new Date(repo.updatedAt).getTime();

    const updateElapsed = () => {
      const now = Date.now();
      const diffMs = now - startTime;
      const diffSecs = Math.floor(diffMs / 1000);
      const mins = Math.floor(diffSecs / 60);
      const secs = diffSecs % 60;

      if (mins > 0) {
        setElapsedTime(`${mins}m ${secs}s`);
      } else {
        setElapsedTime(`${secs}s`);
      }
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [isAnalyzing, repo.updatedAt]);

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;

    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const issueCounts = repo.issueCounts || { critical: 0, high: 0, medium: 0, low: 0 };
  const totalIssues = issueCounts.critical + issueCounts.high + issueCounts.medium + issueCounts.low;
  const gradeInfo = calculateGrade(issueCounts);

  return (
    <div
      className="group relative rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-[1.02] hover:-translate-y-1 bg-white border border-gray-200 hover:border-gray-300 hover:shadow-lg"
      onClick={() => navigate(`/app/repos/${repo.owner}/${repo.name}`)}
    >
      {/* Content */}
      <div className="relative">
        {/* Header */}
        <div className="p-5 pb-4">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3 min-w-0">
              {/* Grade badge */}
              <div className="relative flex-shrink-0">
                <div className={`w-11 h-11 rounded-xl flex items-center justify-center border ${
                  isAnalyzing
                    ? 'bg-emerald-50 border-emerald-200'
                    : repo.status === 'completed'
                    ? `${gradeInfo.bgColor} ${gradeInfo.borderColor}`
                    : 'bg-gray-100 border-gray-200'
                }`}>
                  {isAnalyzing ? (
                    <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
                  ) : repo.status === 'completed' ? (
                    <span className={`text-xl font-bold ${gradeInfo.color}`}>
                      {gradeInfo.grade}
                    </span>
                  ) : (
                    <span className="text-xl font-bold text-gray-400">?</span>
                  )}
                </div>
                {/* Pinging indicator for analyzing */}
                {isAnalyzing && (
                  <div className="absolute -top-1 -right-1 w-3 h-3 bg-emerald-400 rounded-full animate-ping" />
                )}
              </div>

              <div className="min-w-0">
                <h3 className="font-semibold text-gray-900 truncate group-hover:text-emerald-600 transition-colors">
                  {repo.name}
                </h3>
                <p className="text-sm text-gray-500 truncate">{repo.owner}</p>
              </div>
            </div>

            <ChevronRight className="w-5 h-5 text-gray-400 group-hover:text-emerald-500 group-hover:translate-x-1 transition-all flex-shrink-0 mt-1" />
          </div>

          {/* Status / Issues */}
          {isAnalyzing ? (
            <div className="flex items-center justify-between text-emerald-600">
              <span className="text-sm font-medium">
                {repo.status === 'pending' ? 'Queued for analysis...' : repo.status === 'cloning' ? 'Cloning repository...' : 'Running AI analysis...'}
              </span>
              {elapsedTime && (
                <span className="flex items-center gap-1 text-xs text-gray-500 font-mono">
                  <Timer className="w-3 h-3" />
                  {elapsedTime}
                </span>
              )}
            </div>
          ) : repo.status === 'completed' ? (
            totalIssues > 0 ? (
              <div className="space-y-3">
                {/* Issue bar visualization */}
                <div className="flex h-2 rounded-full overflow-hidden bg-gray-100">
                  {issueCounts.critical > 0 && (
                    <div
                      className="bg-red-500"
                      style={{ width: `${(issueCounts.critical / totalIssues) * 100}%` }}
                    />
                  )}
                  {issueCounts.high > 0 && (
                    <div
                      className="bg-orange-500"
                      style={{ width: `${(issueCounts.high / totalIssues) * 100}%` }}
                    />
                  )}
                  {issueCounts.medium > 0 && (
                    <div
                      className="bg-yellow-500"
                      style={{ width: `${(issueCounts.medium / totalIssues) * 100}%` }}
                    />
                  )}
                  {issueCounts.low > 0 && (
                    <div
                      className="bg-emerald-500"
                      style={{ width: `${(issueCounts.low / totalIssues) * 100}%` }}
                    />
                  )}
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {issueCounts.critical > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-50 text-red-600 text-xs font-medium border border-red-100">
                      {issueCounts.critical} critical
                    </span>
                  )}
                  {issueCounts.high > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-orange-50 text-orange-600 text-xs font-medium border border-orange-100">
                      {issueCounts.high} high
                    </span>
                  )}
                  {issueCounts.medium > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-yellow-50 text-yellow-600 text-xs font-medium border border-yellow-100">
                      {issueCounts.medium} medium
                    </span>
                  )}
                  {issueCounts.low > 0 && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-50 text-emerald-600 text-xs font-medium border border-emerald-100">
                      {issueCounts.low} low
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-emerald-600">
                <Shield className="w-4 h-4" />
                <span className="text-sm font-medium">All checks passed</span>
              </div>
            )
          ) : (
            <div className="flex items-center gap-2 text-red-600">
              <XCircle className="w-4 h-4" />
              <span className="text-sm font-medium">Analysis failed</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-3 bg-gray-50 border-t border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-1.5 text-xs text-gray-500">
            <Clock className="w-3.5 h-3.5" />
            <span>{formatDate(repo.updatedAt)}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {(repo.status === 'completed' || repo.status === 'error' || repo.status === 'failed') && (
              <>
                <button
                  onClick={handleDelete}
                  disabled={deleteMutation.isPending}
                  className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-all duration-200"
                >
                  <XCircle className="w-4 h-4" />
                </button>
                <button
                  onClick={handleRecheck}
                  disabled={recheckMutation.isPending}
                  className="p-1.5 text-gray-400 hover:text-emerald-500 hover:bg-emerald-50 rounded-lg transition-all duration-200"
                >
                  <RefreshCw className={`w-4 h-4 ${recheckMutation.isPending ? 'animate-spin' : ''}`} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
