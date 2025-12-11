import { Loader2, GitBranch, Search, Bot, FileCheck, CheckCircle2, XCircle, Clock } from 'lucide-react';
import type { AnalysisStage, AgentProgress } from '../lib/api';

interface AnalysisProgressProps {
  stage: AnalysisStage | null | undefined;
  agentProgress: AgentProgress[] | null | undefined;
  errorMessage?: string | null;
}

// Stage configuration
const stages: { key: AnalysisStage; label: string; icon: typeof Loader2 }[] = [
  { key: 'queued', label: 'Queued', icon: Clock },
  { key: 'cloning', label: 'Cloning Repository', icon: GitBranch },
  { key: 'detecting', label: 'Detecting Tech Stack', icon: Search },
  { key: 'analyzing', label: 'Running Analysis', icon: Bot },
  { key: 'processing', label: 'Processing Results', icon: FileCheck },
];

function getStageIndex(stage: AnalysisStage | null | undefined): number {
  if (!stage) return 0;
  const index = stages.findIndex(s => s.key === stage);
  return index >= 0 ? index : 0;
}

export default function AnalysisProgress({ stage, agentProgress, errorMessage }: AnalysisProgressProps) {
  const currentStageIndex = getStageIndex(stage);
  const isError = stage === 'error';

  return (
    <div className="flex-1 flex items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 p-8">
      <div className="max-w-2xl w-full">
        {/* Main Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-gray-200 overflow-hidden">
          {/* Header */}
          <div className="px-8 py-6 border-b border-gray-100 bg-gradient-to-r from-emerald-50 to-teal-50">
            <div className="flex items-center gap-3">
              {isError ? (
                <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center">
                  <XCircle className="w-6 h-6 text-red-600" />
                </div>
              ) : (
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Loader2 className="w-6 h-6 text-emerald-600 animate-spin" />
                </div>
              )}
              <div>
                <h2 className="text-xl font-semibold text-gray-900">
                  {isError ? 'Analysis Failed' : 'Analysis in Progress'}
                </h2>
                <p className="text-sm text-gray-500">
                  {isError
                    ? 'There was an error during analysis'
                    : 'Please wait while we scan your codebase for issues'}
                </p>
              </div>
            </div>
          </div>

          {/* Error Message */}
          {isError && errorMessage && (
            <div className="px-8 py-4 bg-red-50 border-b border-red-100">
              <p className="text-sm text-red-700 font-mono">{errorMessage}</p>
            </div>
          )}

          {/* Stage Progress */}
          <div className="px-8 py-6">
            <div className="space-y-1">
              {stages.map((s, index) => {
                const Icon = s.icon;
                const isComplete = index < currentStageIndex;
                const isCurrent = index === currentStageIndex && !isError;
                const isPending = index > currentStageIndex;

                return (
                  <div key={s.key} className="flex items-center gap-4">
                    {/* Status Icon */}
                    <div className={`
                      w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all duration-300
                      ${isComplete ? 'bg-emerald-100 text-emerald-600' : ''}
                      ${isCurrent ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-200' : ''}
                      ${isPending ? 'bg-gray-100 text-gray-400' : ''}
                      ${isError && index === currentStageIndex ? 'bg-red-100 text-red-600' : ''}
                    `}>
                      {isComplete ? (
                        <CheckCircle2 className="w-5 h-5" />
                      ) : isCurrent ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : (
                        <Icon className="w-4 h-4" />
                      )}
                    </div>

                    {/* Label */}
                    <span className={`
                      text-sm font-medium transition-colors duration-300
                      ${isComplete ? 'text-emerald-600' : ''}
                      ${isCurrent ? 'text-gray-900' : ''}
                      ${isPending ? 'text-gray-400' : ''}
                    `}>
                      {s.label}
                    </span>

                    {/* Connector Line */}
                    {index < stages.length - 1 && (
                      <div className="flex-1 h-px bg-gray-200 mx-2" />
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Agent Progress */}
          {agentProgress && agentProgress.length > 0 && (
            <div className="px-8 py-6 border-t border-gray-100 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-700 mb-4 flex items-center gap-2">
                <Bot className="w-4 h-4" />
                Analysis Agents
              </h3>
              <div className="grid grid-cols-2 gap-3">
                {agentProgress.map((agent) => (
                  <div
                    key={agent.id}
                    className={`
                      flex items-center gap-3 px-4 py-3 rounded-lg border transition-all duration-300
                      ${agent.status === 'running'
                        ? 'bg-white border-emerald-200 shadow-sm'
                        : agent.status === 'completed'
                        ? 'bg-emerald-50 border-emerald-100'
                        : agent.status === 'error'
                        ? 'bg-red-50 border-red-100'
                        : 'bg-gray-50 border-gray-200'}
                    `}
                  >
                    {/* Status Indicator */}
                    <div className={`
                      w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0
                      ${agent.status === 'running' ? 'bg-emerald-100' : ''}
                      ${agent.status === 'completed' ? 'bg-emerald-100' : ''}
                      ${agent.status === 'error' ? 'bg-red-100' : ''}
                      ${agent.status === 'pending' ? 'bg-gray-100' : ''}
                    `}>
                      {agent.status === 'running' ? (
                        <Loader2 className="w-3.5 h-3.5 text-emerald-600 animate-spin" />
                      ) : agent.status === 'completed' ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      ) : agent.status === 'error' ? (
                        <XCircle className="w-3.5 h-3.5 text-red-600" />
                      ) : (
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                      )}
                    </div>

                    {/* Agent Name */}
                    <span className={`
                      text-sm font-medium truncate
                      ${agent.status === 'running' ? 'text-gray-900' : ''}
                      ${agent.status === 'completed' ? 'text-emerald-700' : ''}
                      ${agent.status === 'error' ? 'text-red-700' : ''}
                      ${agent.status === 'pending' ? 'text-gray-500' : ''}
                    `}>
                      {agent.name}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Footer Message */}
          {!isError && (
            <div className="px-8 py-4 border-t border-gray-100 bg-gray-50/50">
              <p className="text-xs text-gray-500 text-center">
                This may take a few minutes depending on the size of your codebase
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
