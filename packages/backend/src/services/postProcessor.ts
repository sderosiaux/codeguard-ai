import fs from 'fs/promises';
import path from 'path';

/**
 * Normalize file path to be relative to repo root.
 * Strips absolute paths like /opt/codeguard-ai/repos/workspace-id/owner-name/...
 */
function normalizeFilePath(filePath: string | null | undefined, repoPath: string): string | null {
  if (!filePath) return null;

  // If path is already relative (doesn't start with /), return as-is
  if (!filePath.startsWith('/')) {
    return filePath;
  }

  // Check if the path contains the repo path prefix
  const normalizedRepoPath = repoPath.endsWith('/') ? repoPath : repoPath + '/';
  if (filePath.startsWith(normalizedRepoPath)) {
    return filePath.slice(normalizedRepoPath.length);
  }

  // Alternative: try to find common repo path patterns and strip them
  // Pattern: /opt/codeguard-ai/repos/workspace-id/owner-name/actual/path
  const repoPathMatch = filePath.match(/\/opt\/codeguard-ai\/repos\/[^/]+\/[^/]+\/(.+)/);
  if (repoPathMatch) {
    return repoPathMatch[1];
  }

  // Also handle local development paths
  const localMatch = filePath.match(/\/repos\/[^/]+\/[^/]+\/(.+)/);
  if (localMatch) {
    return localMatch[1];
  }

  // Fallback: if path is absolute but doesn't match known patterns,
  // just return the filename portion as last resort
  console.warn(`Could not normalize path: ${filePath}`);
  return path.basename(filePath);
}

// Issue types matching specialized agents
export type IssueType = 'security' | 'resilience' | 'concurrency' | 'kafka' | 'database' | 'distributed';

// Raw issue from agent report
export interface RawIssue {
  id: string;
  severity: string;
  category: string;
  title: string;
  description: string;
  file_path?: string | null;
  line_start?: number | null;
  line_end?: number | null;
  code_snippet?: string | null;
  remediation?: string | null;
}

// Processed issue with assigned type
export interface ProcessedIssue extends RawIssue {
  type: IssueType;
  sourceAgent: string;
}

// Agent report structure
interface AgentReport {
  agent: string;
  issues: RawIssue[];
}

// =============================================================================
// CATEGORY TO TYPE MAPPING
// =============================================================================
// This determines the final type based on issue category, NOT source agent.
// This allows proper categorization even when agents find cross-domain issues.

const categoryToType: Record<string, IssueType> = {
  // Security categories
  'injection': 'security',
  'auth': 'security',
  'crypto': 'security',
  'secrets': 'security',
  'validation': 'security',
  'xss': 'security',
  'authentication': 'security',
  'authorization': 'security',

  // Resilience categories
  'error-handling': 'resilience',
  'retry': 'resilience',
  'timeout': 'resilience',
  'resource-leak': 'resilience',
  'shutdown': 'resilience',
  'circuit-breaker': 'resilience',

  // Concurrency categories
  'race-condition': 'concurrency',
  'deadlock': 'concurrency',
  'visibility': 'concurrency',
  'atomicity': 'concurrency',
  'async': 'concurrency',
  'thread-safety': 'concurrency',

  // Kafka categories
  'consumer': 'kafka',
  'producer': 'kafka',
  'streams': 'kafka',
  'connect': 'kafka',
  'schema': 'kafka',
  'offset': 'kafka',
  'rebalance': 'kafka',

  // Database categories
  'query': 'database',
  'pool': 'database',
  'transaction': 'database',
  'index': 'database',
  'n+1': 'database',
  'sql': 'database',

  // Distributed systems categories
  'time': 'distributed',
  'idempotency': 'distributed',
  'consensus': 'distributed',
  'replication': 'distributed',
  'messaging': 'distributed',
  'clock': 'distributed',
  'partition': 'distributed',
};

// Fallback: agent ID to type (when category doesn't match)
const agentToType: Record<string, IssueType> = {
  'security': 'security',
  'resilience': 'resilience',
  'concurrency': 'concurrency',
  'kafka': 'kafka',
  'database': 'database',
  'distributed': 'distributed',
};

/**
 * Determine the issue type based on category, with agent fallback
 */
function determineType(category: string, sourceAgent: string): IssueType {
  const normalizedCategory = category.toLowerCase().trim();

  // First, try exact match
  if (categoryToType[normalizedCategory]) {
    return categoryToType[normalizedCategory];
  }

  // Try partial match (category contains key)
  for (const [key, type] of Object.entries(categoryToType)) {
    if (normalizedCategory.includes(key)) {
      return type;
    }
  }

  // Fallback to agent's default type
  return agentToType[sourceAgent] || 'security';
}

/**
 * Create a unique key for deduplication
 */
function getIssueKey(issue: RawIssue): string {
  if (issue.file_path && issue.line_start) {
    return `${issue.file_path}:${issue.line_start}`;
  }
  // For issues without location, use title hash
  return `no-loc:${issue.title.toLowerCase().replace(/\s+/g, '-')}`;
}

