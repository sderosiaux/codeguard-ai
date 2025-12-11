# Distributed Storage and Replication Anti-Patterns

This document catalogs common anti-patterns, pitfalls, and solutions for distributed storage systems and data replication. Use this as a reference for identifying problematic code patterns in distributed systems.

---

## 1. Split-Brain Syndrome

### Description
Split-brain occurs when a distributed system has two or more active leaders due to network partitions. Nodes diverge from each other and have conflicts when handling incoming operations. Both partitions incorrectly think the other is offline and continue accepting writes independently, leading to data inconsistencies or corruption.

### Bad Code Example

```python
# Anti-pattern: No quorum check before accepting writes
class ReplicaNode:
    def handle_write(self, key, value):
        # Dangerous: accepts write without checking cluster majority
        if self.is_primary:
            self.data[key] = value
            self.replicate_async(key, value)
            return {"status": "success"}
        else:
            return {"status": "error", "msg": "not primary"}

    def on_heartbeat_timeout(self):
        # Dangerous: promotes itself without consensus
        self.is_primary = True
        print("No heartbeat detected. Promoting self to primary.")
```

### Good Code Example

```python
# Solution: Quorum-based approach with consensus
class ReplicaNode:
    def handle_write(self, key, value):
        if not self.is_primary:
            return {"status": "error", "msg": "not primary"}

        # Check if we have quorum before accepting write
        if not self.has_quorum():
            return {"status": "error", "msg": "no quorum available"}

        # Replicate to majority before confirming
        replicas_acked = self.replicate_to_majority(key, value)
        if replicas_acked >= (self.cluster_size // 2 + 1):
            self.data[key] = value
            return {"status": "success"}
        else:
            return {"status": "error", "msg": "quorum not reached"}

    def on_heartbeat_timeout(self):
        # Request election, don't self-promote
        self.request_election()

    def has_quorum(self):
        reachable_nodes = len(self.get_reachable_nodes())
        return reachable_nodes >= (self.cluster_size // 2 + 1)
```

### Key Takeaway
Always use quorum-based consensus (odd number of nodes) and require majority acknowledgment before confirming writes. Never allow self-promotion to leader without cluster consensus. Implement proper leader election algorithms (Raft, Paxos) to prevent multiple active leaders.

---

## 2. Lost Update Problem

### Description
Lost updates occur when two or more clients try to update the same data item concurrently, causing one update to overwrite another without awareness of the conflict. In distributed systems with replication lag, this is especially problematic when updates hit different replicas.

### Bad Code Example

```javascript
// Anti-pattern: Read-modify-write without version checking
async function updateCartItem(userId, itemId, quantity) {
  // Read current cart
  const cart = await db.get(`cart:${userId}`);

  // Modify locally
  cart.items[itemId] = quantity;

  // Write back (dangerous: no conflict detection)
  await db.set(`cart:${userId}`, cart);

  return cart;
}

// Scenario:
// T1: User adds costume (quantity=1)
// T2: User adds mask (quantity=1)
// Result: One of the items is lost due to overwrite
```

### Good Code Example

```javascript
// Solution 1: Optimistic Concurrency Control with versioning
async function updateCartItem(userId, itemId, quantity) {
  let retries = 3;

  while (retries > 0) {
    // Read with version
    const { cart, version } = await db.getWithVersion(`cart:${userId}`);

    // Modify locally
    cart.items[itemId] = quantity;

    // Conditional write: only succeeds if version matches
    const success = await db.setIfVersion(`cart:${userId}`, cart, version);

    if (success) {
      return cart;
    }

    // Conflict detected, retry with exponential backoff
    retries--;
    await sleep(Math.pow(2, 3 - retries) * 100);
  }

  throw new Error("Failed to update cart after retries");
}

// Solution 2: CRDT approach (conflict-free)
class CartCRDT {
  constructor() {
    this.items = new Map(); // itemId -> {quantity, timestamp, nodeId}
  }

  addItem(itemId, quantity, timestamp, nodeId) {
    // Use add-wins semantics: merge by addition
    const current = this.items.get(itemId) || { quantity: 0 };
    this.items.set(itemId, {
      quantity: current.quantity + quantity,
      lastModified: Math.max(current.lastModified || 0, timestamp),
      nodeId
    });
  }

  merge(otherCart) {
    // Merge without conflicts
    for (const [itemId, item] of otherCart.items) {
      const current = this.items.get(itemId);
      if (!current || item.lastModified > current.lastModified) {
        this.items.set(itemId, item);
      }
    }
  }
}
```

### Key Takeaway
Never perform read-modify-write operations without conflict detection. Use optimistic concurrency control with version numbers or ETags, implement retry logic with exponential backoff, or use CRDTs for conflict-free semantics. For critical operations, consider pessimistic locking or serializable isolation levels.

---

## 3. Last-Write-Wins Timestamp Pitfalls

### Description
Last-Write-Wins (LWW) resolution uses timestamps to determine which write should win in a conflict. However, relying on system time is fundamentally flawed: clocks drift (0.001% error = 1 second/day), can move backwards during NTP sync, and users can manually change them. This leads to causally later events being overwritten by earlier ones.

### Bad Code Example

