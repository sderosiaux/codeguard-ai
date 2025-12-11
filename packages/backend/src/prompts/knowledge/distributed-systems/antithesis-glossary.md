# Antithesis Distributed Systems Glossary

A comprehensive reference for consistency models, anomalies, fault types, and distributed systems principles.

---

## 1. Consistency Models

### Linearizability (Strictest)

**Definition:** Every operation appears to execute atomically at some point between invocation and response. All operations have a total order consistent with real-time ordering.

**Violation Symptom:** Operations complete in an order that contradicts wall-clock time, or concurrent reads see different values after a write completes.

**Bad Example (Java):**
```java
// Thread 1
cache.write("x", 1);
System.out.println("Write completed at " + System.currentTimeMillis());

// Thread 2 (starts AFTER Thread 1's write completes)
int value = cache.read("x"); // Returns 0 instead of 1
// VIOLATION: Read doesn't see completed write
```

**Good Example (Java):**
```java
// Using linearizable storage (e.g., etcd, ZooKeeper)
public class LinearizableCache {
    private final EtcdClient etcd;

    public void write(String key, int value) {
        // Blocks until write is acknowledged by quorum
        etcd.put(key, String.valueOf(value)).get();
    }

    public int read(String key) {
        // Always reads from quorum to get latest value
        return Integer.parseInt(etcd.get(key).get().getValue());
    }
}
```

**Key Takeaway:** Linearizability provides the strongest consistency but requires coordination on every operation, impacting performance.

---

### Serializability

**Definition:** Transactions execute as if they occurred in some sequential order. The result is equivalent to some serial execution of transactions.

**Violation Symptom:** Concurrent transactions produce results impossible under any serial execution order.

**Bad Example (SQL):**
```sql
-- Initial state: accounts table with Alice=$100, Bob=$100

-- Transaction T1 (transfer $50 from Alice to Bob)
BEGIN;
SELECT balance FROM accounts WHERE name='Alice'; -- Reads $100
-- ... delay ...
UPDATE accounts SET balance=50 WHERE name='Alice';
UPDATE accounts SET balance=150 WHERE name='Bob';
COMMIT;

-- Transaction T2 (concurrent, transfer $50 from Bob to Alice)
BEGIN;
SELECT balance FROM accounts WHERE name='Bob'; -- Reads $100
-- ... delay ...
UPDATE accounts SET balance=50 WHERE name='Bob';
UPDATE accounts SET balance=150 WHERE name='Alice';
COMMIT;

-- Final state: Alice=$150, Bob=$150 (created $100!)
-- VIOLATION: Not equivalent to any serial execution
```

**Good Example (SQL):**
```sql
-- Using SERIALIZABLE isolation level
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT balance FROM accounts WHERE name='Alice' FOR UPDATE;
SELECT balance FROM accounts WHERE name='Bob' FOR UPDATE;
-- Locks prevent interleaving
UPDATE accounts SET balance = balance - 50 WHERE name='Alice';
UPDATE accounts SET balance = balance + 50 WHERE name='Bob';
COMMIT;
```

**Key Takeaway:** Serializability ensures transaction isolation but doesn't guarantee real-time ordering like linearizability.

---

### Snapshot Isolation

**Definition:** Each transaction reads from a consistent snapshot of the database taken at transaction start. Writes are visible only after commit.

**Violation Symptom:** Write skew anomalies where two transactions read the same snapshot and make conflicting decisions.

**Bad Example (Python):**
```python
# Constraint: At least one doctor must be on call

# Transaction T1 (Dr. Alice going off-call)
def alice_off_call(db):
    doctors = db.query("SELECT * FROM on_call WHERE on_call=true")
    if len(doctors) > 1:  # Sees both Alice and Bob
        db.execute("UPDATE on_call SET on_call=false WHERE name='Alice'")
        db.commit()

# Transaction T2 (Dr. Bob going off-call, same snapshot)
def bob_off_call(db):
    doctors = db.query("SELECT * FROM on_call WHERE on_call=true")
    if len(doctors) > 1:  # Also sees both Alice and Bob
        db.execute("UPDATE on_call SET on_call=false WHERE name='Bob'")
        db.commit()

# Result: Both doctors off-call, constraint violated!
```

**Good Example (Python):**
```python
# Using SELECT FOR UPDATE to prevent write skew
def go_off_call(db, doctor_name):
    db.begin()
    try:
        # Lock all rows being checked
        doctors = db.query(
            "SELECT * FROM on_call WHERE on_call=true FOR UPDATE"
        )
        if len(doctors) > 1:
            db.execute(
                "UPDATE on_call SET on_call=false WHERE name=?",
                (doctor_name,)
            )
            db.commit()
        else:
            db.rollback()
            raise Exception("Cannot go off-call, you're the last doctor")
    except:
        db.rollback()
        raise
```

**Key Takeaway:** Snapshot isolation prevents many anomalies but allows write skew. Use explicit locking for constraints spanning multiple objects.

---

### Read Your Writes

**Definition:** After a client writes a value, subsequent reads by that same client always see that write or a later value.

**Violation Symptom:** Client writes data but immediately reads back old/missing data.

**Bad Example (Python):**
```python
# User updates profile
def update_profile(user_id, data):
    database.write_to_replica(user_id, data)
    return "Profile updated"

# User immediately views profile (routes to different replica)
def view_profile(user_id):
    return database.read_from_random_replica(user_id)
    # VIOLATION: May read from replica that hasn't received the write yet

# User sees old profile photo after upload!
```

**Good Example (Python):**
```python
class SessionAwareDB:
    def __init__(self):
        self.last_write_timestamp = {}

    def write(self, user_id, data):
        timestamp = self.primary.write(user_id, data)
        self.last_write_timestamp[user_id] = timestamp
        return timestamp

    def read(self, user_id):
        # Read from replica that has caught up to user's last write
        required_timestamp = self.last_write_timestamp.get(user_id, 0)

        for replica in self.replicas:
            if replica.get_replication_lag() >= required_timestamp:
                return replica.read(user_id)

        # Fallback to primary if replicas too far behind
        return self.primary.read(user_id)
```

**Key Takeaway:** Implement sticky sessions or track write timestamps to ensure users see their own writes.

---

### Monotonic Reads

**Definition:** If a client reads a value, subsequent reads will never return an older value.

**Violation Symptom:** Later reads return older data than earlier reads (time appears to go backwards).

**Bad Example (Go):**
```go
// Reading from random replicas with different lag
func ViewMessages(userID string) []Message {
    replica := selectRandomReplica()
    return replica.GetMessages(userID)
}

// First read (hits replica1, lag=0s): sees messages 1,2,3
messages1 := ViewMessages("user123")

// Second read (hits replica2, lag=5s): sees messages 1,2
messages2 := ViewMessages("user123")
// VIOLATION: Message 3 disappeared!
```

**Good Example (Go):**
```go
type Session struct {
    userID           string
    lastReadVersion  int64
    stickyReplicaID  string
}

func (s *Session) ViewMessages() []Message {
    // Always read from same replica or one ahead
    replica := getReplicaByID(s.stickyReplicaID)

    messages, version := replica.GetMessagesWithVersion(s.userID)

    // Ensure we're not going backwards
    if version < s.lastReadVersion {
        // Switch to more up-to-date replica
        replica = getMostCurrentReplica()
        messages, version = replica.GetMessagesWithVersion(s.userID)
    }

    s.lastReadVersion = version
    return messages
}
```

**Key Takeaway:** Use sticky sessions or version tracking to prevent reads from going backwards in time.

---

### Causal Consistency

**Definition:** Operations that are causally related are seen in the same order by all processes. Concurrent operations may be seen in different orders.

**Violation Symptom:** Effects are visible before their causes (e.g., seeing a reply before the original message).

**Bad Example (Java):**
```java
// Message board with replication

// User A posts question
messageBoard.post("How do I fix bug X?");  // Replicates slowly

// User B sees question and replies (on faster replica)
messageBoard.post("Try solution Y!");  // Replicates quickly

// User C views board (on third replica)
List<Message> messages = messageBoard.getAllMessages();
// Sees: ["Try solution Y!"]
// VIOLATION: Reply visible but not the question!
```

**Good Example (Java):**
```java
public class CausalMessageBoard {
    private VectorClock clock;

    public void post(String content, VectorClock dependencies) {
        Message msg = new Message(content, dependencies);
        msg.timestamp = clock.increment();
        storage.write(msg);
    }

    public List<Message> getAllMessages() {
        List<Message> all = storage.readAll();

        // Only return messages whose dependencies are satisfied
        List<Message> visible = new ArrayList<>();
        for (Message msg : all) {
            if (allDependenciesSatisfied(msg.dependencies, all)) {
                visible.add(msg);
            }
        }

        return sortByCausalOrder(visible);
    }

    private boolean allDependenciesSatisfied(
        VectorClock deps,
        List<Message> available
    ) {
        // Check that all causally prior messages are present
        for (Message msg : available) {
            if (deps.happensBefore(msg.timestamp)) {
                return true;
            }
        }
        return deps.isInitial();
    }
}
```

**Key Takeaway:** Track causal dependencies using vector clocks or version vectors to prevent causality violations.

---

### Eventual Consistency (Weakest)

**Definition:** If no new updates are made, eventually all replicas will converge to the same value.

**Violation Symptom:** Indefinite divergence; replicas never converge even without new writes.

**Bad Example (Python):**
```python
# Simple last-write-wins without conflict resolution
class EventualCache:
    def __init__(self):
        self.data = {}

    def write(self, key, value):
        self.data[key] = value
        self.replicate_async(key, value)

    def replicate_async(self, key, value):
        # Network partition causes message loss
        # No retry, no acknowledgment
        try:
            for replica in self.replicas:
                replica.update(key, value)  # May fail silently
        except:
            pass  # Swallowed error

# With concurrent writes and message loss:
# Replica1: x=5
# Replica2: x=7
# Replica3: x=5
# VIOLATION: Replicas never converge
```

