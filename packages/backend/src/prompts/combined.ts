import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Knowledge files location (from dist/prompts to src/prompts/knowledge)
const knowledgeDir = path.join(__dirname, '..', '..', 'src', 'prompts', 'knowledge');
const securityPath = path.join(knowledgeDir, 'security.md');
const reliabilityPath = path.join(knowledgeDir, 'reliability.md');

// Extended knowledge base (in same directory as security.md/reliability.md)
const distributedSystemsDir = path.join(knowledgeDir, 'distributed-systems');
const databaseDir = path.join(knowledgeDir, 'database');

// Distributed Systems patterns
const raceConditionsPath = path.join(distributedSystemsDir, 'race-conditions.md');
const isolationConsistencyPath = path.join(distributedSystemsDir, 'isolation-consistency.md');
const timeClocksPath = path.join(distributedSystemsDir, 'time-clocks.md');
const retriesResiliencePath = path.join(distributedSystemsDir, 'retries-resilience.md');
const idempotencyPath = path.join(distributedSystemsDir, 'idempotency.md');
const partialFailuresPath = path.join(distributedSystemsDir, 'partial-failures.md');
const consensusCoordinationPath = path.join(distributedSystemsDir, 'consensus-coordination.md');
const replicationStoragePath = path.join(distributedSystemsDir, 'replication-storage.md');
const messagingQueuesPath = path.join(distributedSystemsDir, 'messaging-queues.md');
const antithesisGlossaryPath = path.join(distributedSystemsDir, 'antithesis-glossary.md');
const concurrencyBugsPath = path.join(distributedSystemsDir, 'concurrency-bugs.md');
const errorHandlingPath = path.join(distributedSystemsDir, 'error-handling.md');

// Database patterns
const connectionPoolsPath = path.join(databaseDir, 'connection-pools.md');
const sqlAntipatternsPath = path.join(databaseDir, 'sql-antipatterns.md');
const schemaDesignPath = path.join(databaseDir, 'schema-design.md');

// Master prompt with absolute paths injected
export const combinedAnalysisPrompt = `# Code Analysis

You are a code analysis expert. Perform both **Security** and **Reliability** audits simultaneously.

## Setup

\`\`\`bash
mkdir -p .codeguard
\`\`\`

## Execution

Spawn TWO parallel agents in a SINGLE message:

### Agent 1: Security
- Read \`${securityPath}\` for detailed instructions and examples
- Write findings to \`.codeguard/security-report.json\`

### Agent 2: Reliability
- Read \`${reliabilityPath}\` for detailed instructions and examples
- **Extended Knowledge Base** - Read these files for deeper pattern matching:
  - \`${antithesisGlossaryPath}\` - Formal anomaly codes (P0-P4, A5A, A5B), fault types
  - \`${concurrencyBugsPath}\` - Memory visibility, check-then-act, fire-and-forget
  - \`${errorHandlingPath}\` - Swallowed exceptions, resource leaks, shutdown bugs
  - \`${raceConditionsPath}\` - Race conditions, write skew, check-then-act
  - \`${isolationConsistencyPath}\` - Lost updates, write skew, read skew
  - \`${timeClocksPath}\` - Clock drift, timestamps, timeouts
  - \`${retriesResiliencePath}\` - Retry storms, thundering herd, backoff
  - \`${idempotencyPath}\` - Duplicate effects, idempotency keys
  - \`${partialFailuresPath}\` - Network partitions, split brain
  - \`${consensusCoordinationPath}\` - Raft/Paxos bugs, leader election
  - \`${replicationStoragePath}\` - Multi-leader, CRDTs, eventual consistency
  - \`${messagingQueuesPath}\` - Message ordering, delivery guarantees
  - \`${connectionPoolsPath}\` - Pool leaks, sizing, lifecycle
  - \`${sqlAntipatternsPath}\` - N+1, indexes, query optimization
  - \`${schemaDesignPath}\` - God tables, EAV, normalization
- Write findings to \`.codeguard/reliability-report.json\`

## Begin

1. Create \`.codeguard/\` directory
2. Spawn both agents in parallel (TWO Task tool calls in ONE message)
3. Wait for completion
4. Verify both JSON files exist
`;

// Export individual prompts for standalone use
export const securityPrompt = fs.readFileSync(securityPath, 'utf-8');
export const reliabilityPrompt = fs.readFileSync(reliabilityPath, 'utf-8');

// Export extended knowledge paths for agents to read
export const extendedKnowledgePaths = {
  distributedSystems: {
    antithesisGlossary: antithesisGlossaryPath,
    concurrencyBugs: concurrencyBugsPath,
    errorHandling: errorHandlingPath,
    raceConditions: raceConditionsPath,
    isolationConsistency: isolationConsistencyPath,
    timeClocks: timeClocksPath,
    retriesResilience: retriesResiliencePath,
    idempotency: idempotencyPath,
    partialFailures: partialFailuresPath,
    consensusCoordination: consensusCoordinationPath,
    replicationStorage: replicationStoragePath,
    messagingQueues: messagingQueuesPath,
  },
  database: {
    connectionPools: connectionPoolsPath,
    sqlAntipatterns: sqlAntipatternsPath,
    schemaDesign: schemaDesignPath,
  },
};

// Export all paths as a flat array for easy iteration
export const allExtendedKnowledgePaths = [
  antithesisGlossaryPath,
  concurrencyBugsPath,
  errorHandlingPath,
  raceConditionsPath,
  isolationConsistencyPath,
  timeClocksPath,
  retriesResiliencePath,
  idempotencyPath,
  partialFailuresPath,
  consensusCoordinationPath,
  replicationStoragePath,
  messagingQueuesPath,
  connectionPoolsPath,
  sqlAntipatternsPath,
  schemaDesignPath,
];
