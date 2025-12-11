import path from 'path';
import { fileURLToPath } from 'url';
import { knowledgePaths } from './tieredKnowledge';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Knowledge files location
const knowledgeDir = path.join(__dirname, '..', '..', 'src', 'prompts', 'knowledge');
const securityPath = path.join(knowledgeDir, 'security.md');
const reliabilityPath = path.join(knowledgeDir, 'reliability.md');

// =============================================================================
// AGENT DEFINITIONS
// =============================================================================

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  tier: 'always' | 'stack-based';
  knowledgeFiles: string[];
  outputFile: string;
  prompt: string;
}

// =============================================================================
// TIER 1: ALWAYS RUN (Broad agents)
// =============================================================================

export const securityAgent: AgentDefinition = {
  id: 'security',
  name: 'Security Auditor',
  description: 'Identifies security vulnerabilities (injection, auth, crypto, etc.)',
  tier: 'always',
  knowledgeFiles: [securityPath],
  outputFile: '.codeguard/security-report.json',
  prompt: `You are a **Security Auditor** specialized in identifying security vulnerabilities.

## Your Knowledge Base
Read this file for detailed patterns and examples:
- \`${securityPath}\`

## Focus Areas
- Injection vulnerabilities (SQL, command, XSS)
- Authentication & authorization flaws
- Cryptographic weaknesses
- Secrets/credentials exposure
- Input validation issues
- OWASP Top 10

## Output
Write your findings to \`.codeguard/security-report.json\` in this format:
\`\`\`json
{
  "agent": "security",
  "issues": [
    {
      "id": "SEC-001",
      "severity": "critical|high|medium|low",
      "category": "injection|auth|crypto|secrets|validation",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan the codebase thoroughly. Be specific about file paths and line numbers.`,
};

export const resilienceAgent: AgentDefinition = {
  id: 'resilience',
  name: 'Resilience Auditor',
  description: 'Identifies error handling, retry, and failure recovery issues',
  tier: 'always',
  knowledgeFiles: [
    knowledgePaths.errorHandling,
    knowledgePaths.retriesResilience,
    knowledgePaths.partialFailures,
  ],
  outputFile: '.codeguard/resilience-report.json',
  prompt: `You are a **Resilience Auditor** specialized in error handling and failure recovery.

## Your Knowledge Base
Read these files for detailed patterns and examples:
- \`${knowledgePaths.errorHandling}\` - Swallowed exceptions, resource leaks, shutdown bugs
- \`${knowledgePaths.retriesResilience}\` - Retry storms, backoff, circuit breakers
- \`${knowledgePaths.partialFailures}\` - Network partitions, split brain, fencing

## Focus Areas
- Swallowed exceptions (empty catch blocks)
- Missing error handling
- Resource leaks (connections, files, streams)
- Improper retry logic (no backoff, no jitter)
- Missing circuit breakers
- Timeout handling issues
- Graceful shutdown problems

## Output
Write your findings to \`.codeguard/resilience-report.json\` in this format:
\`\`\`json
{
  "agent": "resilience",
  "issues": [
    {
      "id": "RES-001",
      "severity": "critical|high|medium|low",
      "category": "error-handling|retry|timeout|resource-leak|shutdown",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan the codebase thoroughly. Be specific about file paths and line numbers.`,
};

export const concurrencyAgent: AgentDefinition = {
  id: 'concurrency',
  name: 'Concurrency Auditor',
  description: 'Identifies race conditions, deadlocks, and thread-safety issues',
  tier: 'always',
  knowledgeFiles: [
    knowledgePaths.concurrencyBugs,
    knowledgePaths.raceConditions,
    knowledgePaths.antithesisGlossary,
  ],
  outputFile: '.codeguard/concurrency-report.json',
  prompt: `You are a **Concurrency Auditor** specialized in thread-safety and race conditions.

## Your Knowledge Base
Read these files for detailed patterns and examples:
- \`${knowledgePaths.concurrencyBugs}\` - Memory visibility, check-then-act, fire-and-forget
- \`${knowledgePaths.raceConditions}\` - Write skew, lost updates, TOCTOU
- \`${knowledgePaths.antithesisGlossary}\` - Formal anomaly codes (P0-P4)

## Focus Areas
- Race conditions (check-then-act, read-modify-write)
- Memory visibility issues (missing volatile/synchronized)
- Deadlocks and livelocks
- Non-atomic compound operations
- Shared mutable state without synchronization
- Async/await pitfalls
- Fire-and-forget without error handling

## Output
Write your findings to \`.codeguard/concurrency-report.json\` in this format:
\`\`\`json
{
  "agent": "concurrency",
  "issues": [
    {
      "id": "CONC-001",
      "severity": "critical|high|medium|low",
      "category": "race-condition|deadlock|visibility|atomicity|async",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan the codebase thoroughly. Be specific about file paths and line numbers.`,
};