/**
 * Compare two issues and return the "better" one
 * Prefers: higher severity, more detailed description, has remediation
 */
function selectBestIssue(existing: ProcessedIssue, candidate: ProcessedIssue): ProcessedIssue {
  const severityRank: Record<string, number> = {
    'critical': 4,
    'high': 3,
    'medium': 2,
    'low': 1,
  };

  const existingSeverity = severityRank[existing.severity.toLowerCase()] || 0;
  const candidateSeverity = severityRank[candidate.severity.toLowerCase()] || 0;

  // Higher severity wins
  if (candidateSeverity > existingSeverity) {
    return candidate;
  }
  if (existingSeverity > candidateSeverity) {
    return existing;
  }

  // Same severity: prefer one with remediation
  if (candidate.remediation && !existing.remediation) {
    return candidate;
  }
  if (existing.remediation && !candidate.remediation) {
    return existing;
  }

  // Same severity and remediation: prefer longer description
  if ((candidate.description?.length || 0) > (existing.description?.length || 0)) {
    return candidate;
  }

  return existing;
}

/**
 * Load all agent reports from .codeguard directory
 */
async function loadAgentReports(codeguardDir: string): Promise<AgentReport[]> {
  const reports: AgentReport[] = [];

  try {
    const files = await fs.readdir(codeguardDir);
    const reportFiles = files.filter(f => f.endsWith('-report.json'));

    for (const file of reportFiles) {
      try {
        const content = await fs.readFile(path.join(codeguardDir, file), 'utf-8');
        const report = JSON.parse(content) as AgentReport;
        if (report.agent && Array.isArray(report.issues)) {
          reports.push(report);
          console.log(`Loaded ${report.issues.length} issues from ${file}`);
        }
      } catch (err) {
        console.warn(`Failed to parse ${file}:`, err);
      }
    }
  } catch (err) {
    console.warn(`Failed to read codeguard directory:`, err);
  }

  return reports;
}

/**
 * Post-process all agent reports:
 * 1. Load all reports
 * 2. Assign types based on category
 * 3. Deduplicate by file+line
 * 4. Return unified issue list
 */
export async function postProcessReports(repoPath: string): Promise<ProcessedIssue[]> {
  const codeguardDir = path.join(repoPath, '.codeguard');
  const reports = await loadAgentReports(codeguardDir);

  // Collect all issues with assigned types
  const issueMap = new Map<string, ProcessedIssue>();
  let totalRaw = 0;

  for (const report of reports) {
    for (const issue of report.issues) {
      totalRaw++;

      const type = determineType(issue.category, report.agent);
      const processedIssue: ProcessedIssue = {
        ...issue,
        file_path: normalizeFilePath(issue.file_path, repoPath),
        type,
        sourceAgent: report.agent,
      };

      const key = getIssueKey(processedIssue);
      const existing = issueMap.get(key);

      if (existing) {
        // Duplicate found - keep the better one
        const best = selectBestIssue(existing, processedIssue);
        if (best !== existing) {
          console.log(`Dedup: Replacing ${existing.sourceAgent}'s issue with ${processedIssue.sourceAgent}'s at ${key}`);
        } else {
          console.log(`Dedup: Keeping ${existing.sourceAgent}'s issue, skipping ${processedIssue.sourceAgent}'s at ${key}`);
        }
        issueMap.set(key, best);
      } else {
        issueMap.set(key, processedIssue);
      }
    }
  }

  const uniqueIssues = Array.from(issueMap.values());
  const dedupedCount = totalRaw - uniqueIssues.length;

  console.log(`Post-processing complete: ${totalRaw} raw → ${uniqueIssues.length} unique (${dedupedCount} duplicates removed)`);

  // Log type distribution
  const typeCounts: Record<string, number> = {};
  for (const issue of uniqueIssues) {
    typeCounts[issue.type] = (typeCounts[issue.type] || 0) + 1;
  }
  console.log('Issue distribution by type:', typeCounts);

  return uniqueIssues;
}

/**
 * Write unified report to .codeguard/unified-report.json
 */
export async function writeUnifiedReport(repoPath: string, issues: ProcessedIssue[]): Promise<void> {
  const codeguardDir = path.join(repoPath, '.codeguard');
  const unifiedPath = path.join(codeguardDir, 'unified-report.json');

  const report = {
    timestamp: new Date().toISOString(),
    totalIssues: issues.length,
    byType: {} as Record<string, number>,
    bySeverity: {} as Record<string, number>,
    issues,
  };

  // Calculate stats
  for (const issue of issues) {
    report.byType[issue.type] = (report.byType[issue.type] || 0) + 1;
    report.bySeverity[issue.severity] = (report.bySeverity[issue.severity] || 0) + 1;
  }

  await fs.writeFile(unifiedPath, JSON.stringify(report, null, 2));
  console.log(`Unified report written to ${unifiedPath}`);
}