```go
// Anti-pattern: Naive LWW using system time
type Document struct {
    Content   string
    Timestamp int64  // System timestamp in milliseconds
}

func (d *Document) Merge(other *Document) {
    // Dangerous: trusts system time
    if other.Timestamp > d.Timestamp {
        d.Content = other.Content
        d.Timestamp = other.Timestamp
    }
    // Silent data loss if clocks are skewed
}

// Scenario:
// Node A (clock ahead): writes "version 2" at T=1000
// Node B (clock behind): writes "version 3" at T=999
// Result: "version 3" is lost because timestamp is lower
```

### Good Code Example

```go
// Solution 1: Hybrid Logical Clock (HLC)
type HybridTimestamp struct {
    WallTime  int64  // Physical time component
    LogicalTime int64  // Logical counter for same wall time
    NodeID    string // Tie-breaker
}

func (ht *HybridTimestamp) Compare(other *HybridTimestamp) int {
    if ht.WallTime != other.WallTime {
        return cmp(ht.WallTime, other.WallTime)
    }
    if ht.LogicalTime != other.LogicalTime {
        return cmp(ht.LogicalTime, other.LogicalTime)
    }
    return strings.Compare(ht.NodeID, other.NodeID)
}

type Document struct {
    Content   string
    Timestamp HybridTimestamp
}

func (d *Document) Merge(other *Document) {
    if d.Timestamp.Compare(&other.Timestamp) < 0 {
        d.Content = other.Content
        d.Timestamp = other.Timestamp
    }
}

// Solution 2: Vector clocks for causality tracking
type VectorClock map[string]int64 // nodeId -> counter

func (vc VectorClock) HappensBefore(other VectorClock) bool {
    hasSmaller := false
    for nodeId, count := range vc {
        otherCount := other[nodeId]
        if count > otherCount {
            return false
        }
        if count < otherCount {
            hasSmaller = true
        }
    }
    return hasSmaller
}

func (vc VectorClock) IsConcurrent(other VectorClock) bool {
    return !vc.HappensBefore(other) && !other.HappensBefore(vc)
}
```

### Key Takeaway
Never use system time alone for conflict resolution. System clocks are unreliable in distributed systems. Use hybrid logical clocks (HLC) for ordering with tie-breakers, or vector clocks to detect causality and concurrent updates. Always include a deterministic tie-breaker (like node ID) for identical timestamps.

---

## 4. Read-After-Write Inconsistency

### Description
In eventually consistent systems, a client may write data to one replica but read from another replica that hasn't received the update yet. This violates user expectations where their own writes should be immediately visible, leading to confusing behavior like adding an item to a cart and not seeing it on refresh.

### Bad Code Example

```python
# Anti-pattern: Random replica selection for reads
class DistributedStore:
    def write(self, key, value):
        # Write to primary
        primary = self.get_primary_replica()
        primary.set(key, value)

        # Async replication to followers
        self.replicate_async(key, value)
        return {"status": "ok"}

    def read(self, key):
        # Dangerous: might read from stale replica
        replica = random.choice(self.all_replicas)
        return replica.get(key)

# User scenario:
# 1. POST /cart/add-item (writes to primary in US-East)
# 2. GET /cart (reads from replica in US-West, not yet replicated)
# 3. Result: Item appears missing
```

### Good Code Example

```python
# Solution 1: Read-your-writes consistency with session tracking
class SessionAwareStore:
    def write(self, key, value, session_id):
        primary = self.get_primary_replica()
        version = primary.set(key, value)

        # Track write version in session
        self.session_store.set_last_write(session_id, key, version)

        self.replicate_async(key, value, version)
        return {"status": "ok", "version": version}

    def read(self, key, session_id):
        last_write_version = self.session_store.get_last_write(session_id, key)

        if last_write_version:
            # Must read from replica with at least this version
            replica = self.find_replica_with_version(last_write_version)
            if not replica:
                # Fallback to primary if no replica is caught up
                replica = self.get_primary_replica()
        else:
            # No previous write in this session, any replica is fine
            replica = self.get_nearest_replica()

        return replica.get(key)

# Solution 2: Monotonic reads with sticky sessions
class MonotonicStore:
    def __init__(self):
        self.replica_versions = {}  # replica_id -> version

    def read(self, key, session_id):
        # Always read from same replica for this session
        replica_id = self.session_to_replica.get(session_id)

        if not replica_id:
            # First read: select replica and pin session to it
            replica_id = self.select_replica()
            self.session_to_replica[session_id] = replica_id

        replica = self.get_replica(replica_id)
        return replica.get(key)

    def write(self, key, value, session_id):
        primary = self.get_primary_replica()
        version = primary.set(key, value)

        # Ensure pinned replica catches up before next read
        replica_id = self.session_to_replica.get(session_id)
        if replica_id:
            self.wait_for_replication(replica_id, version, timeout=1.0)

        return {"status": "ok", "version": version}
```

### Key Takeaway
Implement read-your-writes consistency by tracking write versions per session and routing reads to sufficiently up-to-date replicas. Use sticky sessions to ensure monotonic reads (never seeing older data after seeing newer data). Consider synchronous replication to a subset of replicas for strong read-after-write guarantees.

---

## 5. Concurrent Write Conflicts Without Consensus

### Description
In multi-active (multi-master) replication, accepting writes at multiple nodes without coordination leads to conflicting updates. Without proper consensus mechanisms, the system cannot determine the correct order of operations, resulting in divergent state across replicas.

### Bad Code Example

