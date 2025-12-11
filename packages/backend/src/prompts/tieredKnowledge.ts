import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Knowledge files location (from dist/prompts to src/prompts/knowledge)
const knowledgeDir = path.join(__dirname, '..', '..', 'src', 'prompts', 'knowledge');
const distributedSystemsDir = path.join(knowledgeDir, 'distributed-systems');
const databaseDir = path.join(knowledgeDir, 'database');
const kafkaDir = path.join(knowledgeDir, 'kafka');

// =============================================================================
// KNOWLEDGE FILE PATHS
// =============================================================================

export const knowledgePaths = {
  // Foundation (Tier 1 - Always loaded)
  antithesisGlossary: path.join(distributedSystemsDir, 'antithesis-glossary.md'),
  concurrencyBugs: path.join(distributedSystemsDir, 'concurrency-bugs.md'),
  errorHandling: path.join(distributedSystemsDir, 'error-handling.md'),

  // Distributed Systems (Tier 2 - Stack-based)
  raceConditions: path.join(distributedSystemsDir, 'race-conditions.md'),
  isolationConsistency: path.join(distributedSystemsDir, 'isolation-consistency.md'),
  timeClocks: path.join(distributedSystemsDir, 'time-clocks.md'),
  retriesResilience: path.join(distributedSystemsDir, 'retries-resilience.md'),
  idempotency: path.join(distributedSystemsDir, 'idempotency.md'),
  partialFailures: path.join(distributedSystemsDir, 'partial-failures.md'),
  consensusCoordination: path.join(distributedSystemsDir, 'consensus-coordination.md'),
  replicationStorage: path.join(distributedSystemsDir, 'replication-storage.md'),
  messagingQueues: path.join(distributedSystemsDir, 'messaging-queues.md'),

  // Database (Tier 2 - Stack-based)
  connectionPools: path.join(databaseDir, 'connection-pools.md'),
  sqlAntipatterns: path.join(databaseDir, 'sql-antipatterns.md'),
  schemaDesign: path.join(databaseDir, 'schema-design.md'),

  // Kafka (Tier 2 - Stack-based)
  kafkaConsumer: path.join(kafkaDir, 'consumer-antipatterns.md'),
  kafkaProducer: path.join(kafkaDir, 'producer-antipatterns.md'),
  kafkaTopicsPartitions: path.join(kafkaDir, 'topics-partitions-antipatterns.md'),
  kafkaOffsetCommit: path.join(kafkaDir, 'offset-commit-antipatterns.md'),
  kafkaDlq: path.join(kafkaDir, 'dlq-antipatterns.md'),
  kafkaStreams: path.join(kafkaDir, 'streams-antipatterns.md'),
  kafkaConnect: path.join(kafkaDir, 'connect-antipatterns.md'),
  kafkaSchemaRegistry: path.join(kafkaDir, 'schema-registry-antipatterns.md'),
  kafkaRetryResilience: path.join(kafkaDir, 'retry-resilience-antipatterns.md'),
  kafkaMonitoring: path.join(kafkaDir, 'monitoring-antipatterns.md'),
  kafkaClusterDr: path.join(kafkaDir, 'cluster-dr-antipatterns.md'),
  kafkaOrderingScalability: path.join(kafkaDir, 'ordering-scalability-antipatterns.md'),
};

// =============================================================================
// TIER DEFINITIONS
// =============================================================================

export enum Tier {
  ALWAYS = 'always',      // T1: Always loaded - foundation knowledge
  STACK_BASED = 'stack',  // T2: Loaded based on detected tech stack
  ON_DEMAND = 'demand',   // T3: Loaded only when specific patterns detected
}

export interface KnowledgeFile {
  path: string;
  name: string;
  description: string;
  tier: Tier;
  stackTriggers?: StackType[];  // Which stacks trigger loading (for T2)
}

export enum StackType {
  JAVA_JVM = 'java_jvm',
  PYTHON = 'python',
  TYPESCRIPT_NODE = 'typescript_node',
  GO = 'go',
  DATABASE_SQL = 'database_sql',
  MESSAGE_QUEUE = 'message_queue',
  DISTRIBUTED = 'distributed',
  CONSENSUS = 'consensus',
  KAFKA = 'kafka',
}