**Good Example (Python):**
```python
from datetime import datetime

class ConvergentCache:
    def __init__(self, node_id):
        self.node_id = node_id
        self.data = {}  # key -> (value, timestamp, writer_id)

    def write(self, key, value):
        timestamp = datetime.now().timestamp()
        version = (value, timestamp, self.node_id)
        self.data[key] = version
        self.replicate_with_retry(key, version)

    def merge(self, key, incoming_version):
        """Conflict-free merge using last-write-wins with tie-breaker"""
        if key not in self.data:
            self.data[key] = incoming_version
            return

        local = self.data[key]
        incoming = incoming_version

        # Compare timestamps
        if incoming[1] > local[1]:
            self.data[key] = incoming
        elif incoming[1] == local[1]:
            # Tie-breaker: higher node_id wins
            if incoming[2] > local[2]:
                self.data[key] = incoming

    def replicate_with_retry(self, key, version):
        for replica in self.replicas:
            # Keep retrying until acknowledged
            while not replica.merge_with_ack(key, version):
                time.sleep(0.1)

    def read(self, key):
        # Return current value (may be stale)
        return self.data.get(key, (None, 0, ''))[0]
```

**Key Takeaway:** Eventual consistency requires conflict resolution strategies (LWW, CRDTs) and retry mechanisms to guarantee convergence.

---

## 2. Phenomena (Anomaly Codes)

### Write Anomalies

#### P0: Dirty Write

**Definition:** A transaction overwrites another transaction's uncommitted write.

**Bad Example (SQL):**
```sql
-- Initial: x=0, y=0

-- Transaction T1
BEGIN;
UPDATE data SET value=1 WHERE key='x';
-- ... delay ...
UPDATE data SET value=1 WHERE key='y';
COMMIT;

-- Transaction T2 (concurrent)
BEGIN;
UPDATE data SET value=2 WHERE key='x';  -- Overwrites T1's uncommitted write!
UPDATE data SET value=2 WHERE key='y';
COMMIT;

-- If T1 commits after T2: x=1, y=1 (T2's write to x was lost)
-- VIOLATION: Partial overwrite, inconsistent state
```

**Good Example (SQL):**
```sql
-- Using proper locking (READ COMMITTED prevents P0)
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
UPDATE data SET value=1 WHERE key='x';  -- Blocks until T2's lock released
UPDATE data SET value=1 WHERE key='y';
COMMIT;
```

**Key Takeaway:** Even the weakest isolation levels (READ UNCOMMITTED excluded) prevent dirty writes through locking.

---

#### P4: Lost Update

**Definition:** Two transactions read the same value, modify it, and write it back. One write silently overwrites the other.

**Bad Example (Python):**
```python
# Incrementing a counter without protection
def increment_counter(db, counter_id):
    # Read
    current = db.execute(
        "SELECT value FROM counters WHERE id=?",
        (counter_id,)
    ).fetchone()[0]

    # Modify
    new_value = current + 1

    # Write (another transaction may have updated in between!)
    db.execute(
        "UPDATE counters SET value=? WHERE id=?",
        (new_value, counter_id)
    )
    db.commit()

# Two concurrent calls:
# T1 reads 5, T2 reads 5
# T1 writes 6, T2 writes 6
# Result: 6 (should be 7)
# VIOLATION: Lost update
```

**Good Example (Python):**
```python
# Solution 1: Atomic increment
def increment_counter_atomic(db, counter_id):
    db.execute(
        "UPDATE counters SET value = value + 1 WHERE id=?",
        (counter_id,)
    )
    db.commit()

# Solution 2: Compare-and-swap
def increment_counter_cas(db, counter_id):
    while True:
        current, version = db.execute(
            "SELECT value, version FROM counters WHERE id=?",
            (counter_id,)
        ).fetchone()

        new_value = current + 1

        rows_affected = db.execute(
            """UPDATE counters
               SET value=?, version=version+1
               WHERE id=? AND version=?""",
            (new_value, counter_id, version)
        ).rowcount

        if rows_affected > 0:
            db.commit()
            break
        else:
            # Version changed, retry
            db.rollback()

# Solution 3: Explicit locking
def increment_counter_locked(db, counter_id):
    db.execute("BEGIN")
    current = db.execute(
        "SELECT value FROM counters WHERE id=? FOR UPDATE",
        (counter_id,)
    ).fetchone()[0]

    db.execute(
        "UPDATE counters SET value=? WHERE id=?",
        (current + 1, counter_id)
    )
    db.commit()
```

**Key Takeaway:** Use atomic operations, compare-and-swap, or explicit locking to prevent lost updates.

---

#### G0: Write Cycle

**Definition:** Circular write-write dependencies between transactions create an impossible-to-serialize cycle.

**Bad Example (SQL):**
```sql
-- Transaction T1
BEGIN;
UPDATE accounts SET balance=balance-100 WHERE id=1;
-- ... delay ...
UPDATE accounts SET balance=balance+100 WHERE id=2;
COMMIT;

-- Transaction T2 (concurrent)
BEGIN;
UPDATE accounts SET balance=balance-50 WHERE id=2;
-- ... delay ...
UPDATE accounts SET balance=balance+50 WHERE id=1;
COMMIT;

-- Dependency cycle: T1 writes id=1, T2 reads/writes id=1
--                    T2 writes id=2, T1 reads/writes id=2
-- VIOLATION: No valid serialization order
```

**Good Example (SQL):**
```sql
-- Solution: Acquire locks in consistent order
BEGIN;
-- Always lock lower ID first
SELECT balance FROM accounts WHERE id=1 FOR UPDATE;
SELECT balance FROM accounts WHERE id=2 FOR UPDATE;

-- Now safe to update in any order
UPDATE accounts SET balance=balance-100 WHERE id=1;
UPDATE accounts SET balance=balance+100 WHERE id=2;
COMMIT;
```

**Key Takeaway:** Prevent cycles by acquiring locks in a consistent global order (e.g., sorted by ID).

---

### Read Anomalies

#### P1: Dirty Read

**Definition:** A transaction reads data written by another transaction that hasn't committed yet.

**Bad Example (Java):**
```java
// Transaction T1
void transferMoney(Connection conn) throws SQLException {
    conn.setAutoCommit(false);
    conn.setTransactionIsolation(Connection.TRANSACTION_READ_UNCOMMITTED);

    stmt.execute("UPDATE accounts SET balance=balance-1000 WHERE id=1");
    // ... long computation ...
    stmt.execute("UPDATE accounts SET balance=balance+1000 WHERE id=2");
    conn.commit();
}

// Transaction T2 (concurrent)
void calculateTotalBalance(Connection conn) throws SQLException {
    conn.setAutoCommit(false);
    conn.setTransactionIsolation(Connection.TRANSACTION_READ_UNCOMMITTED);

    // Reads T1's uncommitted update!
    ResultSet rs = stmt.executeQuery(
        "SELECT SUM(balance) FROM accounts WHERE id IN (1,2)"
    );
    // VIOLATION: Sees inconsistent state (money deducted but not added)
    // If T1 rolls back, T2 read data that "never existed"
}
```

**Good Example (Java):**
```java
void calculateTotalBalance(Connection conn) throws SQLException {
    conn.setAutoCommit(false);
    // READ COMMITTED or higher prevents dirty reads
    conn.setTransactionIsolation(Connection.TRANSACTION_READ_COMMITTED);

    ResultSet rs = stmt.executeQuery(
        "SELECT SUM(balance) FROM accounts WHERE id IN (1,2)"
    );
    // Only sees committed data
}
```

**Key Takeaway:** Use READ COMMITTED or stronger isolation to prevent reading uncommitted data.

---

#### P2: Non-Repeatable Read

**Definition:** A transaction reads the same row twice and gets different values because another transaction modified and committed between the reads.

**Bad Example (Go):**
```go
func ProcessOrder(db *sql.DB, orderID int) error {
    tx, _ := db.Begin()

    // First read
    var price float64
    tx.QueryRow("SELECT price FROM products WHERE id=?", orderID).
        Scan(&price)

    // Business logic...
    time.Sleep(100 * time.Millisecond)

    // Another transaction updates price here

    // Second read
    var price2 float64
    tx.QueryRow("SELECT price FROM products WHERE id=?", orderID).
        Scan(&price2)

    if price != price2 {
        // VIOLATION: Same query, different result!
        return errors.New("price changed during transaction")
    }

    tx.Commit()
    return nil
}
```

**Good Example (Go):**
```go
func ProcessOrder(db *sql.DB, orderID int) error {
    // Use REPEATABLE READ isolation level
    tx, _ := db.BeginTx(context.Background(), &sql.TxOptions{
        Isolation: sql.LevelRepeatableRead,
    })

    // First read
    var price float64
    tx.QueryRow("SELECT price FROM products WHERE id=?", orderID).
        Scan(&price)

    // Business logic...
    time.Sleep(100 * time.Millisecond)

    // Second read - guaranteed to return same value
    var price2 float64
    tx.QueryRow("SELECT price FROM products WHERE id=?", orderID).
        Scan(&price2)

    // price == price2 is guaranteed

    tx.Commit()
    return nil
}
```

**Key Takeaway:** Use REPEATABLE READ or SERIALIZABLE isolation when you need consistent reads within a transaction.

---

#### P3: Phantom

**Definition:** A transaction re-executes a query and finds a different set of rows because another transaction inserted/deleted rows.

**Bad Example (Python):**
```python
def allocate_room(db):
    db.execute("BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED")

    # Find available rooms
    available = db.execute(
        "SELECT id FROM rooms WHERE occupied=false"
    ).fetchall()

    # Business logic...
    time.sleep(0.1)

    # Another transaction books a room here

    # Check again
    still_available = db.execute(
        "SELECT id FROM rooms WHERE occupied=false"
    ).fetchall()

    # VIOLATION: Set of rows changed (phantom rows)
    if len(available) != len(still_available):
        print("Phantom detected!")

    db.execute("COMMIT")
```

**Good Example (Python):**
```python
def allocate_room(db):
    db.execute("BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE")

    # Find and lock available rooms
    available = db.execute(
        "SELECT id FROM rooms WHERE occupied=false FOR UPDATE"
    ).fetchall()

    if available:
        room_id = available[0][0]
        db.execute(
            "UPDATE rooms SET occupied=true WHERE id=?",
            (room_id,)
        )

    db.execute("COMMIT")

# Alternative: Use predicate locks or serializable snapshot isolation
# to prevent phantoms without explicit locking
```

**Key Takeaway:** SERIALIZABLE isolation or predicate locks prevent phantom reads.

---

#### A5A: Read Skew

**Definition:** A transaction reads two related objects and sees them from different points in time (partial observation of a multi-object update).

