# Knowledge Base - Distributed Systems & Database Anti-Patterns

This knowledge base contains patterns and anti-patterns for LLM one-shot training, organized by category.

## Structure

```
knowledge/
├── distributed-systems/
│   ├── race-conditions.md          (843 lines) - Race conditions, write skew, check-then-act
│   ├── isolation-consistency.md    (343 lines) - Lost updates, write skew, read skew
│   ├── time-clocks.md              (1146 lines) - Clock drift, timestamps, timeouts
│   ├── retries-resilience.md       (724 lines) - Retry storms, thundering herd, backoff
│   ├── idempotency.md              (656 lines) - Duplicate effects, idempotency keys
│   ├── partial-failures.md         (1021 lines) - Network partitions, split brain
│   ├── consensus-coordination.md   (852 lines) - Raft, Paxos, leader election bugs
│   ├── replication-storage.md      (1513 lines) - Multi-leader, CRDTs, eventual consistency
│   └── messaging-queues.md         (1199 lines) - Message ordering, delivery guarantees
│
└── database/
    ├── connection-pools.md         (573 lines) - Pool leaks, sizing, lifecycle
    ├── sql-antipatterns.md         (1277 lines) - N+1, indexes, query optimization
    └── schema-design.md            (514 lines) - God tables, EAV, normalization

Total: 12 files, 10,661 lines
```

## Pattern Categories

### Distributed Systems (9 files)

| File | Key Patterns |
|------|-------------|
| `race-conditions.md` | Write Skew, UPSERT races, Lost Update, Check-Then-Act, Read-Modify-Write |
| `isolation-consistency.md` | Lost Update (P4), Write Skew (A5B), Read Skew (A5A), Snapshot Isolation |
| `time-clocks.md` | Wall Clock Reliance, Clock Skew, NTP Assumptions, Timeout Expiration |
| `retries-resilience.md` | Retry Storm, Thundering Herd, Exponential Backoff, Circuit Breaker |
| `idempotency.md` | Non-Idempotent Mutations, Double Processing, Missing Backoff, Response Caching |
| `partial-failures.md` | Split-Brain, Asymmetric Failures, Unsafe Locking, Saga Pattern |
| `consensus-coordination.md` | Split-Brain, Missing fsync, Term Persistence Bug, Dueling Proposers |
| `replication-storage.md` | Last-Write-Wins, Read-After-Write, CRDT Overhead, Replication Lag |
| `messaging-queues.md` | Message Ordering, Visibility Timeout, Dead Letter Queues, Idempotent Handlers |

### Database (3 files)

| File | Key Patterns |
|------|-------------|
| `connection-pools.md` | Connection Leak, Pool Sizing, Transaction Handling, Leak Detection |
| `sql-antipatterns.md` | N+1 Queries, Missing Indexes, Over-Indexing, SELECT *, Type Conversion |
| `schema-design.md` | God Table, Missing PK, Over-Normalization, EAV Pattern, Polymorphic Associations |

## Usage for LLM Training

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

## Code Languages Covered

- **Python** - Most examples
- **Java** - Connection pools, concurrency
- **Go** - Connection pools, concurrency
- **JavaScript/TypeScript** - API patterns
- **SQL** - Database anti-patterns
- **Rust** - Message passing, ownership
- **C#** - Retry patterns

## Sources

Content extracted from 70+ authoritative sources including:
- Jepsen.io (consistency models)
- Martin Kleppmann's blog and lectures
- AWS Builders Library
- CockroachDB documentation
- Stripe Engineering Blog
- Azure Architecture patterns
- LMAX Disruptor whitepaper
- Stack Overflow canonical answers