```ruby
# Anti-pattern: Multi-master without conflict resolution
class MultiMasterDB
  def write(key, value)
    # Each master accepts writes independently
    @local_store[key] = value
    @version_counter += 1

    # Async replication to other masters
    other_masters.each do |master|
      master.async_replicate(key, value, @version_counter)
    end

    return :ok
  end

  def async_replicate(key, value, remote_version)
    # Dangerous: blindly overwrites without conflict detection
    if remote_version > @local_version[key]
      @local_store[key] = value
      @local_version[key] = remote_version
    end
    # Silent conflicts: concurrent writes with same version are lost
  end
end

# Scenario:
# Master A: UPDATE account SET balance = balance - 100 (withdrawal)
# Master B: UPDATE account SET balance = balance + 50 (deposit)
# Result: One operation is lost, balance is incorrect
```

### Good Code Example

```ruby
# Solution 1: Single-writer principle per key range
class PartitionedDB
  def initialize(node_id, num_partitions)
    @node_id = node_id
    @num_partitions = num_partitions
  end

  def write(key, value)
    partition = hash(key) % @num_partitions
    primary_node = partition % @total_nodes

    if primary_node != @node_id
      # Forward write to correct primary
      return forward_to_primary(primary_node, key, value)
    end

    # This node is the single writer for this key
    version = @version_counter += 1
    @local_store[key] = {value: value, version: version}

    # Replicate to followers (not other primaries)
    replicate_to_followers(key, value, version)

    return :ok
  end
end

# Solution 2: Consensus-based writes (Raft/Paxos)
class ConsensusDB
  def write(key, value)
    unless leader?
      return forward_to_leader(key, value)
    end

    # Leader proposes write to cluster
    log_entry = {
      term: @current_term,
      index: @log.size,
      command: {op: :write, key: key, value: value}
    }

    @log.append(log_entry)

    # Replicate to majority before committing
    acks = replicate_to_followers(log_entry)

    if acks >= majority_size
      # Safe to commit after majority acknowledgment
      apply_to_state_machine(log_entry)
      return :ok
    else
      # Could not reach consensus
      rollback(log_entry)
      return :error_no_quorum
    end
  end

  def majority_size
    (@cluster_size / 2) + 1
  end
end

# Solution 3: CRDT for commutativity
class CRDTCounter
  attr_reader :increments, :decrements

  def initialize(node_id)
    @node_id = node_id
    @increments = Hash.new(0)  # node_id -> count
    @decrements = Hash.new(0)  # node_id -> count
  end

  def increment(amount)
    @increments[@node_id] += amount
  end

  def decrement(amount)
    @decrements[@node_id] += amount
  end

  def value
    @increments.values.sum - @decrements.values.sum
  end

  def merge(other)
    # Commutative and idempotent merge
    other.increments.each do |node_id, count|
      @increments[node_id] = [@increments[node_id], count].max
    end
    other.decrements.each do |node_id, count|
      @decrements[node_id] = [@decrements[node_id], count].max
    end
  end
end
```

### Key Takeaway
Never accept writes on multiple nodes for the same data without coordination. Use single-writer principle (partition keys across nodes), implement consensus protocols (Raft/Paxos) for strongly consistent writes, or use CRDTs for operations that are commutative and associative. Multi-master replication requires explicit conflict resolution strategies.

---

## 6. CRDT Metadata Overhead and Performance Issues

### Description
CRDTs eliminate conflicts but accumulate metadata for every operation, leading to unbounded growth. Naive CRDT implementations have terrible performance: metadata grows without bounds, tombstones for deletions are never removed, and operations become O(n) complexity. This makes simple CRDTs impractical for production use.

### Bad Code Example

```javascript
// Anti-pattern: Naive CRDT with unbounded growth
class NaiveORSet {
  constructor() {
    this.elements = new Map(); // element -> Set of unique add tags
    this.tombstones = new Set(); // removed element tags (never cleaned)
  }

  add(element, uniqueTag) {
    if (!this.elements.has(element)) {
      this.elements.set(element, new Set());
    }
    this.elements.get(element).add(uniqueTag);
  }

  remove(element) {
    // Dangerous: tombstones grow forever
    const tags = this.elements.get(element);
    if (tags) {
      tags.forEach(tag => this.tombstones.add(tag));
    }
  }

  has(element) {
    const tags = this.elements.get(element);
    if (!tags) return false;

    // O(n) operation: check each tag against tombstones
    for (const tag of tags) {
      if (!this.tombstones.has(tag)) {
        return true;
      }
    }
    return false;
  }

  merge(other) {
    // Metadata grows without bound
    other.elements.forEach((tags, element) => {
      if (!this.elements.has(element)) {
        this.elements.set(element, new Set());
      }
      tags.forEach(tag => this.elements.get(element).add(tag));
    });

    other.tombstones.forEach(tag => this.tombstones.add(tag));
  }
}

// Problem: After millions of operations, metadata dwarfs actual data
```

### Good Code Example

