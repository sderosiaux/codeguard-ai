# Time, Clocks, and Timeouts in Distributed Systems

This document catalogs common anti-patterns and solutions related to time management, clock synchronization, and timeout handling in distributed systems. These patterns are critical for building reliable distributed databases, microservices, and concurrent systems.

---

## 1. Wall Clock Reliance Anti-Pattern

### Description
Using system wall clocks (`gettimeofday()`, `System.currentTimeMillis()`) for timestamp ordering in distributed systems like Cassandra and Riak. Wall clocks are fundamentally unsafe ordering constructs because they can jump backward due to hardware issues, virtualization problems, misconfigured NTP, or leap second adjustments. POSIX time itself is non-monotonic: leap seconds create duplicate or missing timestamps.

### Bad Code Example
```java
// Anti-pattern: Using wall clock for timestamp ordering
class DistributedKVStore {
    void write(String key, String value) {
        long timestamp = System.currentTimeMillis();
        store.put(key, new ValueWithTimestamp(value, timestamp));
    }

    String read(String key) {
        // Last-write-wins based on timestamp
        return store.get(key).getLatestByTimestamp();
    }
}
```

**Problem Scenario:**
1. Process writes `w1` at `t=2`
2. Clock jumps backward (NTP adjustment, leap second, etc.)
3. Process writes `w2` at `t=1`
4. System discards `w2` because `t=1 < t=2` (silent data loss)
5. Reads never see `w2` - violates monotonic write consistency

### Good Code Example
```java
// Solution: Using Lamport logical clocks
class DistributedKVStore {
    private AtomicLong lamportClock = new AtomicLong(0);

    void write(String key, String value) {
        // Monotonically increasing logical timestamp
        long logicalTimestamp = lamportClock.incrementAndGet();
        store.put(key, new ValueWithTimestamp(value, logicalTimestamp));
    }

    void receiveRemoteWrite(String key, String value, long remoteTimestamp) {
        // Advance local clock to max(local, remote) + 1
        lamportClock.updateAndGet(current -> Math.max(current, remoteTimestamp) + 1);
        store.put(key, new ValueWithTimestamp(value, remoteTimestamp));
    }
}
```

### Key Takeaway
Never use wall clocks for ordering guarantees in distributed systems. Use logical clocks (Lamport clocks, vector clocks, dotted version vectors) or hybrid logical clocks (HLC) that combine physical time with logical counters. Wall clocks are acceptable only for non-critical operations like logging and metrics where weak consistency is tolerable.

---

## 2. Cross-Node Clock Skew Anti-Pattern

### Description
Even without backward clock movement, unsynced clocks between nodes break monotonic read consistency. When different nodes have clocks offset by even small amounts (100ms-1000ms), last-write-wins strategies can cause permanent data loss across causally-related operations.

### Bad Code Example
```python
# Anti-pattern: Cross-node timestamp comparison with clock skew
class DistributedDatabase:
    def write(self, key, value, node):
        # Each node uses its own clock
        timestamp = node.get_local_time()  # Node A: 1000ms, Node B: 900ms
        self.replicate(key, value, timestamp)

# Execution flow:
# Node A (accurate clock): write(k, v1) at t=1000ms
# External observer reads v1
# Node B (100ms behind): write(k, v2) at t=900ms
# v2 is permanently discarded by LWW rule
# Violates causality: observer saw v1, then wrote v2, but v2 is lost
```

**Problem Scenario:**
1. Process A writes `w1` with timestamp `t=2` (Node A clock)
2. Process B reads `w1`
3. Process B writes `w2` with timestamp `t=1` (Node B clock is behind)
4. System permanently destroys `w2` due to last-write-wins
5. Violates session consistency and causality

### Good Code Example
```python
# Solution: Hybrid Logical Clock (HLC)
class HybridLogicalClock:
    def __init__(self):
        self.physical_time = 0
        self.logical_counter = 0

    def now(self):
        """Generate HLC timestamp"""
        current_physical = self.get_physical_time()

        if current_physical > self.physical_time:
            self.physical_time = current_physical
            self.logical_counter = 0
        else:
            # Clock hasn't advanced, increment logical counter
            self.logical_counter += 1

        return HLCTimestamp(self.physical_time, self.logical_counter)

    def update(self, remote_timestamp):
        """Update clock based on remote timestamp"""
        current_physical = self.get_physical_time()

        # Take max of physical times
        max_physical = max(current_physical,
                          self.physical_time,
                          remote_timestamp.physical)

        if max_physical == self.physical_time and max_physical == remote_timestamp.physical:
            # Both physical times are same, use max logical + 1
            self.logical_counter = max(self.logical_counter,
                                      remote_timestamp.logical) + 1
        elif max_physical == self.physical_time:
            self.logical_counter += 1
        elif max_physical == remote_timestamp.physical:
            self.logical_counter = remote_timestamp.logical + 1
        else:
            self.logical_counter = 0

        self.physical_time = max_physical
```