**Bad Example (SQL):**
```sql
-- Initial: x=50, y=50 (constraint: x+y=100)

-- Transaction T1 (moves 50 from x to y)
BEGIN;
UPDATE data SET value=0 WHERE key='x';
UPDATE data SET value=100 WHERE key='y';
COMMIT;

-- Transaction T2 (concurrent, reads during T1's execution)
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;
SELECT value FROM data WHERE key='x';  -- Reads 0 (T1 committed first update)
SELECT value FROM data WHERE key='y';  -- Reads 50 (T1 not committed yet)
-- Observes: x=0, y=50, sum=50
-- VIOLATION: Constraint temporarily broken from T2's perspective
COMMIT;
```

**Good Example (SQL):**
```sql
-- Transaction T2 with proper isolation
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- Or use SERIALIZABLE
SELECT value FROM data WHERE key='x';  -- Reads from snapshot
SELECT value FROM data WHERE key='y';  -- Same snapshot
-- Observes consistent state: either (50,50) or (0,100)
COMMIT;
```

**Key Takeaway:** Read skew requires snapshot isolation or stronger to prevent observing partial updates.

---

#### A5B: Write Skew

**Definition:** Two transactions read overlapping data and make disjoint updates that together violate a constraint.

**Bad Example (Go):**
```go
// Constraint: At least one of (x, y) must be true

func DisableX(db *sql.DB) {
    tx, _ := db.Begin()

    // Check constraint
    var xVal, yVal bool
    tx.QueryRow("SELECT x, y FROM flags WHERE id=1").Scan(&xVal, &yVal)

    if xVal || yVal {  // At least one is true
        // Safe to disable x
        tx.Exec("UPDATE flags SET x=false WHERE id=1")
    }

    tx.Commit()
}

func DisableY(db *sql.DB) {
    tx, _ := db.Begin()

    // Check constraint (reads same snapshot as DisableX)
    var xVal, yVal bool
    tx.QueryRow("SELECT x, y FROM flags WHERE id=1").Scan(&xVal, &yVal)

    if xVal || yVal {  // At least one is true
        // Safe to disable y
        tx.Exec("UPDATE flags SET y=false WHERE id=1")
    }

    tx.Commit()
}

// Both transactions run concurrently, both see (true, true)
// Result: (false, false) - VIOLATION: Constraint broken!
```

**Good Example (Go):**
```go
func DisableFlag(db *sql.DB, flagName string) error {
    tx, _ := db.BeginTx(context.Background(), &sql.TxOptions{
        Isolation: sql.LevelSerializable,
    })
    defer tx.Rollback()

    // Lock the row being checked
    var xVal, yVal bool
    tx.QueryRow("SELECT x, y FROM flags WHERE id=1 FOR UPDATE").
        Scan(&xVal, &yVal)

    if !xVal && !yVal {
        return errors.New("cannot disable: would violate constraint")
    }

    if flagName == "x" {
        tx.Exec("UPDATE flags SET x=false WHERE id=1")
    } else {
        tx.Exec("UPDATE flags SET y=false WHERE id=1")
    }

    return tx.Commit()
}

// Alternative: Use SERIALIZABLE isolation which detects
// write skew and aborts one transaction
```

**Key Takeaway:** Write skew requires SERIALIZABLE isolation or explicit locking of all rows involved in the constraint check.

---

## 3. Fault Types

### Process Faults

#### Crash

**Definition:** Process halts unexpectedly but can be restarted with state restored from durable storage.

**Bad Example (Java):**
```java
public class OrderProcessor {
    private Queue<Order> inMemoryQueue = new LinkedList<>();

    public void processOrder(Order order) {
        inMemoryQueue.add(order);
        // Process later...
    }

    // If process crashes here, all queued orders are lost!
}
```

**Good Example (Java):**
```java
public class ResilientOrderProcessor {
    private final Database db;

    public void processOrder(Order order) {
        // Persist to durable storage first
        db.execute(
            "INSERT INTO order_queue (id, data, status) VALUES (?, ?, 'pending')",
            order.getId(), order.toJson()
        );

        processOrderAsync(order.getId());
    }

    public void recoverAfterCrash() {
        // On restart, recover pending orders
        List<Order> pending = db.query(
            "SELECT * FROM order_queue WHERE status='pending'"
        );

        for (Order order : pending) {
            processOrderAsync(order.getId());
        }
    }

    private void processOrderAsync(String orderId) {
        // Process and mark complete
        db.execute(
            "UPDATE order_queue SET status='complete' WHERE id=?",
            orderId
        );
    }
}
```

**Key Takeaway:** Persist state to durable storage before taking action. Implement recovery logic to handle pending operations after restart.

---

#### Crash-Stop

**Definition:** Process crashes and never restarts (permanent failure).

**Bad Example (Python):**
```python
class SingleNodeLockService:
    def __init__(self):
        self.locks = {}

    def acquire_lock(self, resource):
        if resource not in self.locks:
            self.locks[resource] = True
            return True
        return False

    # If this node crashes, all locks are lost forever!
    # Clients waiting for locks will deadlock
```

**Good Example (Python):**
```python
class DistributedLockService:
    def __init__(self, nodes):
        self.nodes = nodes
        self.quorum_size = len(nodes) // 2 + 1

    def acquire_lock(self, resource, ttl_seconds=30):
        """Acquire lock with timeout (prevents deadlock on crash-stop)"""
        acquired_count = 0
        expiry = time.time() + ttl_seconds

        for node in self.nodes:
            try:
                if node.acquire_lock_with_ttl(resource, expiry):
                    acquired_count += 1
            except:
                pass  # Node may be crashed

        if acquired_count >= self.quorum_size:
            return True
        else:
            # Failed to get quorum, release acquired locks
            self.release_lock(resource)
            return False

    def release_lock(self, resource):
        for node in self.nodes:
            try:
                node.release_lock(resource)
            except:
                pass

# Locks have TTL and require quorum
# System tolerates minority node failures (crash-stop)
```

**Key Takeaway:** Use replication with quorum and timeouts (TTL) to tolerate permanent failures.

---

#### Crash-Recover

**Definition:** Process crashes and restarts, potentially multiple times, with durable state restored.

**Bad Example (Go):**
```go
type PaymentProcessor struct {
    idempotencyKeys map[string]bool  // In-memory only
}

func (p *PaymentProcessor) ProcessPayment(paymentID string, amount float64) {
    if p.idempotencyKeys[paymentID] {
        return  // Already processed
    }

    chargeCard(amount)
    p.idempotencyKeys[paymentID] = true

    // PROBLEM: If crash happens here, idempotency map is lost
    // On recovery, same payment may be processed twice!
}
```

**Good Example (Go):**
```go
type ResilientPaymentProcessor struct {
    db Database
}

func (p *ResilientPaymentProcessor) ProcessPayment(
    paymentID string,
    amount float64,
) error {
    tx, _ := p.db.Begin()
    defer tx.Rollback()

    // Check idempotency in durable storage
    var exists bool
    tx.QueryRow(
        "SELECT EXISTS(SELECT 1 FROM processed_payments WHERE id=?)",
        paymentID,
    ).Scan(&exists)

    if exists {
        return nil  // Already processed
    }

    // Process payment
    if err := chargeCard(amount); err != nil {
        return err
    }

    // Record in durable storage atomically
    tx.Exec(
        "INSERT INTO processed_payments (id, amount, timestamp) VALUES (?, ?, ?)",
        paymentID, amount, time.Now(),
    )

    return tx.Commit()
}

// On recovery, all processed payments are in durable storage
// No duplicate charges even after multiple crash-recover cycles
```

**Key Takeaway:** Store all critical state (including idempotency keys) in durable storage. Use transactions to ensure atomicity across crashes.

---

#### Byzantine

**Definition:** Process behaves arbitrarily or maliciously, sending incorrect/contradictory messages.

**Bad Example (Python):**
```python
# Simple consensus without Byzantine tolerance
def simple_voting(nodes, proposal):
    votes = []
    for node in nodes:
        vote = node.vote(proposal)  # Trust all nodes
        votes.append(vote)

    yes_votes = sum(1 for v in votes if v == "yes")

    # Malicious node could send "yes" to some nodes and "no" to others
    # Or send invalid data
    return yes_votes > len(nodes) / 2
```

**Good Example (Python):**
```python
import hashlib
import hmac

class ByzantineTolerantConsensus:
    def __init__(self, nodes, f):
        """
        f = max number of Byzantine nodes
        Requires n >= 3f + 1 total nodes
        """
        self.nodes = nodes
        self.f = f
        self.required_agreement = 2 * f + 1

    def pbft_consensus(self, proposal):
        """Simplified PBFT-style consensus"""

        # Phase 1: Pre-prepare (primary proposes)
        primary = self.nodes[0]
        proposal_hash = hashlib.sha256(proposal.encode()).hexdigest()

        # Phase 2: Prepare (all nodes sign and broadcast)
        prepare_msgs = []
        for node in self.nodes:
            signed = node.sign_message(f"PREPARE:{proposal_hash}")
            prepare_msgs.append((node.id, signed))

        # Verify signatures and count agreements
        valid_prepares = [
            msg for msg in prepare_msgs
            if self.verify_signature(msg[0], msg[1])
        ]

        if len(valid_prepares) < self.required_agreement:
            return False  # Not enough honest nodes agree

        # Phase 3: Commit (nodes commit if enough prepare messages)
        commit_msgs = []
        for node in self.nodes:
            signed = node.sign_message(f"COMMIT:{proposal_hash}")
            commit_msgs.append((node.id, signed))

        valid_commits = [
            msg for msg in commit_msgs
            if self.verify_signature(msg[0], msg[1])
        ]

        # Need 2f+1 commits to finalize (guarantees honest majority)
        return len(valid_commits) >= self.required_agreement

    def verify_signature(self, node_id, signed_msg):
        """Verify cryptographic signature to detect tampering"""
        node = next(n for n in self.nodes if n.id == node_id)
        return node.verify(signed_msg)
```

**Key Takeaway:** Byzantine tolerance requires n ≥ 3f+1 replicas and cryptographic signatures. Use protocols like PBFT, Raft, or blockchain consensus for critical systems.

---

#### Pause

**Definition:** Process temporarily stops executing (GC pause, OS scheduling, etc.) but appears alive to network.

