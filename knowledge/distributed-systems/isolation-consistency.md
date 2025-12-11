# Database Isolation and Consistency Anomalies

This guide covers critical consistency anomalies that occur in distributed and concurrent database systems, focusing on isolation level violations that lead to data corruption. Understanding these patterns is essential for building reliable systems.

## Overview

Database isolation levels provide different guarantees about how concurrent transactions interact. Weaker isolation levels allow certain anomalies for better performance, while stronger levels prevent them at the cost of throughput and availability. The key anomalies include:

- **Lost Updates (P4)**: Overwriting committed changes
- **Write Skew (A5B)**: Violating constraints through disjoint writes
- **Read Skew (A5A)**: Observing inconsistent states

## Isolation Level Hierarchy

From weakest to strongest:
1. **Read Uncommitted** - Allows dirty reads
2. **Read Committed** - Allows lost updates, read/write skew
3. **Snapshot Isolation (SI)** - Allows write skew
4. **Repeatable Read** - Prevents most anomalies (implementation-dependent)
5. **Serializable** - Prevents all anomalies

---

## Lost Update (P4)

### Description

Lost Update occurs when one committed transaction's effects are overwritten by another transaction, causing the first transaction's changes to disappear entirely. This happens when two transactions read the same version of data, both modify it, and the second write overwrites the first without observing it.

### Bad Code Example

```sql
-- Transaction A
BEGIN;
SELECT counter FROM accounts WHERE id = 1;  -- reads: 12
-- Application increments to 13
UPDATE accounts SET counter = 13 WHERE id = 1;
COMMIT;

-- Transaction B (concurrent)
BEGIN;
SELECT counter FROM accounts WHERE id = 1;  -- reads: 12
-- Application increments to 13
UPDATE accounts SET counter = 13 WHERE id = 1;
COMMIT;

-- Final result: counter = 13 (should be 14, one update lost)
```

**Real-world scenario**: Two people at a party both see an empty dessert tray and add their dishes. The second person's addition overwrites the first, making the first contribution vanish.

### Good Code Example

```sql
-- Solution 1: Use SELECT FOR UPDATE to serialize access
BEGIN;
SELECT counter FROM accounts WHERE id = 1 FOR UPDATE;  -- acquires lock
-- Application increments value
UPDATE accounts SET counter = counter + 1 WHERE id = 1;
COMMIT;

-- Solution 2: Use atomic operations
UPDATE accounts SET counter = counter + 1 WHERE id = 1;

-- Solution 3: Use optimistic locking with version column
BEGIN;
SELECT counter, version FROM accounts WHERE id = 1;  -- reads: counter=12, version=5
UPDATE accounts
SET counter = 13, version = 6
WHERE id = 1 AND version = 5;  -- fails if version changed
-- Check affected rows; retry if 0
COMMIT;
```

### Key Takeaway

Lost updates are prevented by Snapshot Isolation and stronger levels. Use `SELECT FOR UPDATE` for explicit locking, atomic operations in SQL, or optimistic locking with version columns. Read Committed isolation allows this anomaly, making it unsuitable for scenarios requiring update tracking.

---

## Write Skew (A5B)

### Description

Write Skew occurs when two concurrent transactions read overlapping data but write to different objects, each failing to observe the other's write. This violates invariants that span multiple objects, producing outcomes impossible under serial execution. The technical signature is two consecutive read-write dependencies forming a cycle in the dependency graph.

### Bad Code Example

```sql
-- Business rule: At least one doctor must be on-call at all times
-- Initial state: doctors Alice and Bob are both on-call

-- Transaction A (Alice requests time off)
BEGIN TRANSACTION ISOLATION LEVEL SNAPSHOT;
SELECT COUNT(*) FROM doctors WHERE on_call = true;  -- sees: 2
-- Application logic: 2 > 1, so it's safe to go off-call
UPDATE doctors SET on_call = false WHERE name = 'Alice';
COMMIT;

-- Transaction B (Bob requests time off, concurrent)
BEGIN TRANSACTION ISOLATION LEVEL SNAPSHOT;
SELECT COUNT(*) FROM doctors WHERE on_call = true;  -- sees: 2
-- Application logic: 2 > 1, so it's safe to go off-call
UPDATE doctors SET on_call = false WHERE name = 'Bob';
COMMIT;

-- Final result: 0 doctors on-call, violating the invariant
```