### Key Takeaway
Clock skew between nodes violates causality and creates silent data loss. Solutions include: (1) Hybrid Logical Clocks (HLC) that combine physical time with logical counters, (2) vector clocks for tracking per-node causality, or (3) centralized timestamp authorities with strong coordination.

---

## 3. Tombstone Deletion Horizon Anti-Pattern

### Description
Delete operations using timestamps create tombstones that invalidate all earlier writes for extended periods (days or weeks). When a delete operation gets a timestamp from a fast clock, it blocks all subsequent writes with slower timestamps, even if those writes are causally after the delete.

### Bad Code Example
```ruby
# Anti-pattern: Timestamp-based tombstones
class DistributedStore
  def delete(key)
    tombstone_timestamp = Time.now.to_i * 1000  # Fast clock: 100000000ms
    write_tombstone(key, tombstone_timestamp)
  end

  def write(key, value)
    write_timestamp = Time.now.to_i * 1000
    if write_timestamp > get_tombstone_timestamp(key)
      store[key] = {value: value, timestamp: write_timestamp}
    else
      # Silent discard - write is "older" than tombstone
      return :discarded
    end
  end
end

# Problem Scenario:
# Node A (fast clock): delete(key) at t=100000000
# Node B (slow clock): write(key, value) at t=1
# Write is permanently blocked for hours/days until Node B catches up
```

**Problem Scenario:**
1. Process A deletes a row with `t=100000000` (clock ahead by hours)
2. Process B writes `w1` with timestamp `t=1` (clock behind)
3. Process B reads `null`, but expected `w1`
4. Tombstone blocks all writes until slowest clock catches up

**Violations:** Breaks strong consistency, eventual consistency, causal consistency, read-your-writes, session consistency, and monotonic consistency.

### Good Code Example
```ruby
# Solution: Version-based tombstones with causal context
class DistributedStore
  def delete(key)
    # Get current version vector, mark as deleted
    current_version = get_version_vector(key)
    tombstone = Tombstone.new(
      version: current_version.increment(node_id),
      deleted: true
    )
    write_tombstone(key, tombstone)
  end

  def write(key, value)
    current_version = get_version_vector(key)
    tombstone = get_tombstone(key)

    # Check if write descends from tombstone causally
    if tombstone && !current_version.descends_from(tombstone.version)
      # Write is concurrent or before delete - create sibling
      store_sibling(key, value, current_version.increment(node_id))
    elsif tombstone && current_version.descends_from(tombstone.version)
      # Write is causally after delete - resurrect with new version
      store[key] = {
        value: value,
        version: tombstone.version.increment(node_id),
        deleted: false
      }
    else
      # Normal write path
      store[key] = {value: value, version: current_version.increment(node_id)}
    end
  end
end
```

### Key Takeaway
Timestamp-based tombstones create unbounded deletion horizons that violate multiple consistency guarantees. Use version vectors or causal contexts to track happens-before relationships instead of relying on wall-clock ordering. This ensures deletes only suppress causally-prior writes, not unrelated writes with older timestamps.

---

## 4. NTP Synchronization Assumptions Anti-Pattern

### Description
Assuming NTP synchronization solves distributed time problems. Even with NTP enabled, nodes can drift significantly (seconds to minutes), and NTP itself has edge cases with leap seconds, network partitions, and misconfigurations. Many production systems discover nodes are "way out of sync" despite running NTP.

### Bad Code Example
```go
// Anti-pattern: Assuming NTP provides strong synchronization
type DistributedLock struct {
    leaseExpiry time.Time
}

func (l *DistributedLock) Acquire() bool {
    now := time.Now()  // Assumes synchronized with other nodes
    if now.After(l.leaseExpiry) {
        l.leaseExpiry = now.Add(10 * time.Second)
        return true  // Acquired lock
    }
    return false
}

// Problem: Two nodes with 2-second clock skew both acquire lock
// Node A clock: 10:00:00 -> acquires lock, expires at 10:00:10
// Node B clock: 10:00:02 (2s ahead) -> sees lock expired, also acquires
// Both nodes operate in critical section simultaneously
```