// =============================================================================
// KNOWLEDGE FILE REGISTRY
// =============================================================================

export const knowledgeRegistry: KnowledgeFile[] = [
  // TIER 1: Always loaded (foundation)
  {
    path: knowledgePaths.antithesisGlossary,
    name: 'Antithesis Glossary',
    description: 'Formal anomaly codes (P0-P4, A5A, A5B), consistency models, fault types, error classification',
    tier: Tier.ALWAYS,
  },
  {
    path: knowledgePaths.concurrencyBugs,
    name: 'Concurrency Bugs',
    description: 'Memory visibility, check-then-act, fire-and-forget, atomic operations',
    tier: Tier.ALWAYS,
  },
  {
    path: knowledgePaths.errorHandling,
    name: 'Error Handling',
    description: 'Swallowed exceptions, resource leaks, shutdown bugs, error classification',
    tier: Tier.ALWAYS,
  },

  // TIER 2: Stack-based loading
  {
    path: knowledgePaths.raceConditions,
    name: 'Race Conditions',
    description: 'Write skew, UPSERT races, lost updates, check-then-act patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.JAVA_JVM, StackType.DISTRIBUTED, StackType.DATABASE_SQL],
  },
  {
    path: knowledgePaths.isolationConsistency,
    name: 'Isolation & Consistency',
    description: 'Transaction anomalies P4, A5A, A5B with database examples',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DATABASE_SQL],
  },
  {
    path: knowledgePaths.timeClocks,
    name: 'Time & Clocks',
    description: 'Clock drift, NTP assumptions, timeout issues, timestamp ordering',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DISTRIBUTED],
  },
  {
    path: knowledgePaths.retriesResilience,
    name: 'Retries & Resilience',
    description: 'Retry storms, thundering herd, exponential backoff, circuit breakers',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DISTRIBUTED, StackType.MESSAGE_QUEUE],
  },
  {
    path: knowledgePaths.idempotency,
    name: 'Idempotency',
    description: 'Stripe-style idempotency keys, recovery points, duplicate detection',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DISTRIBUTED, StackType.MESSAGE_QUEUE],
  },
  {
    path: knowledgePaths.partialFailures,
    name: 'Partial Failures',
    description: 'Split-brain, network partitions, fencing tokens, failure detection',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DISTRIBUTED, StackType.CONSENSUS],
  },
  {
    path: knowledgePaths.consensusCoordination,
    name: 'Consensus & Coordination',
    description: 'Raft/Paxos bugs, leader election, distributed locking issues',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.CONSENSUS, StackType.DISTRIBUTED],
  },
  {
    path: knowledgePaths.replicationStorage,
    name: 'Replication & Storage',
    description: 'Multi-leader, CRDTs, eventual consistency, conflict resolution',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DISTRIBUTED, StackType.DATABASE_SQL],
  },
  {
    path: knowledgePaths.messagingQueues,
    name: 'Messaging & Queues',
    description: 'LMAX Disruptor patterns, message ordering, delivery guarantees',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.MESSAGE_QUEUE],
  },
  {
    path: knowledgePaths.connectionPools,
    name: 'Connection Pools',
    description: 'HikariCP patterns, leak detection, pool sizing, lifecycle management',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DATABASE_SQL],
  },
  {
    path: knowledgePaths.sqlAntipatterns,
    name: 'SQL Antipatterns',
    description: 'N+1 queries, missing indexes, SELECT *, query optimization',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DATABASE_SQL],
  },
  {
    path: knowledgePaths.schemaDesign,
    name: 'Schema Design',
    description: 'God tables, EAV pattern, polymorphic associations, normalization',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.DATABASE_SQL],
  },

  // Kafka (Tier 2 - Stack-based)
  {
    path: knowledgePaths.kafkaConsumer,
    name: 'Kafka Consumer',
    description: 'Poll loop, rebalance, commit timing, partition assignment anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaProducer,
    name: 'Kafka Producer',
    description: 'Acks, idempotence, batching, partitioning, sync send anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaTopicsPartitions,
    name: 'Kafka Topics & Partitions',
    description: 'Over/under-partitioning, message size, compaction, retention anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaOffsetCommit,
    name: 'Kafka Offset & Commit',
    description: 'At-most-once, at-least-once, exactly-once, auto-commit anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaDlq,
    name: 'Kafka DLQ',
    description: 'Dead letter queue metadata, monitoring, retry strategy anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaStreams,
    name: 'Kafka Streams',
    description: 'Repartitioning, state stores, joins, punctuation, serdes anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaConnect,
    name: 'Kafka Connect',
    description: 'JDBC bottlenecks, SMT overuse, error tolerance, task imbalance anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaSchemaRegistry,
    name: 'Kafka Schema Registry',
    description: 'Schema evolution, compatibility modes, Avro/Protobuf anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaRetryResilience,
    name: 'Kafka Retry & Resilience',
    description: 'Backoff, jitter, circuit breaker, error classification anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaMonitoring,
    name: 'Kafka Monitoring',
    description: 'Consumer lag, ISR, JMX metrics, alerting anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaClusterDr,
    name: 'Kafka Cluster & DR',
    description: 'Replication, min.insync.replicas, MirrorMaker2, failover anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
  {
    path: knowledgePaths.kafkaOrderingScalability,
    name: 'Kafka Ordering & Scalability',
    description: 'Partition key, deduplication, hot partitions, throughput anti-patterns',
    tier: Tier.STACK_BASED,
    stackTriggers: [StackType.KAFKA],
  },
];