**Bad Example (Java):**
```java
public class LeaderWithLease {
    private long leaseExpiry;

    public void acquireLease() {
        this.leaseExpiry = System.currentTimeMillis() + 10000; // 10s lease
    }

    public void doLeaderWork() {
        if (System.currentTimeMillis() < leaseExpiry) {
            // I'm still the leader
            writeToDatabase("UPDATE config SET leader_id=" + myId);

            // PROBLEM: Long GC pause happens here (15 seconds)
            // Lease expired but we don't know it!
            // Another node becomes leader

            writeToDatabase("UPDATE config SET leader_value=" + myData);
            // VIOLATION: Two leaders writing simultaneously!
        }
    }
}
```

**Good Example (Java):**
```java
public class SafeLeaderWithLease {
    private final Database db;
    private final int myId;
    private long leaseExpiry;

    public boolean tryAcquireLease() {
        // Fencing token: monotonically increasing number
        int fencingToken = db.getAndIncrementFencingToken();

        boolean acquired = db.compareAndSet(
            "leader_lease",
            null,  // Expected: no current leader
            new Lease(myId, fencingToken, System.currentTimeMillis() + 10000)
        );

        if (acquired) {
            this.leaseExpiry = System.currentTimeMillis() + 10000;
            this.fencingToken = fencingToken;
        }

        return acquired;
    }

    public void doLeaderWork() {
        // Check lease before every write
        if (!hasValidLease()) {
            throw new LeaseExpiredException();
        }

        // Use fencing token with every write
        db.writeWithFencingToken(
            this.fencingToken,
            "UPDATE config SET leader_value=?",
            myData
        );
    }

    private boolean hasValidLease() {
        // Check local expiry (optimization)
        if (System.currentTimeMillis() >= leaseExpiry) {
            return false;
        }

        // Also check with external system (ground truth)
        Lease currentLease = db.getCurrentLease("leader_lease");
        return currentLease != null && currentLease.nodeId == myId;
    }
}

// Database rejects writes with stale fencing tokens
class FencedDatabase {
    private int lastSeenToken = 0;

    public synchronized void writeWithFencingToken(
        int token,
        String query,
        Object... params
    ) {
        if (token < lastSeenToken) {
            throw new FencingTokenExpiredException(
                "Token " + token + " < last seen " + lastSeenToken
            );
        }

        lastSeenToken = token;
        // Perform write...
    }
}
```

**Key Takeaway:** Use fencing tokens (monotonic counters) to prevent stale leaders from performing writes after pause. Always validate lease with external authority before critical operations.

---

#### Amnesia

**Definition:** Process loses recent in-memory state (e.g., OS kills process and restarts, losing buffered data).

**Bad Example (Python):**
```python
class MessageBroker:
    def __init__(self):
        self.pending_acks = {}  # In-memory tracking

    def send_message(self, msg):
        msg_id = str(uuid.uuid4())
        self.pending_acks[msg_id] = msg

        # Send to network
        network.send(msg)

        # Wait for ack (in background)
        # If process killed before ack, message is lost!

    def on_ack(self, msg_id):
        del self.pending_acks[msg_id]
```

**Good Example (Python):**
```python
class DurableMessageBroker:
    def __init__(self, wal_path):
        self.wal = WriteAheadLog(wal_path)

    def send_message(self, msg):
        msg_id = str(uuid.uuid4())

        # Write to WAL BEFORE sending
        self.wal.append({
            'msg_id': msg_id,
            'msg': msg,
            'status': 'pending'
        })
        self.wal.sync()  # Ensure durability

        # Now send
        network.send(msg)

    def on_ack(self, msg_id):
        # Mark as acked in WAL
        self.wal.append({
            'msg_id': msg_id,
            'status': 'acked'
        })
        self.wal.sync()

    def recover_after_restart(self):
        """Replay WAL to recover pending messages"""
        pending = {}

        for entry in self.wal.read_all():
            msg_id = entry['msg_id']

            if entry['status'] == 'pending':
                pending[msg_id] = entry['msg']
            elif entry['status'] == 'acked':
                pending.pop(msg_id, None)

        # Resend all pending messages
        for msg_id, msg in pending.items():
            network.send(msg)
```

**Key Takeaway:** Use write-ahead logging (WAL) to persist state before taking action. Implement recovery logic to replay WAL after restart.

---

### Network Faults

#### Partition

**Definition:** Network splits into multiple disconnected components; nodes in different partitions cannot communicate.

**Bad Example (Go):**
```go
// Majority voting without partition tolerance
type SimpleKVStore struct {
    nodes []Node
}

func (s *SimpleKVStore) Write(key, value string) error {
    successCount := 0

    for _, node := range s.nodes {
        if node.Write(key, value) == nil {
            successCount++
        }
    }

    // Simple majority
    if successCount > len(s.nodes)/2 {
        return nil
    }

    return errors.New("write failed")
}

// PROBLEM: During partition, minority partition can't write
// But also: no guarantee reads see latest writes!
```

**Good Example (Go):**
```go
type QuorumKVStore struct {
    nodes       []Node
    writeQuorum int  // W
    readQuorum  int  // R
}

// Use W + R > N to guarantee overlap
func NewQuorumKVStore(nodes []Node) *QuorumKVStore {
    n := len(nodes)
    return &QuorumKVStore{
        nodes:       nodes,
        writeQuorum: n/2 + 1,      // W = majority
        readQuorum:  n/2 + 1,      // R = majority
    }
    // W + R = n+1 > n, guarantees read sees latest write
}

func (s *QuorumKVStore) Write(key, value string) error {
    version := s.getNextVersion(key)
    successCount := 0

    for _, node := range s.nodes {
        err := node.WriteVersioned(key, value, version)
        if err == nil {
            successCount++
            if successCount >= s.writeQuorum {
                return nil  // Got quorum
            }
        }
    }

    return errors.New("failed to reach write quorum")
}

func (s *QuorumKVStore) Read(key string) (string, error) {
    type VersionedValue struct {
        value   string
        version int64
    }

    results := []VersionedValue{}

    for _, node := range s.nodes {
        value, version, err := node.ReadVersioned(key)
        if err == nil {
            results = append(results, VersionedValue{value, version})
            if len(results) >= s.readQuorum {
                break  // Got quorum
            }
        }
    }

    if len(results) < s.readQuorum {
        return "", errors.New("failed to reach read quorum")
    }

    // Return value with highest version
    latest := results[0]
    for _, r := range results {
        if r.version > latest.version {
            latest = r
        }
    }

    // Read repair: propagate latest version to stale nodes
    go s.readRepair(key, latest.value, latest.version)

    return latest.value, nil
}
```

**Key Takeaway:** Use quorum systems with W+R > N to tolerate partitions while maintaining consistency. Majority quorums (W=R=N/2+1) provide strong consistency.

---

#### Message Omission (Loss)

**Definition:** Messages sent between nodes are silently dropped by the network.

**Bad Example (Java):**
```java
public class UnreliableRPC {
    public void sendRequest(Node target, Request req) {
        // Fire and forget
        socket.send(target.address, req.serialize());

        // PROBLEM: No retry, no acknowledgment
        // If message lost, client hangs forever
    }
}
```

**Good Example (Java):**
```java
public class ReliableRPC {
    private final Map<String, CompletableFuture<Response>> pending =
        new ConcurrentHashMap<>();
    private final ScheduledExecutorService scheduler =
        Executors.newScheduledThreadPool(1);

    public CompletableFuture<Response> sendRequest(Node target, Request req) {
        String reqId = UUID.randomUUID().toString();
        req.setId(reqId);

        CompletableFuture<Response> future = new CompletableFuture<>();
        pending.put(reqId, future);

        // Send with retries
        sendWithRetry(target, req, 0);

        // Timeout after 30 seconds
        scheduler.schedule(() -> {
            CompletableFuture<Response> f = pending.remove(reqId);
            if (f != null && !f.isDone()) {
                f.completeExceptionally(new TimeoutException());
            }
        }, 30, TimeUnit.SECONDS);

        return future;
    }

    private void sendWithRetry(Node target, Request req, int attempt) {
        if (attempt >= 5) {
            CompletableFuture<Response> f = pending.remove(req.getId());
            if (f != null) {
                f.completeExceptionally(
                    new IOException("Max retries exceeded")
                );
            }
            return;
        }

        try {
            socket.send(target.address, req.serialize());
        } catch (IOException e) {
            // Network error, retry
        }

        // Exponential backoff: 100ms, 200ms, 400ms, ...
        int delayMs = 100 * (1 << attempt);
        scheduler.schedule(
            () -> {
                // Retry if not yet completed
                if (pending.containsKey(req.getId())) {
                    sendWithRetry(target, req, attempt + 1);
                }
            },
            delayMs,
            TimeUnit.MILLISECONDS
        );
    }

    public void onResponse(Response resp) {
        CompletableFuture<Response> future = pending.remove(resp.getRequestId());
        if (future != null) {
            future.complete(resp);
        }
    }
}
```

**Key Takeaway:** Implement retry logic with exponential backoff and timeouts. Use acknowledgments to confirm message delivery.

---

#### Message Duplication

**Definition:** Network delivers the same message multiple times.

**Bad Example (Python):**
```python
def handle_payment_request(msg):
    """Process incoming payment message"""
    customer_id = msg['customer_id']
    amount = msg['amount']

    # Charge customer
    billing.charge(customer_id, amount)

    # Update database
    db.execute(
        "INSERT INTO payments (customer_id, amount) VALUES (?, ?)",
        (customer_id, amount)
    )

    # PROBLEM: If message duplicated, customer charged twice!
```

**Good Example (Python):**
```python
def handle_payment_request(msg):
    """Idempotent payment processing"""
    request_id = msg['request_id']  # Unique per request
    customer_id = msg['customer_id']
    amount = msg['amount']

    # Check if already processed (idempotency key)
    existing = db.execute(
        "SELECT id FROM payments WHERE request_id=?",
        (request_id,)
    ).fetchone()

    if existing:
        # Already processed this request
        return {"status": "success", "payment_id": existing[0]}

    # Not processed yet, charge customer
    charge_result = billing.charge(customer_id, amount)

    # Record with idempotency key
    db.execute(
        """INSERT INTO payments (request_id, customer_id, amount, charge_id)
           VALUES (?, ?, ?, ?)""",
        (request_id, customer_id, amount, charge_result.id)
    )

    return {"status": "success", "payment_id": charge_result.id}

# Even if message delivered 10 times, customer only charged once
```

**Key Takeaway:** Make operations idempotent using unique request IDs. Check for duplicate processing before taking action.

---

#### Message Reordering

**Definition:** Messages arrive in a different order than sent.