### Good Code Example
```go
// Solution: Bounded uncertainty intervals with clock skew monitoring
type DistributedLock struct {
    leaseExpiry      time.Time
    maxClockSkewMs   int64  // Monitored and enforced
}

func (l *DistributedLock) Acquire() (bool, error) {
    // Check if local clock offset exceeds maximum
    if l.getClockOffset() > l.maxClockSkewMs {
        return false, errors.New("clock skew exceeded, refusing operation")
    }

    now := time.Now()
    // Add safety margin equal to max clock skew
    effectiveExpiry := l.leaseExpiry.Add(-time.Duration(l.maxClockSkewMs) * time.Millisecond)

    if now.After(effectiveExpiry) {
        l.leaseExpiry = now.Add(10 * time.Second)
        return true, nil
    }
    return false, nil
}

func (l *DistributedLock) getClockOffset() int64 {
    // Actively monitor clock offset via NTP or peer comparison
    // Self-terminate node if offset exceeds configured maximum
    return measureNTPOffset()
}

// Better: Use fencing tokens instead of time-based leases
type DistributedLock struct {
    fencingToken int64  // Monotonically increasing
}

func (l *DistributedLock) Acquire() (int64, bool) {
    token := atomic.AddInt64(&l.fencingToken, 1)
    return token, true
}

func (l *DistributedLock) ProtectedWrite(token int64, data []byte) error {
    // Storage system rejects writes with older tokens
    if token < l.lastSeenToken {
        return errors.New("fencing token too old, lock was lost")
    }
    l.lastSeenToken = token
    return l.write(data)
}
```

### Key Takeaway
NTP is necessary but not sufficient for distributed consistency. Best practices:
- Enable NTP rigorously on all machines
- Use `-x` flag (slewing, not stepping) to prevent backward jumps
- Monitor clock skew continuously; self-terminate nodes exceeding thresholds
- Sync to TAI/GPS instead of UTC to avoid leap second issues
- Run private NTP pool with leap-second smearing
- For critical ordering, use logical clocks or fencing tokens instead of time

---

## 5. Latency is Zero Fallacy

### Description
Treating remote operations as instantaneous like local function calls. Network latency is measurable and accumulates across distributed operations, creating cascading delays and timeout challenges.

### Bad Code Example
```python
# Anti-pattern: Synchronous chaining without timeout awareness
def process_order(order_id):
    # Each call adds 50-200ms latency
    customer = customer_service.get_customer(order_id)  # 100ms
    inventory = inventory_service.check_stock(order_id)  # 150ms
    payment = payment_service.charge(customer.id)  # 200ms
    shipping = shipping_service.schedule(order_id)  # 100ms

    # Total: 550ms minimum, but no timeout handling
    # If any service is slow, entire chain blocks
    return create_order_response(customer, inventory, payment, shipping)
```

### Good Code Example
```python
# Solution: Parallel execution with timeouts and circuit breakers
import asyncio
from circuit_breaker import CircuitBreaker

async def process_order(order_id):
    # Execute independent calls in parallel with timeouts
    try:
        customer_task = asyncio.wait_for(
            customer_service.get_customer(order_id),
            timeout=1.0  # 1 second timeout
        )
        inventory_task = asyncio.wait_for(
            inventory_service.check_stock(order_id),
            timeout=1.0
        )

        # Parallel execution - 150ms instead of 250ms
        customer, inventory = await asyncio.gather(
            customer_task,
            inventory_task,
            return_exceptions=True  # Don't fail entire batch
        )

        # Handle partial failures gracefully
        if isinstance(customer, Exception):
            customer = get_cached_customer(order_id)
        if isinstance(inventory, Exception):
            return {"error": "inventory_unavailable", "retry": True}

        # Sequential dependent operations with timeouts
        payment = await asyncio.wait_for(
            payment_service.charge(customer.id),
            timeout=2.0
        )
        shipping = await asyncio.wait_for(
            shipping_service.schedule(order_id),
            timeout=1.0
        )

        return create_order_response(customer, inventory, payment, shipping)

    except asyncio.TimeoutError:
        # Explicit timeout handling instead of hanging indefinitely
        return {"error": "service_timeout", "retry": True}

# Circuit breaker to prevent cascading failures
@CircuitBreaker(failure_threshold=5, timeout=60)
async def customer_service_call(order_id):
    return await customer_service.get_customer(order_id)
```

### Key Takeaway
Always account for network latency in distributed systems:
- Set explicit timeouts on all remote operations
- Execute independent operations in parallel
- Use circuit breakers to prevent cascade failures during high latency
- Implement graceful degradation with cached/default values
- Monitor P50/P99 latencies, not just averages

---

## 6. Timeout-Based Task Expiration Anti-Pattern

### Description
Setting absolute wall-clock deadlines on distributed tasks without accounting for clock synchronization. This approach assumes that "don't perform this task after 5 PM" works across nodes, but requires bounded clock drift and fails during clock skew.