// =============================================================================
// STACK DETECTION
// =============================================================================

export interface DetectedStack {
  types: Set<StackType>;
  evidence: Map<StackType, string[]>;  // What triggered detection
}

interface DetectionPattern {
  stack: StackType;
  filePatterns?: string[];      // Glob patterns for file extensions
  importPatterns?: RegExp[];    // Regex for import statements
  contentPatterns?: RegExp[];   // Regex for code content
}

const detectionPatterns: DetectionPattern[] = [
  // Java/JVM
  {
    stack: StackType.JAVA_JVM,
    filePatterns: ['**/*.java', '**/*.kt', '**/*.scala', '**/pom.xml', '**/build.gradle'],
    importPatterns: [
      /import\s+java\./,
      /import\s+javax\./,
      /import\s+kotlin\./,
      /import\s+scala\./,
    ],
    contentPatterns: [
      /synchronized\s*\(/,
      /volatile\s+/,
      /AtomicInteger|AtomicLong|AtomicReference/,
      /ReentrantLock|ReadWriteLock/,
      /CompletableFuture|ExecutorService/,
    ],
  },

  // Python
  {
    stack: StackType.PYTHON,
    filePatterns: ['**/*.py', '**/requirements.txt', '**/pyproject.toml', '**/Pipfile'],
    importPatterns: [
      /^import\s+asyncio/m,
      /^from\s+threading\s+import/m,
      /^from\s+multiprocessing\s+import/m,
    ],
    contentPatterns: [
      /async\s+def\s+/,
      /await\s+/,
      /threading\.Lock\(\)/,
    ],
  },

  // TypeScript/Node
  {
    stack: StackType.TYPESCRIPT_NODE,
    filePatterns: ['**/*.ts', '**/*.tsx', '**/*.js', '**/*.mjs', '**/package.json'],
    importPatterns: [
      /import\s+.*from\s+['"]express['"]/,
      /import\s+.*from\s+['"]fastify['"]/,
      /require\s*\(\s*['"]express['"]\s*\)/,
    ],
    contentPatterns: [
      /async\s+function/,
      /new\s+Promise\s*\(/,
      /\.then\s*\(/,
    ],
  },

  // Go
  {
    stack: StackType.GO,
    filePatterns: ['**/*.go', '**/go.mod', '**/go.sum'],
    contentPatterns: [
      /go\s+func\s*\(/,
      /sync\.Mutex/,
      /sync\.WaitGroup/,
      /<-\s*chan\s+/,
      /select\s*\{/,
    ],
  },

  // Database/SQL
  {
    stack: StackType.DATABASE_SQL,
    filePatterns: ['**/*.sql', '**/migrations/**/*', '**/schema/**/*'],
    importPatterns: [
      /import\s+.*['"]pg['"]/,
      /import\s+.*['"]mysql/,
      /import\s+.*['"]sequelize['"]/,
      /import\s+.*['"]typeorm['"]/,
      /import\s+.*['"]prisma['"]/,
      /import\s+.*['"]drizzle/,
      /import\s+.*['"]knex['"]/,
      /from\s+sqlalchemy/,
      /import\s+psycopg2/,
      /import\s+pymysql/,
    ],
    contentPatterns: [
      /SELECT\s+.*\s+FROM\s+/i,
      /INSERT\s+INTO\s+/i,
      /UPDATE\s+.*\s+SET\s+/i,
      /DELETE\s+FROM\s+/i,
      /CREATE\s+TABLE\s+/i,
      /\.query\s*\(\s*['"`]SELECT/i,
      /\.execute\s*\(\s*['"`]SELECT/i,
      /BEGIN\s+TRANSACTION/i,
      /COMMIT|ROLLBACK/i,
      /@Transaction\s*\(/,
      /@Entity\s*\(/,
      /HikariCP|HikariDataSource/,
      /DataSource|ConnectionPool/,
    ],
  },

  // Message Queues
  {
    stack: StackType.MESSAGE_QUEUE,
    importPatterns: [
      /import\s+.*['"]kafkajs['"]/,
      /import\s+.*['"]amqplib['"]/,
      /import\s+.*['"]bullmq['"]/,
      /import\s+.*['"]@aws-sdk\/client-sqs['"]/,
      /import\s+.*['"]@google-cloud\/pubsub['"]/,
      /from\s+kafka/i,
      /from\s+pika/,
      /from\s+celery/,
      /import\s+org\.apache\.kafka/,
      /import\s+com\.rabbitmq/,
    ],
    contentPatterns: [
      /KafkaProducer|KafkaConsumer/,
      /@KafkaListener/,
      /RabbitMQ|AMQP/,
      /SQS|SNS/,
      /PubSub|pubsub/,
      /MessageQueue|message_queue/,
      /\.publish\s*\(|\.subscribe\s*\(/,
      /consumer\.poll|producer\.send/,
    ],
  },

  // Distributed Systems (general)
  {
    stack: StackType.DISTRIBUTED,
    importPatterns: [
      /import\s+.*['"]redis['"]/,
      /import\s+.*['"]ioredis['"]/,
      /import\s+.*['"]@grpc/,
      /import\s+.*['"]axios['"]/,
      /import\s+.*['"]node-fetch['"]/,
      /import\s+grpc/,
      /import\s+redis/i,
      /import\s+aiohttp/,
      /import\s+httpx/,
    ],
    contentPatterns: [
      /retry|Retry|RETRY/,
      /circuit.?breaker/i,
      /timeout|Timeout|TIMEOUT/,
      /idempotency.?key/i,
      /distributed.?lock/i,
      /rate.?limit/i,
      /backoff|back.?off/i,
      /health.?check/i,
      /service.?discovery/i,
      /load.?balancer/i,
    ],
  },

  // Consensus/Coordination
  {
    stack: StackType.CONSENSUS,
    importPatterns: [
      /import\s+.*['"]zookeeper['"]/,
      /import\s+.*['"]etcd['"]/,
      /import\s+.*['"]consul['"]/,
    ],
    contentPatterns: [
      /ZooKeeper|zookeeper/,
      /etcd|Etcd|ETCD/,
      /Consul|consul/,
      /leader.?election/i,
      /raft|Raft|RAFT/,
      /paxos|Paxos|PAXOS/,
      /quorum|Quorum/,
      /distributed.?consensus/i,
      /cluster.?membership/i,
    ],
  },

  // Kafka
  {
    stack: StackType.KAFKA,
    filePatterns: ['**/kafka/**/*', '**/confluent/**/*'],
    importPatterns: [
      /import\s+.*['"]kafkajs['"]/,
      /import\s+.*['"]kafka-node['"]/,
      /import\s+.*['"]@confluentinc/,
      /from\s+kafka/i,
      /from\s+confluent_kafka/,
      /import\s+org\.apache\.kafka/,
      /import\s+io\.confluent/,
    ],
    contentPatterns: [
      /KafkaProducer|KafkaConsumer/,
      /KafkaTemplate|@KafkaListener/,
      /ProducerRecord|ConsumerRecord/,
      /kafka\.bootstrap\.servers/,
      /bootstrap_servers/,
      /ConsumerConfig|ProducerConfig/,
      /KafkaStreams|StreamsBuilder/,
      /KafkaConnect|SourceConnector|SinkConnector/,
      /SchemaRegistry|AvroSerializer/,
      /consumer\.poll|producer\.send/,
      /commitSync|commitAsync/,
      /\.subscribe\s*\(\s*\[?\s*['"][^'"]+['"]/,
      /enable\.idempotence/,
      /acks\s*[=:]\s*['"]?all['"]?/,
    ],
  },
];

// Directories to skip during scanning
const SKIP_DIRS = new Set([
  'node_modules', 'vendor', '.git', 'dist', 'build', '__pycache__',
  '.next', '.nuxt', 'target', 'out', 'coverage', '.cache',
]);

/**
 * Recursively find files with specific extensions (native fs, no glob dependency)
 */
function findFiles(
  dir: string,
  extensions: string[],
  maxFiles: number = 100,
  maxDepth: number = 6,
  currentDepth: number = 0,
): string[] {
  if (currentDepth > maxDepth) return [];

  const results: string[] = [];

  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      if (results.length >= maxFiles) break;

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          const subFiles = findFiles(
            path.join(dir, entry.name),
            extensions,
            maxFiles - results.length,
            maxDepth,
            currentDepth + 1,
          );
          results.push(...subFiles);
        }
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase().slice(1);
        if (extensions.includes(ext)) {
          results.push(path.join(dir, entry.name));
        }
      }
    }
  } catch {
    // Directory read failed, continue
  }

  return results;
}

/**
 * Check if specific files exist in the repo (for config files)
 */
function fileExists(repoPath: string, relativePaths: string[]): string | null {
  for (const rel of relativePaths) {
    const fullPath = path.join(repoPath, rel);
    if (fs.existsSync(fullPath)) {
      return rel;
    }
  }
  return null;
}

/**
 * Detect the technology stack of a repository
 */
export async function detectStack(repoPath: string): Promise<DetectedStack> {
  const detected: DetectedStack = {
    types: new Set(),
    evidence: new Map(),
  };

  const addEvidence = (stack: StackType, evidence: string) => {
    detected.types.add(stack);
    if (!detected.evidence.has(stack)) {
      detected.evidence.set(stack, []);
    }
    detected.evidence.get(stack)!.push(evidence);
  };

  // Quick file extension checks
  const extensionMap: Record<string, { stack: StackType; extensions: string[]; configFiles?: string[] }> = {
    java: {
      stack: StackType.JAVA_JVM,
      extensions: ['java', 'kt', 'scala'],
      configFiles: ['pom.xml', 'build.gradle', 'build.gradle.kts'],
    },
    python: {
      stack: StackType.PYTHON,
      extensions: ['py'],
      configFiles: ['requirements.txt', 'pyproject.toml', 'Pipfile', 'setup.py'],
    },
    typescript: {
      stack: StackType.TYPESCRIPT_NODE,
      extensions: ['ts', 'tsx', 'js', 'mjs'],
      configFiles: ['package.json', 'tsconfig.json'],
    },
    go: {
      stack: StackType.GO,
      extensions: ['go'],
      configFiles: ['go.mod', 'go.sum'],
    },
  };

  // Check for language-specific files
  for (const [lang, config] of Object.entries(extensionMap)) {
    const files = findFiles(repoPath, config.extensions, 5);
    if (files.length > 0) {
      addEvidence(config.stack, `Found ${files.length}+ ${lang} files`);
    }
    if (config.configFiles) {
      const configFile = fileExists(repoPath, config.configFiles);
      if (configFile) {
        addEvidence(config.stack, `Found ${configFile}`);
      }
    }
  }

  // Check SQL files
  const sqlFiles = findFiles(repoPath, ['sql'], 5);
  if (sqlFiles.length > 0) {
    addEvidence(StackType.DATABASE_SQL, `Found ${sqlFiles.length}+ SQL files`);
  }

  // Sample code files for pattern detection
  const codeExtensions = ['ts', 'js', 'py', 'java', 'go', 'kt'];
  const sampleFiles = findFiles(repoPath, codeExtensions, 30);

  for (const file of sampleFiles) {
    try {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(repoPath, file);

      for (const pattern of detectionPatterns) {
        const allPatterns = [...(pattern.importPatterns || []), ...(pattern.contentPatterns || [])];

        for (const regex of allPatterns) {
          if (regex.test(content)) {
            addEvidence(pattern.stack, `Pattern matched in ${relativePath}`);
            break; // One match per pattern per file is enough
          }
        }
      }
    } catch {
      // File read failed, continue
    }
  }

  return detected;
}

// =============================================================================
// TIERED LOADING
// =============================================================================

export interface TieredKnowledgeResult {
  tier1: KnowledgeFile[];  // Always loaded
  tier2: KnowledgeFile[];  // Loaded based on stack
  all: KnowledgeFile[];    // Combined
  detectedStack: DetectedStack;
  tokenEstimate: number;   // Rough token estimate
}

// Rough token estimates per file (based on line counts)
const TOKEN_ESTIMATES: Record<string, number> = {
  // Distributed Systems
  'antithesis-glossary.md': 8000,
  'concurrency-bugs.md': 6000,
  'error-handling.md': 7000,
  'race-conditions.md': 4000,
  'isolation-consistency.md': 3500,
  'time-clocks.md': 3000,
  'retries-resilience.md': 3500,
  'idempotency.md': 3000,
  'partial-failures.md': 3500,
  'consensus-coordination.md': 3000,
  'replication-storage.md': 3500,
  'messaging-queues.md': 3000,
  // Database
  'connection-pools.md': 3000,
  'sql-antipatterns.md': 3500,
  'schema-design.md': 3000,
  // Kafka
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
};

/**
 * Get knowledge files to load based on detected stack
 */
export async function getTieredKnowledge(repoPath: string): Promise<TieredKnowledgeResult> {
  const detectedStack = await detectStack(repoPath);

  const tier1: KnowledgeFile[] = [];
  const tier2: KnowledgeFile[] = [];

  for (const file of knowledgeRegistry) {
    if (file.tier === Tier.ALWAYS) {
      tier1.push(file);
    } else if (file.tier === Tier.STACK_BASED && file.stackTriggers) {
      // Check if any of the file's stack triggers match detected stacks
      const shouldLoad = file.stackTriggers.some(trigger => detectedStack.types.has(trigger));
      if (shouldLoad) {
        tier2.push(file);
      }
    }
  }

  const all = [...tier1, ...tier2];

  // Calculate token estimate
  let tokenEstimate = 0;
  for (const file of all) {
    const filename = path.basename(file.path);
    tokenEstimate += TOKEN_ESTIMATES[filename] || 3000;
  }

  return {
    tier1,
    tier2,
    all,
    detectedStack,
    tokenEstimate,
  };
}

// =============================================================================
// PROMPT GENERATION
// =============================================================================

/**
 * Generate the knowledge loading instructions for the reliability agent
 */
export function generateKnowledgePrompt(tieredResult: TieredKnowledgeResult): string {
  const { tier1, tier2, detectedStack, tokenEstimate } = tieredResult;

  let prompt = `## Knowledge Base (Tiered Loading)

**Detected Stack:** ${Array.from(detectedStack.types).join(', ') || 'Generic'}
**Estimated Tokens:** ~${tokenEstimate.toLocaleString()}

### Tier 1: Foundation (Always Read)
These files contain universal patterns applicable to all codebases:

`;

  for (const file of tier1) {
    prompt += `- \`${file.path}\`
  - ${file.description}\n`;
  }

  if (tier2.length > 0) {
    prompt += `
### Tier 2: Stack-Specific (Read Based on Detection)
These files are relevant to the detected technology stack:

`;
    for (const file of tier2) {
      prompt += `- \`${file.path}\`
  - ${file.description}\n`;
    }
  }

  if (tier2.length === 0) {
    prompt += `
### Tier 2: Stack-Specific
No stack-specific knowledge files needed based on detection.
`;
  }

  // Add evidence for transparency
  if (detectedStack.evidence.size > 0) {
    prompt += `
### Detection Evidence
`;
    for (const [stack, evidence] of detectedStack.evidence) {
      prompt += `- **${stack}**: ${evidence.slice(0, 3).join('; ')}${evidence.length > 3 ? ` (+${evidence.length - 3} more)` : ''}\n`;
    }
  }

  return prompt;
}

/**
 * Get a simple list of knowledge file paths to load
 */
export function getKnowledgeFilePaths(tieredResult: TieredKnowledgeResult): string[] {
  return tieredResult.all.map(f => f.path);
}