**Bad Example (Go):**
```go
// Database replication without ordering
func replicateUpdates(updates []Update) {
    for _, update := range updates {
        // Send to replica (may arrive out of order)
        go sendToReplica(update)
    }
}

// Replica receives:
// UPDATE users SET balance=200 WHERE id=1  (operation 2)
// UPDATE users SET balance=100 WHERE id=1  (operation 1)
// Final balance: 100 (wrong! should be 200)
```

**Good Example (Go):**
```go
type SequencedUpdate struct {
    seqNum int64
    data   Update
}

type OrderedReplicator struct {
    nextSeq       int64
    pendingBuffer map[int64]Update
    mutex         sync.Mutex
}

func (r *OrderedReplicator) ReplicateUpdate(update Update) {
    r.mutex.Lock()
    seqNum := r.nextSeq
    r.nextSeq++
    r.mutex.Unlock()

    // Send with sequence number
    sendToReplica(SequencedUpdate{seqNum: seqNum, data: update})
}

func (r *OrderedReplicator) OnReceiveAtReplica(
    seqUpdate SequencedUpdate,
) {
    r.mutex.Lock()
    defer r.mutex.Unlock()

    // Buffer out-of-order messages
    if seqUpdate.seqNum > r.nextExpectedSeq {
        r.pendingBuffer[seqUpdate.seqNum] = seqUpdate.data
        return
    }

    // Apply this update
    applyUpdate(seqUpdate.data)
    r.nextExpectedSeq++

    // Apply any buffered updates now in order
    for {
        next, exists := r.pendingBuffer[r.nextExpectedSeq]
        if !exists {
            break
        }

        applyUpdate(next)
        delete(r.pendingBuffer, r.nextExpectedSeq)
        r.nextExpectedSeq++
    }
}
```

**Key Takeaway:** Attach sequence numbers to messages and buffer out-of-order messages until gaps are filled.

---

#### Message Corruption

**Definition:** Message contents are altered in transit.

**Bad Example (Java):**
```java
public void sendData(byte[] data) {
    // Send raw data over network
    socket.write(data);

    // PROBLEM: No integrity check
    // Receiver may get corrupted data and process it incorrectly
}

public byte[] receiveData() {
    byte[] data = socket.read();
    return data;  // May be corrupted!
}
```

**Good Example (Java):**
```java
import java.security.MessageDigest;
import java.util.Arrays;

public class IntegrityProtectedSocket {

    public void sendData(byte[] data) throws Exception {
        // Compute checksum
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] checksum = md.digest(data);

        // Send length, data, and checksum
        DataOutputStream out = new DataOutputStream(socket.getOutputStream());
        out.writeInt(data.length);
        out.write(data);
        out.write(checksum);
        out.flush();
    }

    public byte[] receiveData() throws Exception {
        DataInputStream in = new DataInputStream(socket.getInputStream());

        // Read length, data, and checksum
        int length = in.readInt();
        byte[] data = new byte[length];
        in.readFully(data);

        byte[] receivedChecksum = new byte[32];  // SHA-256 size
        in.readFully(receivedChecksum);

        // Verify integrity
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        byte[] computedChecksum = md.digest(data);

        if (!Arrays.equals(receivedChecksum, computedChecksum)) {
            throw new IOException("Data corruption detected!");
        }

        return data;
    }
}

// Alternative: Use TLS which provides integrity automatically
```

**Key Takeaway:** Use checksums (CRC, SHA) or cryptographic MACs to detect corruption. Modern protocols (TLS, QUIC) provide integrity automatically.

---

#### Delay (Variable Latency)

**Definition:** Messages experience unpredictable delays, potentially violating timing assumptions.

**Bad Example (Python):**
```python
class LeaderElection:
    def __init__(self):
        self.is_leader = False
        self.last_heartbeat = {}

    def send_heartbeat(self):
        for node in self.peers:
            node.heartbeat(self.node_id)

    def check_leader_alive(self):
        now = time.time()
        leader = self.get_current_leader()

        # Assume leader dead if no heartbeat for 1 second
        if now - self.last_heartbeat.get(leader, 0) > 1.0:
            # PROBLEM: Network delay may cause false positive
            # Leader is alive but heartbeat delayed
            self.become_leader()  # Split brain!
```

**Good Example (Python):**
```python
class RobustLeaderElection:
    def __init__(self):
        self.term = 0
        self.voted_for = None
        self.state = "follower"
        self.election_timeout = self.random_timeout()

    def random_timeout(self):
        """Randomized timeout prevents split votes"""
        return random.uniform(1.5, 3.0)  # 1.5-3s

    def on_heartbeat(self, leader_id, term):
        if term >= self.term:
            self.term = term
            self.state = "follower"
            self.last_heartbeat = time.time()
            self.election_timeout = self.random_timeout()

    def check_election_timeout(self):
        now = time.time()

        if self.state != "leader" and \
           now - self.last_heartbeat > self.election_timeout:
            # Start election
            self.start_election()

    def start_election(self):
        self.term += 1
        self.state = "candidate"
        self.voted_for = self.node_id
        votes = 1

        # Request votes from peers
        for peer in self.peers:
            if peer.request_vote(self.node_id, self.term):
                votes += 1

        # Need majority to become leader
        if votes > len(self.peers) / 2:
            self.become_leader()
        else:
            # Lost election, back to follower
            self.state = "follower"
            self.election_timeout = self.random_timeout()

    def become_leader(self):
        self.state = "leader"
        # Immediately send heartbeat to assert leadership
        self.send_heartbeat()

# Uses longer timeouts, randomization, and terms to handle delays
```

**Key Takeaway:** Use adaptive timeouts (longer than typical delays), randomization to prevent simultaneous actions, and versioning (terms/epochs) to detect stale messages.

---

### Storage Faults

#### Lost Write

**Definition:** Storage acknowledges a write but the data is not persisted (cache not flushed, power loss, etc.).

**Bad Example (C):**
```c
int write_to_file(const char* filename, const char* data) {
    FILE* f = fopen(filename, "w");
    if (!f) return -1;

    fprintf(f, "%s", data);
    fclose(f);  // Only closes file handle, doesn't force fsync

    // PROBLEM: Data may still be in OS cache
    // Power loss before flush = data lost

    return 0;
}
```

**Good Example (C):**
```c
#include <unistd.h>
#include <fcntl.h>

int durable_write(const char* filename, const char* data, size_t len) {
    int fd = open(filename, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) return -1;

    // Write data
    ssize_t written = write(fd, data, len);
    if (written != len) {
        close(fd);
        return -1;
    }

    // Force to disk (critical!)
    if (fsync(fd) != 0) {
        close(fd);
        return -1;
    }

    // Also fsync directory (ensures directory entry persisted)
    int dir_fd = open(".", O_RDONLY);
    if (dir_fd >= 0) {
        fsync(dir_fd);
        close(dir_fd);
    }

    close(fd);
    return 0;
}
```

**Key Takeaway:** Always call fsync() (or equivalent) to ensure data reaches persistent storage. Also fsync directory entries for new files.

---

#### Torn Write

**Definition:** Only part of a multi-sector write persists (power loss during write).

**Bad Example (Java):**
```java
public void updateRecord(long recordId, byte[] data) {
    // Write 8KB record (spans multiple disk sectors)
    long offset = recordId * 8192;

    file.seek(offset);
    file.write(data);  // Not atomic!

    // PROBLEM: Power loss mid-write
    // First 4KB written, last 4KB old data
    // Record is corrupted mix of old and new
}
```

**Good Example (Java):**
```java
public class AtomicRecordStore {
    private final RandomAccessFile file;
    private final int recordSize = 8192;

    public void updateRecord(long recordId, byte[] data) throws IOException {
        // Use copy-on-write for atomicity
        long offset = recordId * recordSize;

        // Compute checksum
        CRC32 crc = new CRC32();
        crc.update(data);
        long checksum = crc.getValue();

        // Write to temporary location
        long tempOffset = getTempOffset(recordId);
        file.seek(tempOffset);
        file.writeLong(checksum);
        file.write(data);
        file.getFD().sync();  // Ensure temp write is durable

        // Atomic commit: update index to point to new location
        updateIndex(recordId, tempOffset);

        // Later: garbage collect old version
    }

    public byte[] readRecord(long recordId) throws IOException {
        long offset = getOffsetFromIndex(recordId);

        file.seek(offset);
        long checksum = file.readLong();
        byte[] data = new byte[recordSize];
        file.readFully(data);

        // Verify checksum
        CRC32 crc = new CRC32();
        crc.update(data);

        if (crc.getValue() != checksum) {
            throw new IOException("Torn write detected!");
        }

        return data;
    }
}
```

**Key Takeaway:** Use checksums to detect torn writes. Use copy-on-write or write-ahead logging for atomic multi-sector updates.

---

#### Misdirected Write/Read

**Definition:** Data written to or read from the wrong location on disk (firmware bug, bit flip in address).

**Bad Example (Python):**
```python
def write_page(page_num, data):
    offset = page_num * 4096

    disk.seek(offset)
    disk.write(data)

    # PROBLEM: If offset computed wrong or disk writes to wrong sector,
    # data corrupts different page
    # No detection mechanism
```

**Good Example (Python):**
```python
import struct
import zlib

class VerifiedPageStore:
    PAGE_SIZE = 4096
    HEADER_SIZE = 16  # 8 bytes page_num + 4 bytes checksum + 4 bytes magic

    def write_page(self, page_num, data):
        if len(data) > self.PAGE_SIZE - self.HEADER_SIZE:
            raise ValueError("Data too large")

        # Embed page number in header
        magic = 0xDEADBEEF
        checksum = zlib.crc32(data)
        header = struct.pack('<QII', page_num, checksum, magic)

        # Pad data to page size
        padded = data + b'\x00' * (self.PAGE_SIZE - self.HEADER_SIZE - len(data))
        page_data = header + padded

        offset = page_num * self.PAGE_SIZE
        self.disk.seek(offset)
        self.disk.write(page_data)
        self.disk.flush()
        os.fsync(self.disk.fileno())

    def read_page(self, page_num):
        offset = page_num * self.PAGE_SIZE
        self.disk.seek(offset)
        page_data = self.disk.read(self.PAGE_SIZE)

        # Parse header
        stored_page_num, checksum, magic = struct.unpack('<QII', page_data[:16])
        data = page_data[16:].rstrip(b'\x00')

        # Verify magic number
        if magic != 0xDEADBEEF:
            raise IOError("Invalid magic number - possible misdirected read")

        # Verify page number
        if stored_page_num != page_num:
            raise IOError(
                f"Misdirected read! Expected page {page_num}, "
                f"got page {stored_page_num}"
            )

        # Verify checksum
        if zlib.crc32(data) != checksum:
            raise IOError("Checksum mismatch - data corruption")

        return data
```