### Bad Code Example
```java
// Anti-pattern: Wall-clock deadlines without synchronization
class TaskQueue {
    void enqueueTask(Task task, long deadlineTimestamp) {
        task.setDeadline(deadlineTimestamp);
        queue.add(task);
    }

    void processTask() {
        Task task = queue.poll();
        if (System.currentTimeMillis() > task.getDeadline()) {
            // Discard expired task
            return;
        }
        task.execute();
    }
}

// Problem: Producer at t=1000ms sets deadline=2000ms
// Consumer clock is 500ms behind, sees t=1500ms
// Consumer processes task that producer considers expired
// Or: Consumer clock is 1500ms ahead, sees t=2500ms
// Consumer incorrectly discards fresh task
```

### Good Code Example
```java
// Solution: Relative timeouts with monotonic clocks
class TaskQueue {
    void enqueueTask(Task task, long timeoutMs) {
        long startTimeNanos = System.nanoTime();  // Monotonic clock
        task.setStartTime(startTimeNanos);
        task.setTimeout(timeoutMs);
        queue.add(task);
    }

    void processTask() {
        Task task = queue.poll();
        long elapsedNanos = System.nanoTime() - task.getStartTime();
        long elapsedMs = elapsedNanos / 1_000_000;

        if (elapsedMs > task.getTimeout()) {
            // Discard expired task based on elapsed time
            return;
        }

        // Also check if result will be too late (application-level deadline)
        if (task.hasExternalDeadline() &&
            System.currentTimeMillis() > task.getExternalDeadline()) {
            return;  // Skip task that external system won't accept
        }

        task.execute();
    }
}

// Better: Idempotent operations with deduplication
class TaskQueue {
    private Set<String> processedTaskIds = new ConcurrentHashMap<>();

    void processTask() {
        Task task = queue.poll();

        // Check if already processed (idempotency)
        if (processedTaskIds.contains(task.getId())) {
            return;  // Skip duplicate
        }

        try {
            task.execute();
            processedTaskIds.add(task.getId());
        } catch (Exception e) {
            // Requeue for retry - idempotency ensures safety
            queue.add(task);
        }
    }
}
```

### Key Takeaway
Avoid wall-clock deadlines for distributed task expiration. Use relative timeouts with monotonic clocks (`System.nanoTime()`, `clock_gettime(CLOCK_MONOTONIC)`) for measuring elapsed time. Better yet, design idempotent operations with deduplication IDs so redelivery is safe, eliminating the need for precise timeout coordination.

---

## 7. Acknowledgment Timeout Redelivery Anti-Pattern

### Description
Redelivering messages when consumers fail to acknowledge within a time window. This creates "at least once" semantics and causes duplicate delivery during consumer stalls, network latency, or slow processing.

### Bad Code Example
```javascript
// Anti-pattern: Timeout-based redelivery without idempotency
class MessageQueue {
    constructor() {
        this.pendingMessages = new Map();  // messageId -> {message, timestamp}
        this.visibilityTimeoutMs = 30000;  // 30 seconds
    }

    async deliverMessage() {
        const message = this.dequeue();
        this.pendingMessages.set(message.id, {
            message: message,
            timestamp: Date.now()
        });

        // If no ACK received within 30s, redeliver
        setTimeout(() => {
            if (this.pendingMessages.has(message.id)) {
                this.redeliverMessage(message);
            }
        }, this.visibilityTimeoutMs);

        return message;
    }

    async acknowledgeMessage(messageId) {
        this.pendingMessages.delete(messageId);
    }
}

// Consumer side - not idempotent
async function processMessage(message) {
    await database.insert({
        orderId: message.orderId,
        amount: message.amount
    });
    // If this takes >30s or crashes before ACK, duplicate insert occurs
}

// Result: Database has duplicate orders, customer charged twice
```