```javascript
// Solution: Optimized CRDT with garbage collection
class OptimizedORSet {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.elements = new Map(); // element -> {tags: Set, version: number}
    this.clock = 0;
    this.gcThreshold = 1000; // Trigger GC after 1000 operations
    this.opCount = 0;
  }

  add(element) {
    const tag = `${this.nodeId}:${this.clock++}`;

    if (!this.elements.has(element)) {
      this.elements.set(element, {
        tags: new Set([tag]),
        version: this.clock
      });
    } else {
      const entry = this.elements.get(element);
      entry.tags.add(tag);
      entry.version = this.clock;
    }

    this.maybeGarbageCollect();
    return tag;
  }

  remove(element) {
    // Instead of keeping tombstones, mark for removal
    this.elements.delete(element);
    this.clock++;
    this.maybeGarbageCollect();
  }

  merge(other) {
    other.elements.forEach((otherEntry, element) => {
      const localEntry = this.elements.get(element);

      if (!localEntry) {
        // New element from other replica
        this.elements.set(element, {
          tags: new Set(otherEntry.tags),
          version: otherEntry.version
        });
      } else {
        // Merge tags, keeping only recent ones
        const allTags = new Set([...localEntry.tags, ...otherEntry.tags]);
        const maxVersion = Math.max(localEntry.version, otherEntry.version);

        // Garbage collect old tags during merge
        if (allTags.size > 10) {
          // Keep only most recent tags
          const sortedTags = Array.from(allTags).sort();
          this.elements.set(element, {
            tags: new Set(sortedTags.slice(-5)),
            version: maxVersion
          });
        } else {
          localEntry.tags = allTags;
          localEntry.version = maxVersion;
        }
      }
    });

    this.clock = Math.max(this.clock, other.clock) + 1;
  }

  maybeGarbageCollect() {
    this.opCount++;
    if (this.opCount >= this.gcThreshold) {
      this.garbageCollect();
      this.opCount = 0;
    }
  }

  garbageCollect() {
    // Remove entries with very old versions
    const cutoffVersion = this.clock - 10000;

    for (const [element, entry] of this.elements) {
      if (entry.version < cutoffVersion) {
        // Compact: keep only one tag for old entries
        entry.tags = new Set([entry.tags.values().next().value]);
      }
    }
  }

  // Serialize efficiently (columnar encoding)
  toCompactFormat() {
    const elements = [];
    const versions = [];
    const tagCounts = [];
    const allTags = [];

    for (const [element, entry] of this.elements) {
      elements.push(element);
      versions.push(entry.version);
      tagCounts.push(entry.tags.size);
      allTags.push(...entry.tags);
    }

    return {
      elements,
      versions,
      tagCounts,
      tags: allTags
    };
  }
}
```

### Key Takeaway
Never use naive CRDT implementations in production. Implement garbage collection strategies to prune old metadata, use compaction techniques to reduce storage overhead, and employ efficient encoding (columnar formats) for serialization. Consider delta-state CRDTs that only transmit changes. Be aware that "simple" CRDT algorithms from papers often have performance problems at scale.

---

## 7. Eventual Consistency Anomalies: Multi-Key Operations

### Description
Eventual consistency guarantees that replicas converge if writes stop, but makes no promises about operation ordering. This causes anomalies in multi-key operations where updates to different keys arrive at different times. Users may see partial states that never actually existed, violating application invariants.

### Bad Code Example

```java
// Anti-pattern: Multi-key updates without coordination
public class BankAccount {
    private EventuallyConsistentStore store;

    // Dangerous: transfer is not atomic across keys
    public void transfer(String fromAccount, String toAccount, double amount) {
        // These are two separate operations
        double fromBalance = store.get("balance:" + fromAccount);
        double toBalance = store.get("balance:" + toAccount);

        // Update both accounts independently
        store.put("balance:" + fromAccount, fromBalance - amount);
        store.put("balance:" + toAccount, toBalance + amount);

        // Problem: Updates replicate independently
        // Observers may see: money deducted but not yet credited (lost money!)
        // Or: money credited but not yet deducted (money created!)
    }

    public double getTotalBalance(List<String> accounts) {
        // Dangerous: reads from different replicas at different times
        return accounts.stream()
            .mapToDouble(acc -> store.get("balance:" + acc))
            .sum();
        // May see inconsistent snapshot violating invariants
    }
}
```

### Good Code Example