**Key Takeaway:** Embed identifiers (page numbers, object IDs) and checksums in stored data to detect misdirected operations.

---

#### Bit Rot

**Definition:** Data gradually corrupts over time due to physical decay of storage media.

**Bad Example (Go):**
```go
// Archive storage with no integrity checking
type Archive struct {
    files map[string][]byte
}

func (a *Archive) Store(filename string, data []byte) {
    // Write to disk
    ioutil.WriteFile(filepath.Join("/archive", filename), data, 0644)
}

func (a *Archive) Retrieve(filename string) ([]byte, error) {
    // Read from disk
    data, err := ioutil.ReadFile(filepath.Join("/archive", filename))

    // PROBLEM: No way to know if data corrupted over years
    // Bit rot may have changed file contents

    return data, err
}
```

**Good Example (Go):**
```go
import (
    "crypto/sha256"
    "encoding/hex"
    "time"
)

type ArchiveEntry struct {
    Filename     string
    SHA256       string
    Size         int64
    StoredAt     time.Time
    LastVerified time.Time
}

type IntegrityCheckedArchive struct {
    metadata map[string]ArchiveEntry
}

func (a *IntegrityCheckedArchive) Store(filename string, data []byte) error {
    // Compute checksum
    hash := sha256.Sum256(data)
    checksum := hex.EncodeToString(hash[:])

    // Write data
    path := filepath.Join("/archive", filename)
    if err := ioutil.WriteFile(path, data, 0644); err != nil {
        return err
    }

    // Store metadata
    a.metadata[filename] = ArchiveEntry{
        Filename:     filename,
        SHA256:       checksum,
        Size:         int64(len(data)),
        StoredAt:     time.Now(),
        LastVerified: time.Now(),
    }

    a.saveMetadata()
    return nil
}

func (a *IntegrityCheckedArchive) Retrieve(filename string) ([]byte, error) {
    data, err := ioutil.ReadFile(filepath.Join("/archive", filename))
    if err != nil {
        return nil, err
    }

    // Verify integrity
    if err := a.verifyIntegrity(filename, data); err != nil {
        return nil, fmt.Errorf("bit rot detected: %w", err)
    }

    return data, nil
}

func (a *IntegrityCheckedArchive) verifyIntegrity(
    filename string,
    data []byte,
) error {
    entry, exists := a.metadata[filename]
    if !exists {
        return errors.New("no metadata found")
    }

    // Check size
    if int64(len(data)) != entry.Size {
        return errors.New("size mismatch")
    }

    // Check checksum
    hash := sha256.Sum256(data)
    checksum := hex.EncodeToString(hash[:])

    if checksum != entry.SHA256 {
        return fmt.Errorf(
            "checksum mismatch: expected %s, got %s",
            entry.SHA256, checksum,
        )
    }

    // Update last verified time
    entry.LastVerified = time.Now()
    a.metadata[filename] = entry
    a.saveMetadata()

    return nil
}

func (a *IntegrityCheckedArchive) PeriodicScrub() {
    // Run regularly to detect bit rot early
    for filename := range a.metadata {
        data, err := ioutil.ReadFile(filepath.Join("/archive", filename))
        if err != nil {
            log.Printf("Error reading %s: %v", filename, err)
            continue
        }

        if err := a.verifyIntegrity(filename, data); err != nil {
            log.Printf("CORRUPTION DETECTED in %s: %v", filename, err)
            // Alert, restore from backup, etc.
        }
    }
}
```

**Key Takeaway:** Store checksums alongside data and periodically scrub (verify all data) to detect bit rot early. Use erasure coding or replication for recovery.

---

#### Latent Sector Error

**Definition:** Disk sector becomes unreadable but error is not discovered until attempted read.

**Bad Example (Java):**
```java
public class SimpleDatabase {
    public void writeRecord(int id, String data) {
        long offset = id * 1024;
        file.seek(offset);
        file.writeUTF(data);
    }

    public String readRecord(int id) {
        long offset = id * 1024;
        file.seek(offset);
        return file.readUTF();
        // PROBLEM: May throw IOException if sector bad
        // No fallback, data permanently lost
    }
}
```

**Good Example (Java):**
```java
public class ResilientDatabase {
    private final int REPLICAS = 3;
    private final RandomAccessFile[] files;

    public ResilientDatabase() throws IOException {
        files = new RandomAccessFile[REPLICAS];
        for (int i = 0; i < REPLICAS; i++) {
            files[i] = new RandomAccessFile("db_replica_" + i + ".dat", "rw");
        }
    }

    public void writeRecord(int id, String data) throws IOException {
        byte[] bytes = data.getBytes(StandardCharsets.UTF_8);
        CRC32 crc = new CRC32();
        crc.update(bytes);

        // Write to all replicas
        for (RandomAccessFile file : files) {
            long offset = id * 1024;
            file.seek(offset);
            file.writeInt(bytes.length);
            file.writeLong(crc.getValue());
            file.write(bytes);
            file.getFD().sync();
        }
    }

    public String readRecord(int id) throws IOException {
        List<Exception> errors = new ArrayList<>();

        // Try each replica
        for (int i = 0; i < REPLICAS; i++) {
            try {
                long offset = id * 1024;
                files[i].seek(offset);

                int length = files[i].readInt();
                long expectedCrc = files[i].readLong();
                byte[] bytes = new byte[length];
                files[i].readFully(bytes);

                // Verify checksum
                CRC32 crc = new CRC32();
                crc.update(bytes);

                if (crc.getValue() == expectedCrc) {
                    // Success! Repair other replicas if needed
                    repairOtherReplicas(id, bytes, expectedCrc, i);
                    return new String(bytes, StandardCharsets.UTF_8);
                }
            } catch (IOException e) {
                errors.add(e);
                // Try next replica
            }
        }

        // All replicas failed
        throw new IOException(
            "Failed to read from all replicas: " + errors
        );
    }

    private void repairOtherReplicas(
        int id,
        byte[] data,
        long crc,
        int goodReplica
    ) {
        // Repair corrupted replicas in background
        for (int i = 0; i < REPLICAS; i++) {
            if (i == goodReplica) continue;

            try {
                long offset = id * 1024;
                files[i].seek(offset);
                files[i].writeInt(data.length);
                files[i].writeLong(crc);
                files[i].write(data);
                files[i].getFD().sync();
            } catch (IOException e) {
                // Log repair failure
            }
        }
    }
}
```

**Key Takeaway:** Use replication (3+ copies) and checksums. When reads fail, fall back to other replicas and repair the bad copy.

---

### Time Faults

#### Clock Skew

**Definition:** Clocks on different nodes show different times (static offset).

**Bad Example (Python):**
```python
def generate_event_id():
    """Generate time-based unique ID"""
    return f"{time.time()}_{os.getpid()}"

def is_event_newer(event1, event2):
    # Compare timestamps from different nodes
    time1 = float(event1.split('_')[0])
    time2 = float(event2.split('_')[0])

    return time1 > time2

    # PROBLEM: If nodes have clock skew, ordering is wrong!
    # Event from node A at 12:00:05 (clock slow)
    # Event from node B at 12:00:00 (clock fast)
    # Wrong conclusion: A's event is newer
```

**Good Example (Python):**
```python
class HybridClock:
    """Hybrid Logical Clock (HLC) - combines physical and logical time"""

    def __init__(self, node_id):
        self.node_id = node_id
        self.logical_time = 0
        self.physical_time = 0

    def now(self):
        """Generate timestamp for local event"""
        current_physical = int(time.time() * 1000000)  # microseconds

        if current_physical > self.physical_time:
            self.physical_time = current_physical
            self.logical_time = 0
        else:
            # Physical clock hasn't advanced, increment logical
            self.logical_time += 1

        return HLCTimestamp(
            self.physical_time,
            self.logical_time,
            self.node_id
        )

    def update(self, received_timestamp):
        """Update clock when receiving message"""
        current_physical = int(time.time() * 1000000)

        # Take max of local and received physical time
        max_physical = max(
            current_physical,
            self.physical_time,
            received_timestamp.physical
        )

        if max_physical == self.physical_time == received_timestamp.physical:
            # Same physical time, increment logical
            self.logical_time = max(
                self.logical_time,
                received_timestamp.logical
            ) + 1
        elif max_physical == self.physical_time:
            self.logical_time += 1
        elif max_physical == received_timestamp.physical:
            self.logical_time = received_timestamp.logical + 1
        else:
            self.logical_time = 0

        self.physical_time = max_physical

        return self.now()

class HLCTimestamp:
    def __init__(self, physical, logical, node_id):
        self.physical = physical
        self.logical = logical
        self.node_id = node_id

    def __lt__(self, other):
        """Compare timestamps accounting for clock skew"""
        if self.physical != other.physical:
            return self.physical < other.physical
        if self.logical != other.logical:
            return self.logical < other.logical
        return self.node_id < other.node_id

    def __eq__(self, other):
        return (self.physical == other.physical and
                self.logical == other.logical and
                self.node_id == other.node_id)

# Usage
clock = HybridClock(node_id="A")
ts1 = clock.now()

# On receiving message with timestamp ts2
ts_after_receive = clock.update(ts2)
```

**Key Takeaway:** Don't rely on wall-clock time for ordering across nodes. Use logical clocks (Lamport, Vector, HLC) that combine physical and logical time.

---

#### Clock Drift

**Definition:** Clock rate differs from real time (runs faster/slower), causing increasing skew over time.

**Bad Example (Go):**
```go
type LeaderLease struct {
    expiresAt time.Time
}

func (l *LeaderLease) IsValid() bool {
    // PROBLEM: If leader's clock drifts fast, it thinks lease valid longer
    // If follower's clock drifts slow, it grants new lease too early
    // Two leaders simultaneously!
    return time.Now().Before(l.expiresAt)
}

func AcquireLease(duration time.Duration) *LeaderLease {
    return &LeaderLease{
        expiresAt: time.Now().Add(duration),
    }
}
```