**Real-world scenarios**:
- **Electrical panel**: Two electricians each verify capacity (160/200 amps used), install 30-amp circuits in different slots. Result: 220 amps, exceeding safe capacity.
- **Bank accounts**: Person has two accounts with $100 each, bank allows deficit if total ≥ 0. Two concurrent $200 withdrawals succeed, leaving total at -$200.
- **Meeting room booking**: Two transactions book the same room for overlapping times after checking availability.

### Good Code Example

```sql
-- Solution 1: Use SERIALIZABLE isolation
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT COUNT(*) FROM doctors WHERE on_call = true;
UPDATE doctors SET on_call = false WHERE name = 'Alice';
COMMIT;
-- One transaction will succeed; the other gets serialization error

-- Solution 2: Use SELECT FOR UPDATE to lock constraint-affecting rows
BEGIN;
SELECT COUNT(*) FROM doctors WHERE on_call = true FOR UPDATE;
-- This locks all on-call doctor rows
UPDATE doctors SET on_call = false WHERE name = 'Alice';
COMMIT;

-- Solution 3: Materialize the constraint
-- Create explicit constraint row
CREATE TABLE on_call_count (
    total INT NOT NULL CHECK (total >= 1)
);

BEGIN;
-- Lock the constraint row
SELECT total FROM on_call_count FOR UPDATE;
UPDATE doctors SET on_call = false WHERE name = 'Alice';
UPDATE on_call_count SET total = total - 1;
COMMIT;

-- Solution 4: Application-level conflict detection
BEGIN;
SELECT COUNT(*) as count FROM doctors WHERE on_call = true;
UPDATE doctors SET on_call = false WHERE name = 'Alice';
-- Re-check constraint before commit
SELECT COUNT(*) FROM doctors WHERE on_call = true;
-- If count < 1, ROLLBACK
COMMIT;
```

### Key Takeaway

Write skew is allowed by Snapshot Isolation but prevented by Serializable isolation. It's characterized by a specific pattern: concurrent transactions with read-write dependencies forming a cycle. Solutions include upgrading to SERIALIZABLE, using `SELECT FOR UPDATE` on constraint-affecting rows, materializing constraints as explicit database rows, or implementing application-level validation before commit. PostgreSQL and CockroachDB implement Serializable Snapshot Isolation (SSI) that detects these cycles automatically.

---

## Read Skew (A5A)

### Description

Read Skew occurs when a transaction observes an inconsistent state by both seeing and not seeing the effects of another concurrent transaction. The transaction reads one value before another transaction commits changes to multiple related objects, then reads a second value after the commit, resulting in a view that never existed atomically.

### Bad Code Example

```sql
-- Business rule: Post and PostDetails must stay synchronized

-- Initial state: post.title = "Hello", post_details.views = 100

-- Transaction A (reads inconsistent state)
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT title FROM posts WHERE id = 1;  -- reads: "Hello"

    -- Transaction B (updates both records)
    BEGIN;
    UPDATE posts SET title = "Hello World" WHERE id = 1;
    UPDATE post_details SET views = 200 WHERE post_id = 1;
    COMMIT;

SELECT views FROM post_details WHERE post_id = 1;  -- reads: 200
COMMIT;

-- Transaction A observed: title="Hello" + views=200
-- This state never existed atomically
```

**Real-world scenario**: A queen changes her shoes from stilettos to pumps behind a curtain. Her mother glimpses a stiletto on the left foot, then sees a pump on the right foot after the change completes. The mother observes an inconsistent state that never truly existed.

### Good Code Example

```sql
-- Solution 1: Use REPEATABLE READ or SNAPSHOT isolation
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
SELECT title FROM posts WHERE id = 1;
SELECT views FROM post_details WHERE post_id = 1;
-- Both reads see the same consistent snapshot
COMMIT;

-- Solution 2: Use explicit locking
BEGIN;
SELECT title FROM posts WHERE id = 1 FOR SHARE;
SELECT views FROM post_details WHERE post_id = 1 FOR SHARE;
-- Locks prevent other transactions from modifying during read
COMMIT;

-- Solution 3: Read all related data in one query
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT p.title, pd.views
FROM posts p
JOIN post_details pd ON p.id = pd.post_id
WHERE p.id = 1;
-- Single query sees consistent state at one point in time
COMMIT;
```

### Key Takeaway

Read Skew is allowed by Read Committed but prevented by Snapshot Isolation and stronger levels. It primarily affects read-only transactions or queries that span multiple statements. Use Repeatable Read or Snapshot Isolation for consistent reads across multiple queries, or consolidate related reads into single SQL statements. Read Skew is less dangerous than Write Skew but can cause application logic errors when business rules assume consistency across related objects.