```java
// Solution 1: Single-key design (denormalization)
public class BankAccountV2 {
    private EventuallyConsistentStore store;

    // Store transfer as a single entity
    public void transfer(String fromAccount, String toAccount, double amount) {
        String transferId = UUID.randomUUID().toString();

        Transfer transfer = new Transfer(
            transferId,
            fromAccount,
            toAccount,
            amount,
            System.currentTimeMillis(),
            TransferStatus.PENDING
        );

        // Single atomic write
        store.put("transfer:" + transferId, transfer);

        // Process asynchronously with idempotency
        scheduleTransferProcessing(transferId);
    }

    public void processTransfer(String transferId) {
        Transfer transfer = store.get("transfer:" + transferId);

        if (transfer.status == TransferStatus.COMPLETED) {
            return; // Idempotent: already processed
        }

        // Use CRDT counters for accounts
        CRDTCounter fromAccount = store.get("balance:" + transfer.from);
        CRDTCounter toAccount = store.get("balance:" + transfer.to);

        fromAccount.decrement(transfer.amount);
        toAccount.increment(transfer.amount);

        store.put("balance:" + transfer.from, fromAccount);
        store.put("balance:" + transfer.to, toAccount);

        transfer.status = TransferStatus.COMPLETED;
        store.put("transfer:" + transferId, transfer);
    }
}

// Solution 2: Strongly consistent coordination service for critical paths
public class BankAccountV3 {
    private EventuallyConsistentStore dataStore;
    private StronglyConsistentStore coordinationStore; // e.g., etcd, ZooKeeper

    public void transfer(String fromAccount, String toAccount, double amount) {
        // Use coordination service for multi-key transaction
        Transaction txn = coordinationStore.beginTransaction();

        try {
            // Read with consistency
            double fromBalance = txn.get("balance:" + fromAccount);
            double toBalance = txn.get("balance:" + toAccount);

            if (fromBalance < amount) {
                txn.abort();
                throw new InsufficientFundsException();
            }

            // Write atomically
            txn.put("balance:" + fromAccount, fromBalance - amount);
            txn.put("balance:" + toAccount, toBalance + amount);

            // Commit ensures atomicity
            txn.commit();

            // Async replicate to eventually consistent stores
            asyncReplicateToDataStore(fromAccount, fromBalance - amount);
            asyncReplicateToDataStore(toAccount, toBalance + amount);

        } catch (Exception e) {
            txn.abort();
            throw e;
        }
    }

    public double getTotalBalance(List<String> accounts) {
        // Read from coordination store for consistent snapshot
        return coordinationStore.snapshotRead(accounts).stream()
            .mapToDouble(balance -> balance)
            .sum();
    }
}

// Solution 3: Causal consistency with version vectors
public class CausallyConsistentStore {
    private Map<String, Versioned<Double>> data;
    private VectorClock clock;

    public void transferWithCausality(String from, String to, double amount) {
        // Read with causal context
        Versioned<Double> fromVal = this.get(from);
        Versioned<Double> toVal = this.get(to);

        // Update local clock
        clock.increment(nodeId);

        // Writes include causality information
        VectorClock fromClock = fromVal.version.increment(nodeId);
        VectorClock toClock = toVal.version.increment(nodeId);

        // Ensure 'to' write depends on 'from' write
        toClock.merge(fromClock);

        put(from, fromVal.value - amount, fromClock);
        put(to, toVal.value + amount, toClock);

        // Replicas will respect causality when applying updates
    }
}
```

### Key Takeaway
Avoid multi-key operations with eventual consistency. Either: (1) denormalize to single-key design, (2) use strongly consistent coordination for critical multi-key operations, (3) implement causal consistency to preserve happens-before relationships, or (4) design idempotent operations that can be safely retried. Never assume atomicity across keys in eventually consistent systems.

---

## 8. Raft/Paxos Single Leader Bottleneck

### Description
Consensus algorithms like Raft use a single-leader model where all writes must go through one elected leader. While this ensures strong consistency and linearizability, it creates a single point of failure and a performance bottleneck. If the leader becomes slow or unavailable, the entire system stops making progress until a new leader is elected.

### Bad Code Example

```python
# Anti-pattern: Blocking all operations on single leader
class NaiveRaftNode:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.is_leader = False
        self.state = {}

    def handle_request(self, operation):
        # Dangerous: all operations block on leader
        if not self.is_leader:
            # Client must retry with correct leader
            leader = self.get_current_leader()
            raise NotLeaderException(f"Redirect to {leader}")

        # All reads AND writes go through leader (inefficient)
        log_entry = self.append_to_log(operation)

        # Synchronously wait for majority (blocks entire system)
        acks = self.replicate_and_wait(log_entry)

        if acks < self.majority():
            raise QuorumException("Could not reach majority")

        # Apply to state machine
        result = self.apply(operation)
        return result

    def read(self, key):
        # Anti-pattern: reading requires leader too
        if not self.is_leader:
            raise NotLeaderException()

        # Even reads must wait for heartbeat to confirm leadership
        if not self.confirm_leadership():
            raise LeadershipLostException()

        return self.state.get(key)
```

### Good Code Example