### Good Code Example
```javascript
// Solution: Idempotent processing with unique identifiers
class MessageQueue {
    constructor() {
        this.pendingMessages = new Map();
        this.visibilityTimeoutMs = 30000;
    }

    async deliverMessage() {
        const message = this.dequeue();

        // Include deduplication ID in message
        message.deduplicationId = message.deduplicationId || uuidv4();

        this.pendingMessages.set(message.id, {
            message: message,
            timestamp: Date.now(),
            deliveryCount: (message.deliveryCount || 0) + 1
        });

        // Exponential backoff for retries
        const backoffMs = this.visibilityTimeoutMs *
                         Math.pow(2, message.deliveryCount || 0);

        setTimeout(() => {
            if (this.pendingMessages.has(message.id)) {
                // Check max retries before redelivery
                if ((message.deliveryCount || 0) < 3) {
                    this.redeliverMessage(message);
                } else {
                    this.moveToDLQ(message);  // Dead letter queue
                }
            }
        }, Math.min(backoffMs, 300000));  // Max 5 minutes

        return message;
    }
}

// Consumer side - idempotent processing
async function processMessage(message) {
    // Check if already processed
    const existing = await database.findOne({
        deduplicationId: message.deduplicationId
    });

    if (existing) {
        console.log(`Message ${message.deduplicationId} already processed`);
        return;  // Safe to acknowledge duplicate
    }

    // Atomic insert with deduplication ID as unique constraint
    try {
        await database.insert({
            deduplicationId: message.deduplicationId,  // UNIQUE constraint
            orderId: message.orderId,
            amount: message.amount,
            processedAt: new Date()
        });
    } catch (DuplicateKeyError) {
        // Another worker processed it concurrently - safe to ignore
        console.log(`Duplicate detected for ${message.deduplicationId}`);
    }
}

// Alternative: Use conditional operations
async function processMessageConditional(message) {
    // Use compare-and-set or conditional write
    const result = await database.insertIfNotExists(
        {deduplicationId: message.deduplicationId},
        {
            orderId: message.orderId,
            amount: message.amount,
            processedAt: new Date()
        }
    );

    if (!result.inserted) {
        console.log(`Already processed: ${message.deduplicationId}`);
    }
}
```

### Key Takeaway
Acknowledgment timeouts inevitably create at-least-once delivery. Design all consumers to be idempotent using:
- Unique deduplication IDs for each message
- Database unique constraints on deduplication IDs
- Conditional writes (compare-and-set, if-not-exists)
- State machines that can replay operations safely

Combine with exponential backoff and dead letter queues for poison messages that repeatedly fail.

---

## 8. Uncertainty Intervals Pattern (CockroachDB)

