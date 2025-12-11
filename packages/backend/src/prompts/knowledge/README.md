# Knowledge Base - Code Analysis Anti-Patterns

This knowledge base contains patterns and anti-patterns for LLM-powered code analysis, organized by category.

## Multi-Agent Architecture

The analysis system uses **specialized sub-agents** to prevent context pollution between domains:

```
                    ┌─────────────────────────────────────┐
                    │         ORCHESTRATOR                │
                    │   (detects stack, spawns agents)    │
                    └─────────────────┬───────────────────┘
                                      │
          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   TIER 1        │        │   TIER 1        │        │   TIER 1        │
│   (Always)      │        │   (Always)      │        │   (Always)      │
├─────────────────┤        ├─────────────────┤        ├─────────────────┤
│ Security        │        │ Resilience      │        │ Concurrency     │
│ Auditor         │        │ Auditor         │        │ Auditor         │
│                 │        │                 │        │                 │
│ - security.md   │        │ - error-        │        │ - concurrency-  │
│                 │        │   handling.md   │        │   bugs.md       │
│                 │        │ - retries-      │        │ - race-         │
│                 │        │   resilience.md │        │   conditions.md │
│                 │        │ - partial-      │        │ - antithesis-   │
│                 │        │   failures.md   │        │   glossary.md   │
└─────────────────┘        └─────────────────┘        └─────────────────┘
          │                           │                           │
          ▼                           ▼                           ▼
  security-report.json     resilience-report.json    concurrency-report.json


          ┌───────────────────────────┼───────────────────────────┐
          │                           │                           │
          ▼                           ▼                           ▼
┌─────────────────┐        ┌─────────────────┐        ┌─────────────────┐
│   TIER 2        │        │   TIER 2        │        │   TIER 2        │
│   (Stack-based) │        │   (Stack-based) │        │   (Stack-based) │
├─────────────────┤        ├─────────────────┤        ├─────────────────┤
│ Kafka           │        │ Database        │        │ Distributed     │
│ Specialist      │        │ Specialist      │        │ Systems         │
│                 │        │                 │        │                 │
│ - 12 kafka/*.md │        │ - connection-   │        │ - time-clocks   │
│   files         │        │   pools.md      │        │ - idempotency   │
│                 │        │ - sql-anti.md   │        │ - consensus     │
│                 │        │ - schema.md     │        │ - replication   │
│                 │        │ - isolation.md  │        │ - messaging     │
└─────────────────┘        └─────────────────┘        └─────────────────┘
          │                           │                           │
          ▼                           ▼                           ▼
  kafka-report.json        database-report.json      distributed-report.json
```

### Why Multi-Agent?

- **No Context Pollution**: Kafka knowledge doesn't interfere with SQL analysis
- **Focused Expertise**: Each agent is a domain specialist
- **Parallel Execution**: All agents run simultaneously
- **Isolated Output**: Each agent writes its own report

## Structure

```
knowledge/
├── security.md                      (top-level security patterns)
├── reliability.md                   (general reliability patterns)
├── error-handling.md                (swallowed exceptions, resource leaks)
├── concurrency-bugs.md              (deadlocks, race conditions)
├── antithesis-glossary.md           (formal anomaly codes P0-P4)
│
├── kafka/                           (12 files, 17,115 lines)
│   ├── consumer-antipatterns.md     - Poll loop, rebalance, commit timing
│   ├── producer-antipatterns.md     - Acks, idempotence, batching
│   ├── topics-partitions-antipatterns.md
│   ├── offset-commit-antipatterns.md
│   ├── dlq-antipatterns.md          - Dead letter queue patterns
│   ├── streams-antipatterns.md      - Repartitioning, state stores
│   ├── connect-antipatterns.md      - JDBC, SMT, error tolerance
│   ├── schema-registry-antipatterns.md
│   ├── retry-resilience-antipatterns.md
│   ├── monitoring-antipatterns.md   - Consumer lag, ISR, JMX
│   ├── cluster-dr-antipatterns.md   - MirrorMaker2, failover
│   └── ordering-scalability-antipatterns.md
│
├── distributed-systems/             (9 files)
│   ├── race-conditions.md           - Write skew, check-then-act
│   ├── isolation-consistency.md     - Lost updates, read skew
│   ├── time-clocks.md               - Clock drift, timestamps
│   ├── retries-resilience.md        - Retry storms, backoff
│   ├── idempotency.md               - Duplicate effects
│   ├── partial-failures.md          - Network partitions, split brain
│   ├── consensus-coordination.md    - Raft, Paxos, leader election
│   ├── replication-storage.md       - Multi-leader, CRDTs
│   └── messaging-queues.md          - Message ordering, delivery
│
└── database/                        (3 files)
    ├── connection-pools.md          - Pool leaks, sizing
    ├── sql-antipatterns.md          - N+1, indexes, SELECT *
    └── schema-design.md             - God tables, EAV

Total: ~28 files, ~28,000 lines
```

## Agent Configuration

| Agent | Tier | Activates When | Knowledge Files | Token Estimate |
|-------|------|----------------|-----------------|----------------|
| Security Auditor | Always | All repos | 1 | ~4,000 |
| Resilience Auditor | Always | All repos | 3 | ~14,000 |
| Concurrency Auditor | Always | All repos | 3 | ~18,000 |
| Kafka Specialist | Stack-based | Kafka imports detected | 12 | ~62,000 |
| Database Specialist | Stack-based | SQL/ORM detected | 4 | ~13,000 |
| Distributed Systems | Stack-based | Distributed patterns | 5 | ~16,000 |

## Stack Detection

The system automatically detects the tech stack by scanning:

### Kafka Detection
- File patterns: `**/kafka/**/*`, `**/confluent/**/*`
- Imports: `kafkajs`, `org.apache.kafka`, `confluent_kafka`
- Code patterns: `KafkaProducer`, `commitSync`, `consumer.poll`

### Database Detection
- File patterns: `**/migrations/**/*`, `**/db/**/*`
- Imports: `psycopg2`, `sqlalchemy`, `drizzle-orm`, `prisma`
- Code patterns: `SELECT`, `INSERT`, `JOIN`, `getConnection`

### Distributed Systems Detection
- Imports: `raft`, `paxos`, `zookeeper`, `etcd`
- Code patterns: `acquire_lock`, `leader_election`, `System.currentTimeMillis`

## Pattern Format

Each file follows a consistent structure for one-shot training:

```markdown
## Pattern: [Name]

**Description:** 1-2 sentences explaining the anti-pattern

**Bad Code Example:**
```language
// Code showing the problem with inline comments
```

**Good Code Example:**
```language
// Correct implementation with best practices
```

**Key Takeaway:** Actionable summary
```

## Languages Covered

- **Python** - Most examples
- **Java** - Kafka, connection pools, concurrency
- **Go** - Connection pools, concurrency
- **JavaScript/TypeScript** - API patterns, Node.js Kafka
- **SQL** - Database anti-patterns
- **Scala** - Kafka Streams
- **Rust** - Message passing

## Planned Features

- **Database Query Plan Analysis**: Query `EXPLAIN ANALYZE` from the database and feed the execution plan to the LLM alongside the code for deeper performance insights

## Sources

Content extracted from 130+ authoritative sources including:
- Jepsen.io (consistency models)
- Martin Kleppmann's blog and lectures
- AWS Builders Library
- Confluent documentation and blogs
- Apache Kafka KIPs
- CockroachDB documentation
- Stripe Engineering Blog
- Azure Architecture patterns