```python
# Solution 1: Follower reads with bounded staleness
class OptimizedRaftNode:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.is_leader = False
        self.state = {}
        self.last_applied_index = 0
        self.commit_index = 0
        self.max_staleness_ms = 5000

    def handle_write(self, operation):
        if not self.is_leader:
            # Forward to leader
            return self.forward_to_leader(operation)

        log_entry = self.append_to_log(operation)

        # Async replication with batching
        self.async_replicate_batch([log_entry])

        # Wait for majority in background
        future = self.wait_for_majority_async(log_entry)

        return future  # Client can await or poll

    def handle_read(self, key, consistency_level="eventual"):
        if consistency_level == "linearizable":
            # Must go through leader
            if not self.is_leader:
                return self.forward_to_leader({"op": "read", "key": key})

            # Leader lease: only read if recently confirmed leadership
            if not self.has_valid_lease():
                self.renew_lease()

            return self.state.get(key)

        elif consistency_level == "bounded_staleness":
            # Follower can serve if not too stale
            staleness = time.time() - self.last_heartbeat_time

            if staleness > self.max_staleness_ms / 1000:
                # Too stale, redirect to leader
                return self.forward_to_leader({"op": "read", "key": key})

            return self.state.get(key)

        elif consistency_level == "eventual":
            # Follower can always serve
            return self.state.get(key)

    def async_replicate_batch(self, log_entries):
        # Batch multiple operations for efficiency
        for peer in self.peers:
            threading.Thread(
                target=self.send_append_entries,
                args=(peer, log_entries)
            ).start()

    def has_valid_lease(self):
        # Leader lease optimization: avoid heartbeat for every read
        return (time.time() - self.last_lease_renewal) < self.lease_duration

# Solution 2: Multi-Raft for partitioning
class MultiRaftCluster:
    def __init__(self, node_id, num_shards):
        self.node_id = node_id
        self.shards = {}

        # Each shard has its own Raft group
        for shard_id in range(num_shards):
            self.shards[shard_id] = RaftGroup(
                shard_id=shard_id,
                node_id=node_id
            )

    def handle_write(self, key, value):
        # Partition key to shard
        shard_id = self.hash_key(key) % len(self.shards)
        raft_group = self.shards[shard_id]

        # Each shard has independent leader
        return raft_group.write(key, value)

    def handle_read(self, key):
        shard_id = self.hash_key(key) % len(self.shards)
        raft_group = self.shards[shard_id]

        return raft_group.read(key)

    def hash_key(self, key):
        return hash(key)

# Solution 3: Raft with pipelining and batching
class PipelinedRaft:
    def __init__(self):
        self.pending_writes = []
        self.batch_size = 100
        self.batch_timeout_ms = 10

    def write(self, key, value):
        # Add to batch
        future = Future()
        self.pending_writes.append({
            'key': key,
            'value': value,
            'future': future
        })

        # Trigger batch processing
        if len(self.pending_writes) >= self.batch_size:
            self.flush_batch()
        else:
            # Wait for timeout to batch more writes
            schedule_after(self.batch_timeout_ms, self.flush_batch)

        return future

    def flush_batch(self):
        if not self.pending_writes:
            return

        # Single Raft round for entire batch
        batch = self.pending_writes[:self.batch_size]
        self.pending_writes = self.pending_writes[self.batch_size:]

        log_entry = {
            'term': self.current_term,
            'operations': [w for w in batch]
        }

        # Replicate entire batch
        self.replicate_and_apply(log_entry, batch)
```

### Key Takeaway
Don't route all operations through a single leader. Use follower reads with bounded staleness for read-heavy workloads, implement leader leases to avoid heartbeats for every read, partition data across multiple Raft groups (multi-Raft) for horizontal scaling, and batch writes to reduce Raft rounds. Consider alternative protocols like EPaxos for leaderless coordination when appropriate.

---

## 9. Ignoring Network Partition Tolerance (CAP Theorem)

### Description
Many distributed systems are designed assuming the network is reliable, violating the CAP theorem reality that you must choose between consistency and availability during partitions. Systems that don't explicitly handle partitions will exhibit undefined behavior, potentially losing data or serving stale/incorrect results when the network fails.

### Bad Code Example

```typescript
// Anti-pattern: Assuming network is always available
class NaiveDistributedCache {
  private readonly replicas: string[];

  async set(key: string, value: any): Promise<void> {
    // Dangerous: assumes all replicas are always reachable
    const promises = this.replicas.map(replica =>
      this.httpClient.post(`http://${replica}/set`, { key, value })
    );

    // Fails if ANY replica is unreachable
    await Promise.all(promises);
    // No fallback or degradation strategy
  }

  async get(key: string): Promise<any> {
    // Assumes first replica is always available
    const replica = this.replicas[0];
    const response = await this.httpClient.get(`http://${replica}/get/${key}`);

    return response.data;
    // No retry, no fallback to other replicas
  }
}

// Scenario: Network partition splits cluster
// Result: All operations fail, system is unavailable
```

### Good Code Example

```typescript
// Solution: Explicit partition handling with tunable consistency
class PartitionAwareCache {
  private readonly replicas: string[];
  private readonly quorumSize: number;
  private readonly operationTimeout: number = 1000; // ms

  constructor(replicas: string[], consistencyLevel: 'strong' | 'eventual') {
    this.replicas = replicas;

    if (consistencyLevel === 'strong') {
      // CP: Require majority, sacrifice availability
      this.quorumSize = Math.floor(replicas.length / 2) + 1;
    } else {
      // AP: Accept any response, sacrifice consistency
      this.quorumSize = 1;
    }
  }

  async set(key: string, value: any): Promise<WriteResult> {
    const version = Date.now();
    const promises = this.replicas.map(replica =>
      this.writeToReplica(replica, key, value, version)
        .catch(error => ({ success: false, replica, error }))
    );

    // Race: return when quorum reached (don't wait for all)
    const results = await this.waitForQuorum(promises, this.quorumSize);

    const successful = results.filter(r => r.success).length;

    if (successful >= this.quorumSize) {
      return {
        status: 'success',
        replicas: successful,
        version
      };
    } else {
      // Partition detected: not enough replicas reachable
      return {
        status: 'partial_failure',
        replicas: successful,
        required: this.quorumSize,
        version
      };
    }
  }

  async get(key: string): Promise<GetResult> {
    // Read from multiple replicas in parallel
    const promises = this.replicas.map(replica =>
      this.readFromReplica(replica, key)
        .catch(() => null)
    );

    const results = await this.waitForQuorum(
      promises,
      this.quorumSize
    );

    const validResults = results.filter(r => r !== null);

    if (validResults.length === 0) {
      throw new Error('All replicas unreachable - partition detected');
    }

    // Resolve conflicts by taking latest version
    const latest = validResults.reduce((max, current) =>
      current.version > max.version ? current : max
    );

    // Read repair: propagate latest value to stale replicas
    this.asyncReadRepair(key, latest, validResults);

    return {
      value: latest.value,
      version: latest.version,
      replicas: validResults.length
    };
  }