### Description
Instead of requiring perfectly synchronized clocks (like Spanner's TrueTime), use uncertainty intervals to handle clock skew probabilistically. Each transaction gets a provisional commit timestamp plus an upper bound `[commit_timestamp, commit_timestamp + max_clock_offset]`. When encountering values within this uncertainty window, restart the transaction with a bumped timestamp.

### Implementation Example
```go
// Solution: Uncertainty interval approach (CockroachDB-style)
type Transaction struct {
    commitTimestamp  int64
    uncertaintyLimit int64  // commitTimestamp + maxClockOffset
    readTimestamp    int64
}

const maxClockOffsetMs = 250  // NTP synchronization bound

func (txn *Transaction) Read(key string) (string, error) {
    value, valueTimestamp := store.Get(key)

    // Case 1: Value is definitely before transaction - safe to read
    if valueTimestamp < txn.commitTimestamp {
        return value, nil
    }

    // Case 2: Value is definitely after transaction - ignore
    if valueTimestamp > txn.uncertaintyLimit {
        return value, nil
    }

    // Case 3: Value is in uncertainty interval - cannot determine order
    if valueTimestamp >= txn.commitTimestamp &&
       valueTimestamp <= txn.uncertaintyLimit {
        // Restart transaction with higher timestamp
        txn.readTimestamp = valueTimestamp + 1
        txn.uncertaintyLimit = txn.uncertaintyLimit  // Keep same upper bound

        return "", ErrUncertainty{
            message: "Read uncertainty, restarting transaction",
            newTimestamp: txn.readTimestamp,
        }
    }

    return value, nil
}

func (txn *Transaction) Commit() error {
    // CockroachDB doesn't wait after writes
    // Uncertainty is resolved during reads via restarts

    // Monitor clock offset - terminate node if exceeded
    if getCurrentClockOffset() > maxClockOffsetMs {
        panic("Clock offset exceeded maximum, terminating node")
    }

    return store.CommitTransaction(txn)
}

// Automatic retry logic
func ExecuteTransaction(fn func(*Transaction) error) error {
    maxRetries := 3
    for i := 0; i < maxRetries; i++ {
        txn := NewTransaction()

        err := fn(txn)
        if err == nil {
            return txn.Commit()
        }

        if _, ok := err.(ErrUncertainty); ok {
            // Retry with bumped timestamp
            continue
        }

        return err  // Non-uncertainty error
    }
    return errors.New("transaction exceeded retry limit")
}
```

### Key Takeaway
Uncertainty intervals provide serializable isolation without atomic clocks by:
- Discovering transaction timestamps during execution
- Restarting reads when encountering uncertain values
- Keeping bounded retries (max clock offset / average latency)
- Trading occasional read latency (e.g., 2ms → 4ms) for commodity hardware

Contrast with Spanner's approach: Spanner waits after writes (7ms for atomic clock uncertainty), CockroachDB restarts reads (0-250ms window with NTP).

---

## 9. Causality Tokens Pattern

### Description
Explicit causal ordering mechanism for related transactions. A token captures the maximum timestamp observed during a transaction and is passed between causally-related actors to enforce ordering guarantees. This provides a lightweight way to maintain causality without full vector clocks.

### Implementation Example
```python
# Solution: Causality tokens for causal ordering
class CausalityToken:
    def __init__(self, timestamp=0, node_id=None):
        self.timestamp = timestamp
        self.node_id = node_id

    def merge(self, other):
        """Merge with another causality token"""
        return CausalityToken(
            timestamp=max(self.timestamp, other.timestamp),
            node_id=self.node_id
        )

class DistributedStore:
    def __init__(self, node_id):
        self.node_id = node_id
        self.local_timestamp = 0

    def read(self, key, causality_token=None):
        """Read with causality tracking"""
        if causality_token:
            # Advance local clock to respect causality
            self.local_timestamp = max(
                self.local_timestamp,
                causality_token.timestamp
            )

        value, value_timestamp = self.storage.get(key)

        # Update causality token with observed timestamp
        new_token = CausalityToken(
            timestamp=max(self.local_timestamp, value_timestamp),
            node_id=self.node_id
        )

        return value, new_token

    def write(self, key, value, causality_token=None):
        """Write with causality enforcement"""
        if causality_token:
            # Ensure write timestamp is after causal dependencies
            self.local_timestamp = max(
                self.local_timestamp,
                causality_token.timestamp
            ) + 1
        else:
            self.local_timestamp += 1

        self.storage.put(key, value, self.local_timestamp)

        return CausalityToken(
            timestamp=self.local_timestamp,
            node_id=self.node_id
        )

# Usage example
store = DistributedStore(node_id="node_1")

# Transaction 1: Read then write
value1, token1 = store.read("counter")  # Returns token with ts=10
token2 = store.write("counter", value1 + 1, token1)  # Writes at ts=11

# Transaction 2: Causally dependent write
# External process passes token2 to ensure ordering
store = DistributedStore(node_id="node_2")
token3 = store.write("related_key", "dependent_value", token2)  # ts >= 12

# Transaction 3: Independent write (no token passed)
store.write("other_key", "value")  # No causal ordering with above
```

### Key Takeaway
Causality tokens provide explicit causal ordering for directly related transactions without the overhead of vector clocks. Limitations:
- Only handles direct causal chains (A→B→C)
- Independent causal chains remain unordered
- Requires application-level token passing
- More lightweight than full vector clocks but less complete

Use causality tokens when:
- Application has explicit request/response chains
- Full vector clocks are too heavyweight
- Serializability is sufficient (don't need strict serializability)

---

## 10. The Network is Reliable Fallacy

### Description
Assuming network connections always work without failure. Networks experience packet loss, connection drops, routing failures, and transient partitions. Systems must implement retry logic, acknowledgments, timeouts, and graceful degradation.

### Bad Code Example
```typescript
// Anti-pattern: No retry or error handling
async function updateUserProfile(userId: string, data: object) {
    // Assumes network call succeeds
    const response = await fetch(`https://api.example.com/users/${userId}`, {
        method: 'PUT',
        body: JSON.stringify(data)
    });

    return response.json();  // What if network fails? Response is 5xx? Timeout?
}

// Result: Silent failures, data loss, inconsistent state
```

### Good Code Example
```typescript
// Solution: Retry with exponential backoff, circuit breaker, timeouts
class NetworkError extends Error {
    constructor(message: string, public readonly retryable: boolean) {
        super(message);
    }
}

async function updateUserProfile(
    userId: string,
    data: object,
    options = { maxRetries: 3, timeoutMs: 5000 }
): Promise<any> {
    let lastError: Error;

    for (let attempt = 0; attempt <= options.maxRetries; attempt++) {
        try {
            // AbortController for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(
                () => controller.abort(),
                options.timeoutMs
            );

            const response = await fetch(
                `https://api.example.com/users/${userId}`,
                {
                    method: 'PUT',
                    body: JSON.stringify(data),
                    signal: controller.signal,
                    headers: {
                        'Idempotency-Key': generateIdempotencyKey(userId, data)
                    }
                }
            );

            clearTimeout(timeoutId);

            // Check response status
            if (response.ok) {
                return response.json();
            }

            // Determine if retryable
            if (response.status >= 500 || response.status === 429) {
                // Server error or rate limit - retry with backoff
                throw new NetworkError(
                    `Server error: ${response.status}`,
                    true
                );
            } else if (response.status >= 400) {
                // Client error - don't retry
                throw new NetworkError(
                    `Client error: ${response.status}`,
                    false
                );
            }

        } catch (error) {
            lastError = error;

            // Abort signal (timeout)
            if (error.name === 'AbortError') {
                console.log(`Attempt ${attempt + 1} timed out`);
                lastError = new NetworkError('Request timeout', true);
            }

            // Network failure
            if (error instanceof TypeError) {
                console.log(`Attempt ${attempt + 1} network failure`);
                lastError = new NetworkError('Network failure', true);
            }

            // Check if retryable
            if (lastError instanceof NetworkError && !lastError.retryable) {
                throw lastError;  // Don't retry client errors
            }

            // Exponential backoff before retry
            if (attempt < options.maxRetries) {
                const backoffMs = Math.min(1000 * Math.pow(2, attempt), 10000);
                const jitter = Math.random() * 1000;  // Add jitter to prevent thundering herd
                await sleep(backoffMs + jitter);
                console.log(`Retrying attempt ${attempt + 2}...`);
            }
        }
    }

    // All retries exhausted
    throw new Error(`Failed after ${options.maxRetries + 1} attempts: ${lastError.message}`);
}