**Good Example (Go):**
```go
import (
    "github.com/beevik/ntp"
    "time"
)

type NTPSyncedClock struct {
    lastSync      time.Time
    syncInterval  time.Duration
    maxDrift      time.Duration
    offset        time.Duration
    mutex         sync.RWMutex
}

func NewNTPSyncedClock() *NTPSyncedClock {
    c := &NTPSyncedClock{
        syncInterval: 1 * time.Minute,
        maxDrift:     100 * time.Millisecond,
    }

    // Initial sync
    c.sync()

    // Periodic sync
    go c.periodicSync()

    return c
}

func (c *NTPSyncedClock) sync() error {
    response, err := ntp.Query("pool.ntp.org")
    if err != nil {
        return err
    }

    c.mutex.Lock()
    c.offset = response.ClockOffset
    c.lastSync = time.Now()
    c.mutex.Unlock()

    if abs(c.offset) > c.maxDrift {
        log.Printf("WARNING: Clock drift %v exceeds max %v",
                   c.offset, c.maxDrift)
    }

    return nil
}

func (c *NTPSyncedClock) periodicSync() {
    ticker := time.NewTicker(c.syncInterval)
    for range ticker.C {
        c.sync()
    }
}

func (c *NTPSyncedClock) Now() time.Time {
    c.mutex.RLock()
    offset := c.offset
    c.mutex.RUnlock()

    return time.Now().Add(offset)
}

func (c *NTPSyncedClock) SinceLastSync() time.Duration {
    c.mutex.RLock()
    defer c.mutex.RUnlock()
    return time.Since(c.lastSync)
}

// Lease with bounded clock uncertainty
type SafeLease struct {
    grantedAt     time.Time
    duration      time.Duration
    maxUncertainty time.Duration
}

func (l *SafeLease) IsValid(clock *NTPSyncedClock) bool {
    now := clock.Now()

    // Add uncertainty buffer
    timeSinceSync := clock.SinceLastSync()
    uncertainty := min(timeSinceSync/10, l.maxUncertainty)

    // Lease valid if: now + uncertainty < grantedAt + duration
    expiresAt := l.grantedAt.Add(l.duration).Add(-uncertainty)

    return now.Before(expiresAt)
}

func min(a, b time.Duration) time.Duration {
    if a < b {
        return a
    }
    return b
}

func abs(d time.Duration) time.Duration {
    if d < 0 {
        return -d
    }
    return d
}
```

**Key Takeaway:** Sync clocks regularly with NTP. Account for clock uncertainty in time-based logic. Use shorter lease durations than clock sync intervals.

---

## 4. Error Types

### Definite Error

**Definition:** Error that definitively indicates operation failed (connection refused, invalid input, explicit rejection).

**Handling Strategy:**
1. Do not retry automatically
2. Log the error
3. Report to client
4. Take corrective action based on error type

**Example (Java):**
```java
public class ErrorHandler {

    public void processRequest(Request req) {
        try {
            validateRequest(req);
            executeRequest(req);
        } catch (ValidationException e) {
            // Definite error: invalid input
            // DO NOT RETRY - client needs to fix request
            log.error("Invalid request: " + e.getMessage());
            throw new DefiniteException("Request validation failed", e);

        } catch (AuthenticationException e) {
            // Definite error: not authorized
            // DO NOT RETRY - need different credentials
            log.error("Authentication failed: " + e.getMessage());
            throw new DefiniteException("Authentication failed", e);

        } catch (DuplicateKeyException e) {
            // Definite error: unique constraint violation
            // DO NOT RETRY - duplicate exists
            log.error("Duplicate key: " + e.getMessage());
            throw new DefiniteException("Resource already exists", e);
        }
    }
}
```

---

### Indefinite Error

**Definition:** Error that leaves operation state uncertain (timeout, connection lost, "maybe" sent).

**Handling Strategy:**
1. Make operations idempotent
2. Retry with exponential backoff
3. Use unique request IDs
4. Implement timeout and max retries
5. Eventual manual intervention for persistent failures

**Example (Python):**
```python
import time
import uuid
from enum import Enum

class ErrorType(Enum):
    DEFINITE = "definite"    # Don't retry
    INDEFINITE = "indefinite"  # Safe to retry

class RetryableClient:
    def __init__(self):
        self.max_retries = 5
        self.base_delay = 0.1  # 100ms

    def call_remote_service(self, operation, **kwargs):
        """Call remote service with automatic retry for indefinite errors"""

        # Generate unique request ID for idempotency
        request_id = str(uuid.uuid4())

        for attempt in range(self.max_retries):
            try:
                result = self._send_request(
                    operation,
                    request_id,
                    **kwargs
                )
                return result

            except DefiniteError as e:
                # Don't retry definite errors
                raise

            except IndefiniteError as e:
                if attempt == self.max_retries - 1:
                    # Exhausted retries
                    raise MaxRetriesExceeded(
                        f"Failed after {self.max_retries} attempts"
                    ) from e

                # Exponential backoff with jitter
                delay = self.base_delay * (2 ** attempt)
                jitter = random.uniform(0, delay * 0.1)
                time.sleep(delay + jitter)

                print(f"Retry {attempt + 1}/{self.max_retries} "
                      f"after {delay:.2f}s")

    def _send_request(self, operation, request_id, **kwargs):
        """Send request and classify errors"""
        try:
            # Include request_id for server-side deduplication
            response = self.http_client.post(
                f"/api/{operation}",
                json={
                    "request_id": request_id,
                    "params": kwargs
                },
                timeout=5.0
            )

            if response.status_code == 200:
                return response.json()

            # Classify HTTP errors
            if response.status_code in [400, 401, 403, 404, 409]:
                # Client errors - definite
                raise DefiniteError(f"Client error: {response.text}")

            elif response.status_code in [500, 502, 503, 504]:
                # Server errors - indefinite (might succeed on retry)
                raise IndefiniteError(f"Server error: {response.text}")

            else:
                # Unknown status - treat as indefinite
                raise IndefiniteError(f"Unexpected status: {response.status_code}")

        except requests.exceptions.Timeout:
            # Timeout - indefinite (don't know if server processed it)
            raise IndefiniteError("Request timeout")

        except requests.exceptions.ConnectionError:
            # Connection error - indefinite
            raise IndefiniteError("Connection failed")

        except ValueError as e:
            # JSON parsing error - definite
            raise DefiniteError(f"Invalid response format: {e}")

class DefiniteError(Exception):
    """Error that definitively indicates failure - don't retry"""
    pass

class IndefiniteError(Exception):
    """Error where outcome is uncertain - safe to retry if idempotent"""
    pass

class MaxRetriesExceeded(Exception):
    """Retries exhausted"""
    pass

# Server-side idempotency handling
class IdempotentServer:
    def __init__(self):
        self.processed_requests = {}  # request_id -> result
        self.ttl = 3600  # Keep processed requests for 1 hour

    def handle_request(self, request_id, operation, params):
        # Check if already processed
        if request_id in self.processed_requests:
            print(f"Request {request_id} already processed, returning cached result")
            return self.processed_requests[request_id]

        # Process request
        try:
            result = self.execute_operation(operation, params)

            # Cache result
            self.processed_requests[request_id] = result

            # Schedule cleanup after TTL
            schedule_cleanup(request_id, self.ttl)

            return result

        except Exception as e:
            # Don't cache errors - allow retry
            raise

# Usage example
client = RetryableClient()

try:
    result = client.call_remote_service(
        "transfer_money",
        from_account="A",
        to_account="B",
        amount=100
    )
    print(f"Success: {result}")

except DefiniteError as e:
    print(f"Definite failure, don't retry: {e}")

except MaxRetriesExceeded as e:
    print(f"Retries exhausted: {e}")
    # Escalate to manual intervention
```