  private async waitForQuorum<T>(
    promises: Promise<T>[],
    quorum: number
  ): Promise<T[]> {
    return new Promise((resolve) => {
      const results: T[] = [];
      let completed = 0;

      const timeout = setTimeout(() => {
        resolve(results); // Return partial results on timeout
      }, this.operationTimeout);

      promises.forEach(promise => {
        promise.then(result => {
          results.push(result);
          completed++;

          if (results.length >= quorum) {
            clearTimeout(timeout);
            resolve(results);
          }
        });
      });
    });
  }

  private async asyncReadRepair(
    key: string,
    latest: any,
    allResults: any[]
  ): Promise<void> {
    // Don't block on read repair
    const staleReplicas = allResults.filter(r =>
      r.version < latest.version
    );

    staleReplicas.forEach(stale => {
      this.writeToReplica(stale.replica, key, latest.value, latest.version)
        .catch(err => console.error('Read repair failed', err));
    });
  }

  // Health monitoring and partition detection
  private async detectPartitions(): Promise<PartitionStatus> {
    const healthChecks = await Promise.allSettled(
      this.replicas.map(r => this.pingReplica(r))
    );

    const healthy = healthChecks.filter(r =>
      r.status === 'fulfilled'
    ).length;

    if (healthy < this.quorumSize) {
      return {
        status: 'partitioned',
        healthy,
        required: this.quorumSize,
        mode: 'read-only' // Degrade gracefully
      };
    }

    return { status: 'healthy', healthy };
  }
}

// Circuit breaker pattern for partition handling
class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: 'closed' | 'open' | 'half-open' = 'closed';

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.lastFailureTime > 30000) {
        this.state = 'half-open';
      } else {
        throw new Error('Circuit breaker open - partition detected');
      }
    }

    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure();
      throw error;
    }
  }

  private onSuccess() {
    this.failures = 0;
    this.state = 'closed';
  }

  private onFailure() {
    this.failures++;
    this.lastFailureTime = Date.now();

    if (this.failures >= 5) {
      this.state = 'open'; // Stop trying, partition likely
    }
  }
}
```

### Key Takeaway
Always design for network partitions. Choose your CAP tradeoff explicitly: CP (sacrifice availability for consistency) or AP (sacrifice consistency for availability). Implement quorum-based operations with configurable consistency levels, use timeouts and circuit breakers to detect partitions quickly, and design graceful degradation strategies. Never assume the network is reliable.

---

## 10. Unbounded Replication Lag

### Description
Asynchronous replication can accumulate unbounded lag when the primary is faster than replicas can keep up, or during network congestion. Without monitoring and backpressure, replicas fall dangerously behind, leading to massive data loss if primary fails, serving extremely stale data, and making recovery time unpredictable.

### Bad Code Example

```rust
// Anti-pattern: Fire-and-forget replication with no backpressure
struct UnboundedReplication {
    replication_queue: VecDeque<LogEntry>,
    replicas: Vec<String>,
}

impl UnboundedReplication {
    fn replicate(&mut self, entry: LogEntry) {
        // Dangerous: unbounded queue growth
        self.replication_queue.push_back(entry.clone());

        // Fire and forget - no flow control
        for replica in &self.replicas {
            self.async_send(replica, entry.clone());
        }

        // No monitoring of lag or queue size
    }

    fn async_send(&self, replica: &str, entry: LogEntry) {
        tokio::spawn(async move {
            // Keeps sending even if replica is overwhelmed
            let _ = Self::send_to_replica(replica, entry).await;
            // Errors ignored, no retry logic
        });
    }

    fn can_accept_write(&self) -> bool {
        // Anti-pattern: always accepts writes
        true
    }
}

// Scenario:
// 1. Primary handles 10K writes/sec
// 2. Replica can only handle 5K writes/sec
// 3. Queue grows to millions of entries
// 4. Primary crashes -> data loss
// 5. Replica needs hours to catch up
```

### Good Code Example

```rust
// Solution: Bounded replication with backpressure and monitoring
use std::sync::Arc;
use tokio::sync::Semaphore;
use std::time::{Duration, Instant};

struct BoundedReplication {
    replication_queue: VecDeque<LogEntry>,
    max_queue_size: usize,
    replicas: Vec<ReplicaState>,
    backpressure_semaphore: Arc<Semaphore>,
    max_lag_seconds: u64,
}

struct ReplicaState {
    url: String,
    last_acked_index: u64,
    lag_bytes: usize,
    last_heartbeat: Instant,
    status: ReplicaStatus,
}

enum ReplicaStatus {
    Healthy,
    Lagging,
    Failed,
}

impl BoundedReplication {
    fn new(replicas: Vec<String>, max_lag_seconds: u64) -> Self {
        Self {
            replication_queue: VecDeque::new(),
            max_queue_size: 10_000,
            replicas: replicas.into_iter().map(|url| ReplicaState {
                url,
                last_acked_index: 0,
                lag_bytes: 0,
                last_heartbeat: Instant::now(),
                status: ReplicaStatus::Healthy,
            }).collect(),
            backpressure_semaphore: Arc::new(Semaphore::new(1000)),
            max_lag_seconds,
        }
    }