function generateIdempotencyKey(userId: string, data: object): string {
    // Hash of user ID + data to ensure idempotent retries
    return crypto.createHash('sha256')
        .update(userId + JSON.stringify(data))
        .digest('hex');
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
```

### Key Takeaway
Always assume networks are unreliable:
- Implement retries with exponential backoff and jitter
- Set explicit timeouts on all network operations
- Use idempotency keys to make retries safe
- Distinguish retryable errors (5xx, timeouts) from non-retryable (4xx)
- Add circuit breakers to prevent cascading failures
- Monitor retry rates and success rates
- Implement graceful degradation (caching, stale data, default values)

---

## 11. Serializability vs. Linearizability vs. External Consistency

### Description
Understanding the distinctions between consistency models is critical for choosing appropriate clock synchronization strategies. These models represent increasingly strict ordering guarantees.

### Consistency Models Explained

```text
Serializability:
- Transactions appear to execute in some serial order
- No guarantee that order matches real-time causality
- Local consistency within database
- Can be achieved with logical clocks or MVCC

Linearizability:
- Operations appear to execute atomically at some point between invocation and response
- Global total order matching real-time
- External consistency for single objects
- Requires clock coordination or consensus

External Consistency (Strict Serializability):
- Serializability + Linearizability
- If T1 commits before T2 starts in real-time, T2 sees T1's effects
- Global total order matching real-world causality
- Requires knowledge of all nodes' commit times
```

### Implementation Trade-offs

```python
# Example: Different consistency models

# 1. Serializability (Snapshot Isolation with MVCC)
class MVCCDatabase:
    def begin_transaction(self):
        # Transaction reads from snapshot at start time
        return Transaction(snapshot_version=self.latest_version)

    def commit(self, txn):
        # Check for write conflicts only
        if self.has_write_conflict(txn):
            raise ConflictError("Write-write conflict detected")

        # Assign next version (logical timestamp)
        txn.commit_version = self.next_version()
        self.apply_writes(txn)

    # Guarantees: Transactions are isolated
    # Limitation: T1 completes before T2 starts, but T2 might not see T1's writes
    #             if their snapshot versions aren't ordered correctly

# 2. Linearizability (Consensus-based)
class LinearizableRegister:
    def write(self, value):
        # Use Raft/Paxos to ensure total order
        proposal_number = self.next_proposal_number()

        # Phase 1: Prepare (get promise from majority)
        promises = self.send_prepare(proposal_number)

        # Phase 2: Accept (write to majority)
        if self.send_accept(proposal_number, value):
            return True
        return False

    def read(self):
        # Read from majority to ensure latest committed value
        values = self.read_from_majority()
        return self.select_latest_value(values)

    # Guarantees: All operations have total order matching real-time
    # Cost: Requires majority quorum for reads and writes

# 3. External Consistency (Spanner-style with TrueTime)
class ExternallyConsistentDB:
    def commit(self, txn):
        # Choose commit timestamp from TrueTime
        earliest = self.truetime.now().earliest
        latest = self.truetime.now().latest

        commit_ts = latest
        txn.commit_timestamp = commit_ts

        # Wait out uncertainty interval
        uncertainty_ns = latest - earliest
        time.sleep(uncertainty_ns / 1_000_000_000)

        # Now commit - guaranteed no future transaction has earlier timestamp
        self.apply_writes(txn)

    # Guarantees: External consistency - real-time ordering preserved
    # Cost: Wait out clock uncertainty on every write (~7ms for atomic clocks)

# 4. External Consistency (CockroachDB-style with NTP)
class CockroachDBStyleTransaction:
    def read(self, key):
        value, value_ts = self.storage.get(key)

        # Check uncertainty interval
        if self.commit_ts <= value_ts <= self.uncertainty_limit:
            # Cannot determine order - restart transaction
            raise UncertaintyError("Restart with higher timestamp")

        return value

    def commit(self):
        # No wait on writes
        # Uncertainty resolved during reads via restarts
        self.storage.commit(self)

    # Guarantees: External consistency without atomic clocks
    # Cost: Occasional read restarts (bounded by max clock offset)
```

### Choosing the Right Model

```python
# Decision matrix for consistency models

def choose_consistency_model(requirements):
    """
    Serializability: Use when application controls causality
    - Single-user sessions
    - Request/response chains with causality tokens
    - Acceptable: different users see different orders

    Linearizability: Use for coordination primitives
    - Distributed locks
    - Leader election
    - Configuration management
    - Not needed for most application data

    External Consistency: Use for multi-region transactions
    - Financial systems
    - Multi-region databases with causal dependencies
    - Audit logs requiring global order
    """

    if requirements.has_single_object_coordination:
        return "Linearizability (Raft/Paxos)"

    if requirements.has_global_causality_needs:
        if requirements.has_atomic_clocks:
            return "External Consistency (Spanner/TrueTime)"
        else:
            return "External Consistency (CockroachDB/Uncertainty)"

    if requirements.has_causal_dependencies:
        return "Serializability + Causality Tokens"

    return "Serializability (MVCC/Snapshot Isolation)"
```

### Key Takeaway
Choose consistency model based on actual requirements:
- **Serializability**: Sufficient for most applications; use logical clocks
- **Linearizability**: For coordination primitives; use consensus (Raft/Paxos)
- **External Consistency**: For global real-time ordering; use TrueTime or uncertainty intervals

Don't pay for stronger guarantees than needed. Most applications need serializability with causality tokens, not full external consistency.

---

## Summary: Quick Reference Guide

| Pattern/Anti-Pattern | Problem | Solution |
|---------------------|---------|----------|
| Wall Clock Reliance | Clocks jump backward, violate ordering | Use Lamport/vector clocks or HLC |
| Cross-Node Clock Skew | LWW destroys causally-later writes | Hybrid Logical Clocks or vector clocks |
| Tombstone Deletion Horizon | Deletes block future writes for hours/days | Version vectors with causal context |
| NTP Assumptions | Clock drift despite NTP | Monitor skew, use fencing tokens |
| Latency is Zero | Cascade delays, timeouts | Parallel execution, explicit timeouts |
| Task Expiration | Wall-clock deadlines fail across nodes | Relative timeouts, idempotent ops |
| ACK Timeout Redelivery | Duplicates during slow processing | Idempotency with deduplication IDs |
| Uncertainty Intervals | Clock skew without atomic clocks | Restart reads in uncertainty window |
| Causality Tokens | Ordering related transactions | Pass max timestamp between operations |
| Network Reliability | Silent failures, data loss | Retries, timeouts, circuit breakers |

### Best Practices Summary

1. **Never use wall clocks for ordering** - Use logical clocks (Lamport, vector, HLC)
2. **NTP is necessary but insufficient** - Monitor skew, self-terminate if exceeded
3. **Design for idempotency** - Use deduplication IDs for safe retries
4. **Set explicit timeouts** - All network operations need bounded waiting
5. **Choose consistency model carefully** - Don't over-specify (serializability usually sufficient)
6. **Monitor clock offset continuously** - Detect and respond to drift proactively
7. **Use relative timeouts** - Prefer monotonic clocks over absolute deadlines
8. **Implement retry with backoff** - Exponential backoff + jitter prevents thundering herd
9. **Embrace uncertainty** - Either wait it out (Spanner) or restart (CockroachDB)
10. **Pass causality explicitly** - Use tokens when causal ordering matters

---

## References and Further Reading

- **Kyle Kingsbury (Aphyr)**: "The Trouble with Timestamps" - Comprehensive analysis of timestamp-based ordering issues in Cassandra and Riak
- **Peter Deutsch & James Gosling**: "Eight Fallacies of Distributed Computing" - Foundational fallacies including network reliability and latency assumptions
- **Marc Brooker**: Various blog posts on timeouts, metastability, and distributed systems reliability
- **CockroachDB Engineering Blog**: "Living Without Atomic Clocks" - Uncertainty intervals approach to external consistency without specialized hardware
- **Google Spanner Paper**: TrueTime API using atomic clocks for linearizability
- **Leslie Lamport**: "Time, Clocks, and the Ordering of Events in a Distributed System" - Foundational paper on logical clocks

This knowledge base is designed for one-shot LLM training to recognize and avoid time-related anti-patterns in distributed systems code reviews and design discussions.
