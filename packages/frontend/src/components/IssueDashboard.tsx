import { useMemo, useState } from 'react';
import {
  Shield,
  Zap,
  AlertTriangle,
  FileCode,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Gauge,
  Code2,
  LucideIcon,
  Search,
  X,
  Database,
  Network,
  GitBranch,
  MessageSquare,
  Heart,
  Layers,
} from 'lucide-react';
import StatsOverview from './StatsOverview';
import type { Issue, FileIssues, IssueType } from '../lib/api';

interface IssueDashboardProps {
  issues: Issue[];
  issuesByFile: FileIssues[];
  onNavigateToFile: (filePath: string, lineStart?: number, lineEnd?: number) => void;
}

interface CategoryGroup {
  category: string;
  issues: Issue[];
  critical: number;
  high: number;
  medium: number;
  low: number;
}

interface ParentGroup {
  name: string;
  icon: LucideIcon;
  color: string;
  bgColor: string;
  categories: CategoryGroup[];
  critical: number;
  high: number;
  medium: number;
  low: number;
  totalIssues: number;
}

// Map categories to parent groups
const categoryToParentGroup: Record<string, string> = {
  // Security
  'Authentication': 'Security',
  'Authorization': 'Security',
  'Input Validation': 'Security',
  'Cryptography': 'Security',
  'Data Protection': 'Security',
  'Access Control': 'Security',
  'Security': 'Security',
  'injection': 'Security',
  'auth': 'Security',
  'crypto': 'Security',
  'secrets': 'Security',
  'validation': 'Security',
  // Resilience (error handling, retries, etc.)
  'Error Handling': 'Resilience',
  'Resource Management': 'Resilience',
  'Async Operations': 'Resilience',
  'Exception Handling': 'Resilience',
  'Fault Tolerance': 'Resilience',
  'error-handling': 'Resilience',
  'retry': 'Resilience',
  'timeout': 'Resilience',
  'resource-leak': 'Resilience',
  'shutdown': 'Resilience',
  // Concurrency
  'Concurrency': 'Concurrency',
  'race-condition': 'Concurrency',
  'deadlock': 'Concurrency',
  'visibility': 'Concurrency',
  'atomicity': 'Concurrency',
  'async': 'Concurrency',
  // Kafka
  'consumer': 'Kafka',
  'producer': 'Kafka',
  'config': 'Kafka',
  'streams': 'Kafka',
  'connect': 'Kafka',
  'schema': 'Kafka',
  // Database
  'query': 'Database',
  'pool': 'Database',
  'transaction': 'Database',
  'index': 'Database',
  'Data Integrity': 'Database',
  // Distributed Systems
  'time': 'Distributed',
  'idempotency': 'Distributed',
  'consensus': 'Distributed',
  'replication': 'Distributed',
  'messaging': 'Distributed',
  // Performance (legacy)
  'Performance': 'Performance',
  'Scalability': 'Performance',
  'Caching': 'Performance',
  'Memory Management': 'Performance',
  // Code Quality
  'Code Quality': 'Code Quality',
  'Testing': 'Code Quality',
  'Type Safety': 'Code Quality',
  'Documentation': 'Code Quality',
  'Maintainability': 'Code Quality',
  'Best Practices': 'Code Quality',
};

const parentGroupConfig: Record<string, { icon: LucideIcon; color: string; bgColor: string }> = {
  'Security': { icon: Shield, color: 'text-red-600', bgColor: 'bg-red-50' },
  'Reliability': { icon: Zap, color: 'text-yellow-600', bgColor: 'bg-yellow-50' },
  'Resilience': { icon: Heart, color: 'text-orange-600', bgColor: 'bg-orange-50' },
  'Concurrency': { icon: GitBranch, color: 'text-amber-600', bgColor: 'bg-amber-50' },
  'Kafka': { icon: MessageSquare, color: 'text-purple-600', bgColor: 'bg-purple-50' },
  'Database': { icon: Database, color: 'text-blue-600', bgColor: 'bg-blue-50' },
  'Distributed': { icon: Network, color: 'text-cyan-600', bgColor: 'bg-cyan-50' },
  'Performance': { icon: Gauge, color: 'text-lime-600', bgColor: 'bg-lime-50' },
  'Code Quality': { icon: Code2, color: 'text-gray-600', bgColor: 'bg-gray-50' },
};

const severityColors: Record<string, string> = {
  critical: 'bg-red-500',
  high: 'bg-orange-500',
  medium: 'bg-yellow-500',
  low: 'bg-green-500',
};