    async fn replicate(&mut self, entry: LogEntry) -> Result<(), ReplicationError> {
        // Check if we should apply backpressure
        if !self.can_accept_write() {
            return Err(ReplicationError::BackpressureActive);
        }

        // Bounded queue
        if self.replication_queue.len() >= self.max_queue_size {
            return Err(ReplicationError::QueueFull);
        }

        // Acquire permit for flow control
        let permit = self.backpressure_semaphore.clone()
            .acquire_owned()
            .await
            .map_err(|_| ReplicationError::ShuttingDown)?;

        self.replication_queue.push_back(entry.clone());

        // Replicate with monitoring
        let index = entry.index;
        let mut ack_count = 0;

        for replica in &mut self.replicas {
            match self.send_with_retry(replica, &entry).await {
                Ok(_) => {
                    replica.last_acked_index = index;
                    replica.last_heartbeat = Instant::now();
                    replica.status = ReplicaStatus::Healthy;
                    ack_count += 1;
                }
                Err(e) => {
                    eprintln!("Replication to {} failed: {:?}", replica.url, e);
                    replica.status = ReplicaStatus::Failed;
                }
            }

            // Update lag metrics
            self.update_lag_metrics(replica, index);
        }

        drop(permit); // Release backpressure permit

        // Ensure minimum replication
        if ack_count < self.min_replicas_for_durability() {
            return Err(ReplicationError::InsufficientReplicas);
        }

        Ok(())
    }

    fn can_accept_write(&self) -> bool {
        // Apply backpressure if replicas are too far behind
        let max_lag = self.replicas.iter()
            .map(|r| self.calculate_lag_seconds(r))
            .max()
            .unwrap_or(0);

        if max_lag > self.max_lag_seconds {
            eprintln!("Applying backpressure: max lag {}s exceeds threshold {}s",
                     max_lag, self.max_lag_seconds);
            return false;
        }

        // Check queue size
        if self.replication_queue.len() >= self.max_queue_size * 9 / 10 {
            eprintln!("Applying backpressure: queue 90% full");
            return false;
        }

        // Check replica health
        let healthy_replicas = self.replicas.iter()
            .filter(|r| matches!(r.status, ReplicaStatus::Healthy))
            .count();

        healthy_replicas >= self.min_replicas_for_durability()
    }

    async fn send_with_retry(
        &self,
        replica: &ReplicaState,
        entry: &LogEntry
    ) -> Result<(), ReplicationError> {
        let mut retries = 3;
        let mut backoff = Duration::from_millis(100);

        loop {
            match self.send_to_replica(&replica.url, entry).await {
                Ok(_) => return Ok(()),
                Err(e) if retries > 0 => {
                    retries -= 1;
                    tokio::time::sleep(backoff).await;
                    backoff *= 2; // Exponential backoff
                }
                Err(e) => return Err(e),
            }
        }
    }

    fn update_lag_metrics(&mut self, replica: &mut ReplicaState, current_index: u64) {
        let lag_entries = current_index.saturating_sub(replica.last_acked_index);
        replica.lag_bytes = lag_entries as usize * 1024; // Estimate

        if lag_entries > 1000 {
            replica.status = ReplicaStatus::Lagging;
            eprintln!("Replica {} is lagging by {} entries",
                     replica.url, lag_entries);
        }
    }

    fn calculate_lag_seconds(&self, replica: &ReplicaState) -> u64 {
        replica.last_heartbeat.elapsed().as_secs()
    }

    fn min_replicas_for_durability(&self) -> usize {
        // Require majority for durability
        (self.replicas.len() / 2) + 1
    }

    // Monitoring endpoint
    fn get_replication_status(&self) -> ReplicationStatus {
        ReplicationStatus {
            queue_size: self.replication_queue.len(),
            queue_capacity: self.max_queue_size,
            replicas: self.replicas.iter().map(|r| ReplicaStatusInfo {
                url: r.url.clone(),
                lag_entries: self.replication_queue.len() as u64
                           - r.last_acked_index,
                lag_seconds: self.calculate_lag_seconds(r),
                status: format!("{:?}", r.status),
            }).collect(),
        }
    }
}

#[derive(Debug)]
struct ReplicationStatus {
    queue_size: usize,
    queue_capacity: usize,
    replicas: Vec<ReplicaStatusInfo>,
}

#[derive(Debug)]
struct ReplicaStatusInfo {
    url: String,
    lag_entries: u64,
    lag_seconds: u64,
    status: String,
}
```

### Key Takeaway
Never use unbounded replication queues. Implement backpressure to slow down primary when replicas lag, monitor replication lag continuously and alert on thresholds, use bounded queues with circuit breakers, require minimum replica acknowledgment for durability, and implement semi-synchronous replication for critical data. Replication lag should trigger operational alerts, not be discovered during failures.

---

## Additional Resources and References

This knowledge base was compiled from research on distributed systems patterns and anti-patterns, including:

- CockroachDB's multi-active availability architecture and consensus replication
- Martin Kleppmann's work on CRDTs, including "CRDTs: The Hard Parts"
- Jepsen consistency models and anomaly classifications
- Academic research on eventual consistency challenges
- Production lessons from distributed database implementations

For further reading on these topics, explore:
- "Designing Data-Intensive Applications" by Martin Kleppmann
- Jepsen.io analyses of distributed databases
- CockroachDB technical blog on distributed SQL
- Research papers on CRDTs, Raft, and Paxos consensus algorithms