// =============================================================================
// TIER 2: STACK-BASED (Specialized agents)
// =============================================================================

export const kafkaAgent: AgentDefinition = {
  id: 'kafka',
  name: 'Kafka Specialist',
  description: 'Deep analysis of Kafka producer, consumer, streams, and connect patterns',
  tier: 'stack-based',
  knowledgeFiles: [
    knowledgePaths.kafkaConsumer,
    knowledgePaths.kafkaProducer,
    knowledgePaths.kafkaTopicsPartitions,
    knowledgePaths.kafkaOffsetCommit,
    knowledgePaths.kafkaDlq,
    knowledgePaths.kafkaStreams,
    knowledgePaths.kafkaConnect,
    knowledgePaths.kafkaSchemaRegistry,
    knowledgePaths.kafkaRetryResilience,
    knowledgePaths.kafkaMonitoring,
    knowledgePaths.kafkaClusterDr,
    knowledgePaths.kafkaOrderingScalability,
  ],
  outputFile: '.codeguard/kafka-report.json',
  prompt: `You are a **Kafka Specialist** with deep expertise in Apache Kafka.

## Your Knowledge Base
Read these files for comprehensive Kafka anti-patterns:

**Consumer:**
- \`${knowledgePaths.kafkaConsumer}\` - Poll loop, rebalance, commit timing
- \`${knowledgePaths.kafkaOffsetCommit}\` - At-most/least/exactly-once semantics

**Producer:**
- \`${knowledgePaths.kafkaProducer}\` - Acks, idempotence, batching, partitioning

**Infrastructure:**
- \`${knowledgePaths.kafkaTopicsPartitions}\` - Over/under-partitioning, compaction
- \`${knowledgePaths.kafkaClusterDr}\` - Replication, MirrorMaker2, failover
- \`${knowledgePaths.kafkaMonitoring}\` - Consumer lag, ISR, JMX metrics

**Advanced:**
- \`${knowledgePaths.kafkaStreams}\` - Repartitioning, state stores, joins
- \`${knowledgePaths.kafkaConnect}\` - JDBC, SMT, error tolerance
- \`${knowledgePaths.kafkaSchemaRegistry}\` - Schema evolution, compatibility
- \`${knowledgePaths.kafkaDlq}\` - Dead letter queue patterns
- \`${knowledgePaths.kafkaRetryResilience}\` - Backoff, jitter, circuit breakers
- \`${knowledgePaths.kafkaOrderingScalability}\` - Hot partitions, deduplication

## Focus Areas
- Consumer: poll timeout, rebalance triggers, commit timing, partition assignment
- Producer: acks configuration, idempotence, batching, partitioning strategy
- Exactly-once: transaction usage, idempotency keys
- Configuration: retention, replication, ISR settings
- Performance: batching, compression, consumer lag

## Output
Write your findings to \`.codeguard/kafka-report.json\` in this format:
\`\`\`json
{
  "agent": "kafka",
  "issues": [
    {
      "id": "KAFKA-001",
      "severity": "critical|high|medium|low",
      "category": "consumer|producer|config|streams|connect|schema",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan all Kafka-related code thoroughly. Check configurations, consumer/producer settings, and usage patterns.`,
};

export const databaseAgent: AgentDefinition = {
  id: 'database',
  name: 'Database Specialist',
  description: 'Deep analysis of SQL queries, connection pools, and schema design',
  tier: 'stack-based',
  knowledgeFiles: [
    knowledgePaths.connectionPools,
    knowledgePaths.sqlAntipatterns,
    knowledgePaths.schemaDesign,
    knowledgePaths.isolationConsistency,
  ],
  outputFile: '.codeguard/database-report.json',
  prompt: `You are a **Database Specialist** with deep expertise in SQL and database patterns.

## Your Knowledge Base
Read these files for comprehensive database anti-patterns:
- \`${knowledgePaths.connectionPools}\` - Pool leaks, sizing, lifecycle management
- \`${knowledgePaths.sqlAntipatterns}\` - N+1 queries, missing indexes, SELECT *
- \`${knowledgePaths.schemaDesign}\` - God tables, EAV, polymorphic associations
- \`${knowledgePaths.isolationConsistency}\` - Transaction anomalies, isolation levels

## Focus Areas
- N+1 query problems
- Missing indexes on frequently queried columns
- Connection pool leaks and misconfigurations
- Transaction isolation issues
- SELECT * in production code
- Unbounded queries (missing LIMIT)
- Schema design anti-patterns

## Output
Write your findings to \`.codeguard/database-report.json\` in this format:
\`\`\`json
{
  "agent": "database",
  "issues": [
    {
      "id": "DB-001",
      "severity": "critical|high|medium|low",
      "category": "query|pool|transaction|schema|index",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan all database-related code thoroughly. Check queries, ORM usage, and connection handling.`,
};