**Key Takeaway:** Classify errors as definite (don't retry) or indefinite (safe to retry with idempotency). Use exponential backoff and unique request IDs for indefinite errors.

---

## 5. Key Principles

### Atomicity

**Definition:** Operation either completes entirely or has no effect (all-or-nothing).

**Bad Example (SQL):**
```sql
-- Multi-table update without transaction
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 123;
-- Application crashes here
UPDATE orders SET status = 'confirmed' WHERE order_id = 456;

-- Result: Inventory updated but order not confirmed
-- VIOLATION: Partial execution, inconsistent state
```

**Good Example (SQL):**
```sql
BEGIN TRANSACTION;

-- All-or-nothing: both updates succeed or both roll back
UPDATE inventory SET quantity = quantity - 1 WHERE product_id = 123;
UPDATE orders SET status = 'confirmed' WHERE order_id = 456;

-- Check inventory constraint
IF (SELECT quantity FROM inventory WHERE product_id = 123) < 0 THEN
    ROLLBACK;
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Insufficient inventory';
ELSE
    COMMIT;
END IF;
```

**Key Takeaway:** Use transactions or compensating actions to ensure operations are atomic. No partial state should be visible.

---

### Visibility

**Definition:** Changes made by committed operations become visible to subsequent operations in a consistent manner.

**Bad Example (Java):**
```java
public class Cache {
    private volatile Map<String, String> data = new HashMap<>();

    public void put(String key, String value) {
        // PROBLEM: Non-atomic read-modify-write
        Map<String, String> newData = new HashMap<>(data);
        newData.put(key, value);
        data = newData;  // Visible to other threads

        // But if two threads do this simultaneously, one update lost!
    }
}
```

**Good Example (Java):**
```java
public class SafeCache {
    private final ConcurrentHashMap<String, VersionedValue> data =
        new ConcurrentHashMap<>();

    public void put(String key, String value) {
        VersionedValue newVal = new VersionedValue(
            value,
            System.currentTimeMillis()
        );

        data.compute(key, (k, oldVal) -> {
            if (oldVal == null || newVal.version > oldVal.version) {
                return newVal;
            }
            return oldVal;  // Keep newer value
        });
    }

    public String get(String key) {
        VersionedValue val = data.get(key);
        return val != null ? val.value : null;
    }

    private static class VersionedValue {
        final String value;
        final long version;

        VersionedValue(String value, long version) {
            this.value = value;
            this.version = version;
        }
    }
}
```

**Key Takeaway:** Control visibility using memory barriers (volatile, synchronized) or versioning. Ensure updates are atomic and visible in correct order.

---

### Ordering

**Definition:** Operations execute in a well-defined order that preserves semantics and dependencies.

**Bad Example (Go):**
```go
// Message queue without ordering guarantee
type UnorderedQueue struct {
    messages chan Message
}

func (q *UnorderedQueue) Publish(msg Message) {
    go func() {
        q.messages <- msg  // May arrive out of order
    }()
}

// Consumer sees:
// "User registered" (msg 1)
// "Order placed" (msg 3)
// "Email verified" (msg 2)
// VIOLATION: Email verification happens after order!
```

**Good Example (Go):**
```go
type OrderedQueue struct {
    partitions map[string]*Partition
    mu         sync.RWMutex
}

type Partition struct {
    messages []Message
    nextSeq  int64
    mu       sync.Mutex
}

func (q *OrderedQueue) Publish(key string, msg Message) {
    q.mu.RLock()
    partition := q.getOrCreatePartition(key)
    q.mu.RUnlock()

    partition.mu.Lock()
    msg.Sequence = partition.nextSeq
    partition.nextSeq++
    partition.messages = append(partition.messages, msg)
    partition.mu.Unlock()
}

func (q *OrderedQueue) Consume(key string) <-chan Message {
    partition := q.getPartition(key)
    out := make(chan Message)

    go func() {
        nextExpected := int64(0)
        buffer := make(map[int64]Message)

        for msg := range partition.Subscribe() {
            if msg.Sequence == nextExpected {
                out <- msg
                nextExpected++

                // Deliver buffered messages in order
                for {
                    buffered, exists := buffer[nextExpected]
                    if !exists {
                        break
                    }
                    out <- buffered
                    delete(buffer, nextExpected)
                    nextExpected++
                }
            } else {
                // Buffer out-of-order message
                buffer[msg.Sequence] = msg
            }
        }
    }()

    return out
}

// Messages with same key delivered in order
// Different keys can be processed concurrently
```

**Key Takeaway:** Use sequence numbers, partitioning by key, or total ordering protocols (Paxos, Raft) to guarantee ordering where needed.

---

### Durability

**Definition:** Committed changes persist despite crashes, power loss, or failures.

**Bad Example (Python):**
```python
class InMemoryDatabase:
    def __init__(self):
        self.data = {}

    def write(self, key, value):
        self.data[key] = value
        return "OK"

    # PROBLEM: Power loss, all data lost!
```

**Good Example (Python):**
```python
import os
import json

class DurableDatabase:
    def __init__(self, wal_path, checkpoint_path):
        self.wal_path = wal_path
        self.checkpoint_path = checkpoint_path
        self.data = {}
        self.wal_fd = None

        self._recover()
        self._open_wal()

    def write(self, key, value):
        # Append to write-ahead log first
        log_entry = json.dumps({"op": "write", "key": key, "value": value}) + "\n"
        self.wal_fd.write(log_entry.encode())
        self.wal_fd.flush()
        os.fsync(self.wal_fd.fileno())  # Force to disk

        # Now update in-memory
        self.data[key] = value

        return "OK"

    def read(self, key):
        return self.data.get(key)

    def checkpoint(self):
        """Periodically write snapshot"""
        # Write to temporary file
        temp_path = self.checkpoint_path + ".tmp"
        with open(temp_path, 'w') as f:
            json.dump(self.data, f)
            f.flush()
            os.fsync(f.fileno())

        # Atomic rename
        os.rename(temp_path, self.checkpoint_path)

        # Truncate WAL
        self.wal_fd.close()
        self.wal_fd = open(self.wal_path, 'w')

    def _recover(self):
        """Recover from checkpoint + WAL replay"""
        # Load checkpoint
        if os.path.exists(self.checkpoint_path):
            with open(self.checkpoint_path, 'r') as f:
                self.data = json.load(f)

        # Replay WAL
        if os.path.exists(self.wal_path):
            with open(self.wal_path, 'r') as f:
                for line in f:
                    entry = json.loads(line)
                    if entry["op"] == "write":
                        self.data[entry["key"]] = entry["value"]

    def _open_wal(self):
        self.wal_fd = open(self.wal_path, 'a')

# Survives crash at any point - data is durable
```

**Key Takeaway:** Use write-ahead logging (WAL) and fsync to ensure durability. Periodically checkpoint to limit recovery time.

---

### Distributed Coordination

**Definition:** Multiple nodes agree on shared state or decisions despite failures and asynchrony.

**Bad Example (Java):**
```java
// Naive distributed lock (BROKEN)
public class NaiveLock {
    public boolean tryLock(String resource, int holderId) {
        // Each node checks independently
        Integer currentHolder = sharedStorage.get(resource);

        if (currentHolder == null) {
            sharedStorage.put(resource, holderId);
            return true;
        }

        return false;

        // PROBLEM: Race condition! Two nodes can both see null
        // and both acquire lock simultaneously
    }
}
```

**Good Example (Java):**
```java
// Consensus-based distributed lock (e.g., using etcd, ZooKeeper, Chubby)
public class ConsensusLock {
    private final ConsensusClient consensus;  // e.g., etcd client
    private final String lockPath;
    private final int holderId;
    private String leaseId;

    public ConsensusLock(ConsensusClient consensus, String resource, int holderId) {
        this.consensus = consensus;
        this.lockPath = "/locks/" + resource;
        this.holderId = holderId;
    }

    public boolean tryLock(Duration ttl) {
        try {
            // Create lease (lock held for limited time)
            this.leaseId = consensus.createLease(ttl);

            // Atomically create lock key if not exists
            // (compare-and-set with expected=empty)
            boolean success = consensus.putIfAbsent(
                lockPath,
                String.valueOf(holderId),
                leaseId
            );

            if (success) {
                // Got lock, keep lease alive
                startLeaseKeepAlive();
                return true;
            } else {
                // Someone else has lock
                consensus.revokeLease(leaseId);
                return false;
            }

        } catch (Exception e) {
            return false;
        }
    }

    public void unlock() {
        try {
            // Delete lock key
            consensus.delete(lockPath);

            // Revoke lease
            if (leaseId != null) {
                consensus.revokeLease(leaseId);
            }
        } catch (Exception e) {
            // Log error
        }
    }

    private void startLeaseKeepAlive() {
        // Periodically refresh lease to keep lock
        ScheduledExecutorService executor = Executors.newScheduledThreadPool(1);
        executor.scheduleAtFixedRate(
            () -> {
                try {
                    consensus.keepAlive(leaseId);
                } catch (Exception e) {
                    // Failed to keep lease alive, lock will expire
                    executor.shutdown();
                }
            },
            0,
            Duration.ofSeconds(1).toSeconds(),
            TimeUnit.SECONDS
        );
    }
}

// Usage with consensus protocol (Raft, Paxos)
ConsensusLock lock = new ConsensusLock(etcdClient, "my-resource", nodeId);

if (lock.tryLock(Duration.ofSeconds(30))) {
    try {
        // Critical section - only one node can execute
        performCriticalOperation();
    } finally {
        lock.unlock();
    }
} else {
    // Failed to acquire lock
    System.out.println("Lock held by another node");
}
```

**Good Example (Python - Leader Election with Raft):**
```python
# Simplified Raft leader election
class RaftNode:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.current_term = 0
        self.voted_for = None
        self.state = "follower"  # follower, candidate, leader
        self.election_timeout = random.uniform(1.5, 3.0)
        self.last_heartbeat = time.time()

    def start_election(self):
        """Transition to candidate and request votes"""
        self.state = "candidate"
        self.current_term += 1
        self.voted_for = self.node_id

        votes_received = 1  # Vote for self

        # Request votes from all peers
        for peer in self.peers:
            try:
                response = peer.request_vote(
                    term=self.current_term,
                    candidate_id=self.node_id
                )

                if response.term > self.current_term:
                    # Higher term seen, step down
                    self.current_term = response.term
                    self.state = "follower"
                    self.voted_for = None
                    return

                if response.vote_granted:
                    votes_received += 1

            except:
                pass  # Network error, ignore

        # Check if won election (majority)
        if votes_received > len(self.peers) / 2:
            self.become_leader()
        else:
            # Lost election, back to follower
            self.state = "follower"
            self.election_timeout = random.uniform(1.5, 3.0)

    def request_vote(self, term, candidate_id):
        """Handle vote request from candidate"""
        if term < self.current_term:
            # Reject: stale term
            return VoteResponse(term=self.current_term, vote_granted=False)

        if term > self.current_term:
            # Higher term, update and step down
            self.current_term = term
            self.state = "follower"
            self.voted_for = None

        # Grant vote if haven't voted in this term
        if self.voted_for is None or self.voted_for == candidate_id:
            self.voted_for = candidate_id
            self.last_heartbeat = time.time()
            return VoteResponse(term=self.current_term, vote_granted=True)
        else:
            return VoteResponse(term=self.current_term, vote_granted=False)

    def become_leader(self):
        """Transition to leader and start sending heartbeats"""
        self.state = "leader"
        self.send_heartbeats()

    def send_heartbeats(self):
        """Leader sends periodic heartbeats"""
        while self.state == "leader":
            for peer in self.peers:
                try:
                    response = peer.append_entries(
                        term=self.current_term,
                        leader_id=self.node_id,
                        entries=[]  # Empty for heartbeat
                    )

                    if response.term > self.current_term:
                        # Higher term, step down
                        self.current_term = response.term
                        self.state = "follower"
                        self.voted_for = None
                        return

                except:
                    pass  # Network error

            time.sleep(0.5)  # Heartbeat interval

    def check_election_timeout(self):
        """Check if need to start election"""
        if self.state != "leader":
            if time.time() - self.last_heartbeat > self.election_timeout:
                self.start_election()

# Consensus achieved: exactly one leader per term
# Tolerates failures: minority of nodes can crash
# No split-brain: terms prevent multiple leaders
```

**Key Takeaway:** Use consensus protocols (Paxos, Raft, ZAB) or consensus services (etcd, ZooKeeper, Consul) for distributed coordination. Never rely on clocks or local state alone for distributed decisions.

---

## Summary

This glossary covers the fundamental concepts needed to build correct distributed systems:

- **Consistency Models**: Understand the tradeoffs between strong (linearizability) and weak (eventual) consistency
- **Anomalies**: Recognize common bugs (dirty reads, lost updates, write skew) and how to prevent them
- **Fault Types**: Design systems that tolerate process crashes, network issues, storage failures, and time problems
- **Error Handling**: Distinguish definite vs indefinite errors and retry appropriately
- **Core Principles**: Apply atomicity, visibility, ordering, durability, and coordination correctly

When building distributed systems, always consider: What can go wrong? How do we detect it? How do we recover?