export default function IssueDashboard({
  issues,
  issuesByFile,
  onNavigateToFile,
}: IssueDashboardProps) {
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set(['Security', 'Resilience', 'Concurrency', 'Kafka', 'Database', 'Distributed', 'Performance', 'Code Quality']));
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());
  const [selectedType, setSelectedType] = useState<'all' | IssueType>('all');
  const [selectedSeverity, setSelectedSeverity] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const toggleGroup = (group: string) => {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(group)) {
        next.delete(group);
      } else {
        next.add(group);
      }
      return next;
    });
  };

  const filteredIssues = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    return issues.filter((issue) => {
      if (selectedType !== 'all' && issue.type !== selectedType) return false;
      if (selectedSeverity && issue.severity !== selectedSeverity) return false;
      if (query) {
        const matchesTitle = issue.title.toLowerCase().includes(query);
        const matchesDescription = issue.description?.toLowerCase().includes(query);
        const matchesFilePath = issue.filePath?.toLowerCase().includes(query);
        const matchesCategory = issue.category.toLowerCase().includes(query);
        if (!matchesTitle && !matchesDescription && !matchesFilePath && !matchesCategory) {
          return false;
        }
      }
      return true;
    });
  }, [issues, selectedType, selectedSeverity, searchQuery]);

  const stats = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    const byType: Record<IssueType, number> = {
      security: 0,
      reliability: 0,
      kafka: 0,
      database: 0,
      distributed: 0,
      concurrency: 0,
      resilience: 0,
    };
    const byCategory: Record<string, CategoryGroup> = {};

    for (const issue of filteredIssues) {
      counts[issue.severity]++;
      byType[issue.type]++;

      if (!byCategory[issue.category]) {
        byCategory[issue.category] = {
          category: issue.category,
          issues: [],
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        };
      }
      byCategory[issue.category].issues.push(issue);
      byCategory[issue.category][issue.severity]++;
    }

    // Group categories into parent groups
    const parentGroups: Record<string, ParentGroup> = {};

    for (const cat of Object.values(byCategory)) {
      const parentName = categoryToParentGroup[cat.category] || 'Other';
      const config = parentGroupConfig[parentName] || { icon: AlertTriangle, color: 'text-gray-600', bgColor: 'bg-gray-50' };

      if (!parentGroups[parentName]) {
        parentGroups[parentName] = {
          name: parentName,
          icon: config.icon,
          color: config.color,
          bgColor: config.bgColor,
          categories: [],
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
          totalIssues: 0,
        };
      }

      parentGroups[parentName].categories.push(cat);
      parentGroups[parentName].critical += cat.critical;
      parentGroups[parentName].high += cat.high;
      parentGroups[parentName].medium += cat.medium;
      parentGroups[parentName].low += cat.low;
      parentGroups[parentName].totalIssues += cat.issues.length;
    }

    // Sort parent groups by severity score, and sort categories within each group
    const sortedParentGroups = Object.values(parentGroups)
      .map(group => ({
        ...group,
        categories: group.categories.sort((a, b) => {
          const aScore = a.critical * 100 + a.high * 10 + a.medium;
          const bScore = b.critical * 100 + b.high * 10 + b.medium;
          return bScore - aScore;
        }),
      }))
      .sort((a, b) => {
        const aScore = a.critical * 100 + a.high * 10 + a.medium;
        const bScore = b.critical * 100 + b.high * 10 + b.medium;
        return bScore - aScore;
      });

    return { counts, byType, parentGroups: sortedParentGroups };
  }, [filteredIssues]);

  const toggleCategory = (category: string) => {
    setExpandedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) {
        next.delete(category);
      } else {
        next.add(category);
      }
      return next;
    });
  };

  // Compute stats from ALL issues (unfiltered) for overview display
  const allStats = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const issue of issues) {
      counts[issue.severity]++;
    }
    return counts;
  }, [issues]);

  const totalIssues = allStats.critical + allStats.high + allStats.medium + allStats.low;

  return (
    <div className="flex-1 p-6 space-y-6 overflow-auto h-full bg-gray-50">
      {/* Stats Overview */}
      <StatsOverview
        title="Issue Analysis"
        subtitle={
          totalIssues > 0
            ? `${totalIssues} issues found across ${issuesByFile.length} files`
            : 'No issues found'
        }
        stats={allStats}
        selectedSeverity={selectedSeverity}
        onSeverityClick={setSelectedSeverity}
      />

      {/* Type Filter, Search & Clear */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex flex-wrap bg-white rounded-lg border border-gray-200 p-1 gap-1">
          {([
            { type: 'all' as const, icon: Layers, label: 'All' },
            { type: 'security' as const, icon: Shield, label: 'Security' },
            { type: 'reliability' as const, icon: Zap, label: 'Reliability' },
            { type: 'resilience' as const, icon: Heart, label: 'Resilience' },
            { type: 'concurrency' as const, icon: GitBranch, label: 'Concurrency' },
            { type: 'kafka' as const, icon: MessageSquare, label: 'Kafka' },
            { type: 'database' as const, icon: Database, label: 'Database' },
            { type: 'distributed' as const, icon: Network, label: 'Distributed' },
          ]).map(({ type, icon: Icon, label }) => {
            const count = type === 'all' ? totalIssues : stats.byType[type as IssueType];
            if (type !== 'all' && count === 0) return null;
            return (
              <button
                key={type}
                onClick={() => setSelectedType(type)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-all duration-150 ${
                  selectedType === type
                    ? 'bg-gray-900 text-white'
                    : 'text-gray-600 hover:bg-gray-100'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{label}</span>
                <span className={`ml-0.5 px-1.5 py-0.5 rounded text-xs ${
                  selectedType === type ? 'bg-white/20' : 'bg-gray-100'
                }`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Input */}
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search issues..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-8 py-2 bg-white border border-gray-200 rounded-lg text-sm placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900/10 focus:border-gray-300 transition-all"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-400 hover:text-gray-600 rounded transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        {(selectedSeverity || searchQuery) && (
          <button
            onClick={() => {
              setSelectedSeverity(null);
              setSearchQuery('');
            }}
            className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
          >
            Clear filters
            {selectedSeverity && (
              <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded capitalize">
                {selectedSeverity}
              </span>
            )}
            {searchQuery && (
              <span className="text-xs bg-gray-200 px-1.5 py-0.5 rounded">
                "{searchQuery}"
              </span>
            )}
          </button>
        )}
      </div>

      {/* Issues by Category - 2 Level Hierarchy */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">Issues by Category</h2>
          {searchQuery && (
            <span className="text-sm text-gray-500">
              {filteredIssues.length} result{filteredIssues.length !== 1 ? 's' : ''} for "{searchQuery}"
            </span>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {stats.parentGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupExpanded = expandedGroups.has(group.name);

            return (
              <div key={group.name} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                {/* Parent Group Header */}
                <button
                  onClick={() => toggleGroup(group.name)}
                  className={`w-full flex items-center justify-between p-4 hover:bg-gray-50 transition-colors ${group.bgColor}`}
                >
                  <div className="flex items-center gap-3">
                    {isGroupExpanded ? (
                      <ChevronDown className="w-5 h-5 text-gray-500" />
                    ) : (
                      <ChevronRight className="w-5 h-5 text-gray-500" />
                    )}
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${group.bgColor} border border-current/10`}>
                      <GroupIcon className={`w-4 h-4 ${group.color}`} />
                    </div>
                    <div>
                      <span className={`font-semibold ${group.color}`}>{group.name}</span>
                      <span className="text-sm text-gray-500 ml-2">
                        {group.totalIssues} issues in {group.categories.length} {group.categories.length === 1 ? 'category' : 'categories'}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    {group.critical > 0 && (
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
                        {group.critical}
                      </span>
                    )}
                    {group.high > 0 && (
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                        {group.high}
                      </span>
                    )}
                    {group.medium > 0 && (
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-500" />
                        {group.medium}
                      </span>
                    )}
                    {group.low > 0 && (
                      <span className="flex items-center gap-1 text-xs font-medium">
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500" />
                        {group.low}
                      </span>
                    )}
                  </div>
                </button>

                {/* Categories within group */}
                {isGroupExpanded && (
                  <div className="border-t border-gray-100">
                    {group.categories.map((cat) => (
                      <div key={cat.category}>
                        <button
                          onClick={() => toggleCategory(cat.category)}
                          className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0"
                        >
                          <div className="flex items-center gap-2">
                            {expandedCategories.has(cat.category) ? (
                              <ChevronDown className="w-4 h-4 text-gray-400" />
                            ) : (
                              <ChevronRight className="w-4 h-4 text-gray-400" />
                            )}
                            <span className="font-medium text-gray-700">{cat.category}</span>
                            <span className="text-sm text-gray-400">({cat.issues.length})</span>
                          </div>
                          <div className="flex items-center gap-2">
                            {cat.critical > 0 && (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="w-2 h-2 rounded-full bg-red-500" />
                                {cat.critical}
                              </span>
                            )}
                            {cat.high > 0 && (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="w-2 h-2 rounded-full bg-orange-500" />
                                {cat.high}
                              </span>
                            )}
                            {cat.medium > 0 && (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="w-2 h-2 rounded-full bg-yellow-500" />
                                {cat.medium}
                              </span>
                            )}
                            {cat.low > 0 && (
                              <span className="flex items-center gap-1 text-xs">
                                <span className="w-2 h-2 rounded-full bg-green-500" />
                                {cat.low}
                              </span>
                            )}
                          </div>
                        </button>

                        {/* Issues within category */}
                        {expandedCategories.has(cat.category) && (
                          <div className="bg-gray-50/50">
                            {cat.issues.map((issue) => (
                              <button
                                key={issue.id}
                                onClick={() => issue.filePath && onNavigateToFile(issue.filePath, issue.lineStart || undefined, issue.lineEnd || undefined)}
                                className="w-full flex items-start gap-3 px-4 py-3 pl-10 border-b border-gray-100 last:border-0 hover:bg-gray-100 text-left transition-colors"
                              >
                                <span className={`mt-1 w-2 h-2 rounded-full flex-shrink-0 ${severityColors[issue.severity]}`} />
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-gray-900 text-sm">{issue.title}</div>
                                  {issue.filePath && (
                                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                                      <FileCode className="w-3 h-3" />
                                      <span className="truncate">{issue.filePath}</span>
                                      {issue.lineStart && <span>:{issue.lineStart}</span>}
                                    </div>
                                  )}
                                </div>
                                <ExternalLink className="w-4 h-4 text-gray-400 flex-shrink-0" />
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