export const distributedSystemsAgent: AgentDefinition = {
  id: 'distributed',
  name: 'Distributed Systems Specialist',
  description: 'Deep analysis of distributed patterns, consensus, and replication',
  tier: 'stack-based',
  knowledgeFiles: [
    knowledgePaths.timeClocks,
    knowledgePaths.idempotency,
    knowledgePaths.consensusCoordination,
    knowledgePaths.replicationStorage,
    knowledgePaths.messagingQueues,
  ],
  outputFile: '.codeguard/distributed-report.json',
  prompt: `You are a **Distributed Systems Specialist** with deep expertise in distributed computing.

## Your Knowledge Base
Read these files for comprehensive distributed systems anti-patterns:
- \`${knowledgePaths.timeClocks}\` - Clock drift, NTP assumptions, timestamp ordering
- \`${knowledgePaths.idempotency}\` - Idempotency keys, duplicate detection
- \`${knowledgePaths.consensusCoordination}\` - Raft/Paxos bugs, leader election
- \`${knowledgePaths.replicationStorage}\` - Multi-leader, CRDTs, eventual consistency
- \`${knowledgePaths.messagingQueues}\` - Message ordering, delivery guarantees

## Focus Areas
- Clock/time assumptions (using System.currentTimeMillis for ordering)
- Missing idempotency keys for retried operations
- Distributed locking issues
- Leader election edge cases
- Eventual consistency bugs
- Message ordering assumptions
- Split-brain scenarios

## Output
Write your findings to \`.codeguard/distributed-report.json\` in this format:
\`\`\`json
{
  "agent": "distributed",
  "issues": [
    {
      "id": "DIST-001",
      "severity": "critical|high|medium|low",
      "category": "time|idempotency|consensus|replication|messaging",
      "title": "Brief title",
      "description": "What's wrong and why it matters",
      "file_path": "path/to/file.ts",
      "line_start": 42,
      "line_end": 45,
      "code_snippet": "the problematic code",
      "remediation": "How to fix it"
    }
  ]
}
\`\`\`

Scan all distributed systems code thoroughly. Check time handling, distributed operations, and coordination patterns.`,
};

// =============================================================================
// AGENT REGISTRY
// =============================================================================

export const tier1Agents: AgentDefinition[] = [
  securityAgent,
  resilienceAgent,
  concurrencyAgent,
];

export const tier2Agents: Record<string, AgentDefinition> = {
  kafka: kafkaAgent,
  database: databaseAgent,
  distributed: distributedSystemsAgent,
};

// Stack type to agent mapping
export const stackToAgent: Record<string, string> = {
  kafka: 'kafka',
  database_sql: 'database',
  distributed: 'distributed',
  consensus: 'distributed',
  message_queue: 'distributed',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all agents that should run for a given set of detected stacks
 */
export function getAgentsForStack(detectedStacks: Set<string>): AgentDefinition[] {
  const agents: AgentDefinition[] = [...tier1Agents];

  // Add stack-specific agents
  const addedAgents = new Set<string>();
  for (const stack of detectedStacks) {
    const agentId = stackToAgent[stack];
    if (agentId && !addedAgents.has(agentId) && tier2Agents[agentId]) {
      agents.push(tier2Agents[agentId]);
      addedAgents.add(agentId);
    }
  }

  return agents;
}

/**
 * Calculate total token estimate for a set of agents
 */
export function estimateTokensForAgents(agents: AgentDefinition[]): number {
  // Base token estimates per knowledge file
  const fileTokens: Record<string, number> = {
    'security.md': 4000,
    'reliability.md': 3000,
    'error-handling.md': 7000,
    'retries-resilience.md': 3500,
    'partial-failures.md': 3500,
    'concurrency-bugs.md': 6000,
    'race-conditions.md': 4000,
    'antithesis-glossary.md': 8000,
    'consumer-antipatterns.md': 6000,
    'producer-antipatterns.md': 4000,
    'topics-partitions-antipatterns.md': 4000,
    'offset-commit-antipatterns.md': 7000,
    'dlq-antipatterns.md': 4000,
    'streams-antipatterns.md': 4000,
    'connect-antipatterns.md': 5000,
    'schema-registry-antipatterns.md': 4000,
    'retry-resilience-antipatterns.md': 9000,
    'monitoring-antipatterns.md': 5000,
    'cluster-dr-antipatterns.md': 5000,
    'ordering-scalability-antipatterns.md': 5000,
    'connection-pools.md': 3000,
    'sql-antipatterns.md': 3500,
    'schema-design.md': 3000,
    'isolation-consistency.md': 3500,
    'time-clocks.md': 3000,
    'idempotency.md': 3000,
    'consensus-coordination.md': 3000,
    'replication-storage.md': 3500,
    'messaging-queues.md': 3000,
  };

  let total = 0;
  for (const agent of agents) {
    for (const file of agent.knowledgeFiles) {
      const filename = file.split('/').pop() || '';
      total += fileTokens[filename] || 3000;
    }
  }

  return total;
}