---

## Quick Reference: Anomaly Prevention Matrix

| Anomaly | Read Committed | Snapshot Isolation | Repeatable Read | Serializable |
|---------|----------------|-------------------|-----------------|--------------|
| Lost Update (P4) | ❌ Allowed | ✅ Prevented | ✅ Prevented* | ✅ Prevented |
| Read Skew (A5A) | ❌ Allowed | ✅ Prevented | ✅ Prevented | ✅ Prevented |
| Write Skew (A5B) | ❌ Allowed | ❌ Allowed | ❌ Allowed** | ✅ Prevented |

*Many Repeatable Read implementations actually allow lost updates
**Most Repeatable Read implementations allow write skew; only true Serializable prevents it

---

## Implementation Notes by Database

### PostgreSQL
- Default: Read Committed
- `REPEATABLE READ` provides Snapshot Isolation (allows write skew)
- `SERIALIZABLE` provides true Serializable Snapshot Isolation (SSI) that prevents write skew
- SSI tracks read-write dependencies and aborts transactions forming cycles
- Error message: `could not serialize access due to read/write dependencies among transactions`

### CockroachDB
- Default: Serializable (strongest guarantee)
- Also supports `READ COMMITTED` (allows write skew, minimizes retries)
- `SNAPSHOT` isolation available (allows write skew)
- Uses MVCC with automatic retry on serialization errors
- First-committer-wins prevents lost updates

### MySQL/InnoDB
- Default: Repeatable Read
- Uses gap locking and next-key locking
- `REPEATABLE READ` prevents many anomalies but not all write skew scenarios
- `SERIALIZABLE` uses lock-based approach rather than MVCC

---

## Detection and Prevention Strategies

### 1. Choose Appropriate Isolation Level
- Use `SERIALIZABLE` for critical financial transactions, inventory management, and constraint enforcement
- Use `SNAPSHOT`/`REPEATABLE READ` for read-heavy workloads requiring consistency
- Use `READ COMMITTED` only for workloads tolerant of anomalies

### 2. Explicit Locking
```sql
-- FOR UPDATE: exclusive lock for writes
SELECT * FROM table WHERE id = 1 FOR UPDATE;

-- FOR SHARE: shared lock for reads
SELECT * FROM table WHERE id = 1 FOR SHARE;
```

### 3. Optimistic Concurrency Control
```sql
-- Version-based optimistic locking
UPDATE table
SET value = 'new', version = version + 1
WHERE id = 1 AND version = 5;
-- Retry if affected rows = 0
```

### 4. Materialize Constraints
```sql
-- Instead of checking COUNT(*), maintain explicit counter
CREATE TABLE constraint_tracker (
    constraint_name TEXT PRIMARY KEY,
    count INT NOT NULL
);

-- Lock and update the counter
UPDATE constraint_tracker
SET count = count - 1
WHERE constraint_name = 'on_call_doctors' AND count > 1;
```

### 5. Application-Level Validation
- Implement retry logic for serialization errors
- Re-validate invariants before commit
- Use idempotent operations when possible

---

## Testing for Anomalies

### Jepsen Framework Approach
The Jepsen testing framework detects anomalies by:
1. Recording all operations with wall-clock timestamps
2. Building dependency graphs (write-read, write-write, read-write)
3. Searching for cycles indicating serialization violations
4. Classifying anomalies by their dependency patterns

### Manual Testing Strategy
```sql
-- Test for lost updates
-- Run two concurrent transactions incrementing the same counter
-- Expected: counter += 2, Actual with bug: counter += 1

-- Test for write skew
-- Run two concurrent transactions violating a cross-object constraint
-- Expected: one transaction aborts, Actual with bug: both commit

-- Test for read skew
-- Read related objects before and after concurrent update
-- Expected: consistent snapshot, Actual with bug: mixed old/new values
```

---

## Summary

**Lost Update (P4)**: Use `SELECT FOR UPDATE`, atomic operations, or optimistic locking to prevent overwrites.

**Write Skew (A5B)**: Use `SERIALIZABLE` isolation or materialize constraints as explicit lockable rows. Most dangerous for multi-object invariants.

**Read Skew (A5A)**: Use `SNAPSHOT`/`REPEATABLE READ` isolation for consistent multi-query reads within transactions.

When in doubt, choose `SERIALIZABLE` isolation for correctness, then optimize if performance becomes an issue. Most production bugs stem from incorrect isolation level assumptions rather than database bugs.
