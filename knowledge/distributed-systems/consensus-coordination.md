# Consensus and Coordination Bugs in Distributed Systems

This document catalogs common anti-patterns, bugs, and pitfalls in implementing consensus algorithms (Raft, Paxos) and distributed coordination mechanisms. These patterns are derived from real-world production issues, research papers, and battle-tested implementations like etcd, Consul, and HashiCorp Raft.

## Overview

Consensus algorithms ensure distributed systems agree on shared state despite failures. While algorithms like Raft are designed to be "understandable," production implementations require extreme attention to correctness details. Even minor deviations from specifications can lead to data loss, split-brain scenarios, and system unavailability.

---

## 1. Split-Brain Scenario

### Description
Split-brain occurs when a distributed system partitions into two or more segments, each believing it is the authoritative component. Without proper consensus mechanisms, different partitions can accept conflicting writes, leading to data inconsistency and potentially catastrophic data corruption.

### Bad Code Example
```python
# Dangerous: No quorum check before becoming leader
class BadLeaderElection:
    def try_become_leader(self):
        # Network partition happens here
        if self.can_contact_any_node():  # Wrong: doesn't check majority
            self.state = "LEADER"
            self.accept_writes = True

    def handle_write(self, data):
        if self.state == "LEADER":
            self.data_store[data.key] = data.value  # Dangerous!
            return "OK"
```

### Good Code Example
```python
# Safe: Requires majority quorum
class SafeLeaderElection:
    def try_become_leader(self):
        votes = self.request_votes_from_all()
        if len(votes) > len(self.cluster_nodes) / 2:  # Requires majority
            self.state = "LEADER"
            self.accept_writes = True
        else:
            self.state = "FOLLOWER"

    def handle_write(self, data):
        if self.state != "LEADER":
            return redirect_to_leader()

        # Only commit after majority acknowledgment
        acks = self.replicate_to_followers(data)
        if len(acks) > len(self.cluster_nodes) / 2:
            self.commit(data)
            return "OK"
        else:
            return "FAILED"
```

### Key Takeaway
Always require a strict majority (quorum) for leadership and commits. A quorum ensures that even during network partitions, only one partition can make progress, preventing split-brain scenarios.

---

## 2. Missing fsync on Leader Logs (Raft)

### Description
Raft's correctness proof assumes that when a node confirms it has persisted log entries, those entries survive crashes. Skipping fsync on the leader (for performance) breaks this fundamental assumption. The cluster can lose already-acknowledged logs because Raft assumes committed entries are on a quorum of disks, guaranteeing the new leader has them.

### Bad Code Example
```go
// Dangerous: Async write without fsync
func (r *RaftNode) AppendEntries(entries []LogEntry) error {
    // Write to memory/buffer - returns immediately
    r.logBuffer.Append(entries)

    // Respond to client immediately - data not durable!
    return nil  // Claim success before fsync
}

func (r *RaftNode) ReplicateToFollowers(entry LogEntry) {
    r.AppendEntries([]LogEntry{entry})

    // Tell client it's committed
    if r.countAcks() > r.clusterSize/2 {
        r.commitIndex++
        r.notifyClient("SUCCESS")  // LIE: not actually durable
    }
}
```

### Good Code Example
```go
// Safe: Synchronous fsync before acknowledgment
func (r *RaftNode) AppendEntries(entries []LogEntry) error {
    // Write to log file
    if err := r.logFile.Write(entries); err != nil {
        return err
    }

    // CRITICAL: Force to disk before returning
    if err := r.logFile.Sync(); err != nil {  // fsync call
        return err
    }

    return nil  // Now safe to acknowledge
}

func (r *RaftNode) ReplicateToFollowers(entry LogEntry) {
    // Persist locally first (with fsync)
    if err := r.AppendEntries([]LogEntry{entry}); err != nil {
        r.notifyClient("FAILED")
        return
    }

    // Then replicate
    if r.countAcks() > r.clusterSize/2 {
        r.commitIndex++
        r.notifyClient("SUCCESS")  // Safe: durable on quorum
    }
}
```

### Key Takeaway
There is no correct (linearizable) way to implement Raft without fsync on every LogStore append. All optimizations that skip fsync risk committed data loss. The performance cost is unavoidable for correctness.

---

## 3. Term/Metadata Persistence Ordering Bug (Raft)

### Description
A critical but subtle bug where log entries hit disk while the term number is still in memory or write queue. If the server crashes, the persisted term can be stale relative to log entries, breaking the invariant: "If log entry E(term=T) exists on disk → stored term must be ≥T". This can cause committed data to vanish.

### Bad Code Example
```go
// Dangerous: Term persisted asynchronously after logs
func (r *RaftNode) HandleAppendRequest(req *AppendRequest) {
    // Async: term write queued but not forced to disk
    r.metaStorage.SetTermAsync(req.Term)  // Returns immediately

    // Sync: logs written to disk first
    r.logManager.AppendEntries(req.Entries)  // Blocks on fsync

    // Crash here = logs on disk with stale term!
    // On recovery: will accept conflicting entries from old term
}
```

### Good Code Example
```go
// Safe: Term persisted before (or with) logs
func (r *RaftNode) HandleAppendRequest(req *AppendRequest) {
    // CRITICAL: Term must hit disk first
    if err := r.metaStorage.SetTermSync(req.Term); err != nil {
        return err  // Fail fast
    }

    // Now safe to write logs
    if err := r.logManager.AppendEntries(req.Entries); err != nil {
        return err
    }

    // Invariant maintained: term on disk >= all log entry terms
}

// Alternative: Atomic batch write
func (r *RaftNode) HandleAppendRequestAtomic(req *AppendRequest) {
    batch := r.storage.NewBatch()
    batch.SetTerm(req.Term)
    batch.AppendLogs(req.Entries)

    // Atomic: both or neither
    return batch.CommitSync()
}
```

### Key Takeaway
Term must be persisted before (or atomically with) log entries. The Raft paper assumes atomic persistence without explicitly stating ordering requirements. Violating this ordering causes severe correctness issues including loss of committed data.

---

## 4. Disregarding RequestVote from Removed Servers (Raft)

### Description
When a server is removed from the cluster, it stops receiving heartbeats and eventually times out, starting new elections with higher term numbers. These RequestVote RPCs can cause the current leader to step down unnecessarily, severely impacting cluster availability. The Raft paper itself initially had a recommendation that caused this bug.

### Bad Code Example
```go
// Dangerous: Accept all RequestVote RPCs regardless of source
func (r *RaftNode) HandleRequestVote(req *VoteRequest) *VoteResponse {
    if req.Term > r.currentTerm {
        // Step down immediately - even if requester was removed!
        r.becomeFollower(req.Term)
        r.currentTerm = req.Term
        return &VoteResponse{VoteGranted: true}
    }
    return &VoteResponse{VoteGranted: false}
}
```

### Good Code Example
```go
// Safe: Check for current leader before accepting vote requests
func (r *RaftNode) HandleRequestVote(req *VoteRequest) *VoteResponse {
    // Ignore RequestVote when we believe a leader exists
    if r.currentLeader != nil && r.timeSinceLastHeartbeat() < r.electionTimeout {
        // Current leader is active - ignore spurious vote requests
        return &VoteResponse{
            Term:        r.currentTerm,
            VoteGranted: false,
            Reason:      "active_leader_exists",
        }
    }

    if req.Term > r.currentTerm {
        r.becomeFollower(req.Term)
        r.currentTerm = req.Term
        return &VoteResponse{VoteGranted: true}
    }
    return &VoteResponse{VoteGranted: false}
}
```

### Key Takeaway
Servers should disregard RequestVote RPCs when they believe a current leader exists and is sending heartbeats. This prevents removed servers or partitioned nodes from disrupting cluster availability.

---

## 5. Missing Pre-Vote Mechanism (Raft)

### Description
When a server rejoins the cluster or recovers from a transient network issue, it can trigger unnecessary elections even though a healthy leader exists. This degrades availability and causes unnecessary leader churn. The Pre-Vote extension prevents this by checking with other members before starting a real election.

### Bad Code Example
```go
// Dangerous: Start election immediately on timeout
func (r *RaftNode) ElectionTimeoutHandler() {
    // No pre-check - immediately disrupt the cluster
    r.currentTerm++
    r.votedFor = r.nodeID
    r.state = Candidate

    // This can disrupt a healthy leader
    r.sendRequestVoteToAll()
}
```

### Good Code Example
```go
// Safe: Pre-vote before real election
func (r *RaftNode) ElectionTimeoutHandler() {
    // First, do a pre-vote check
    if !r.preVoteSuccessful() {
        // Cluster has healthy leader - don't disrupt
        return
    }

    // Only now start real election
    r.currentTerm++
    r.votedFor = r.nodeID
    r.state = Candidate
    r.sendRequestVoteToAll()
}

func (r *RaftNode) preVoteSuccessful() bool {
    // Check if we could win without incrementing term
    preVotes := r.sendPreVoteRequests()  // Doesn't change term
    return len(preVotes) > len(r.clusterNodes)/2
}

func (r *RaftNode) HandlePreVoteRequest(req *PreVoteRequest) *PreVoteResponse {
    // Grant pre-vote only if we haven't heard from leader recently
    if r.timeSinceLastHeartbeat() > r.electionTimeout {
        return &PreVoteResponse{VoteGranted: true}
    }
    return &PreVoteResponse{VoteGranted: false}
}
```

### Key Takeaway
Implement Pre-Vote in production systems to prevent unnecessary elections and improve cluster availability. Pre-Vote checks cluster health before disrupting with a real election.

---

## 6. Incorrect Election Timeout Tuning (Raft)

### Description
Election timeouts must be tuned with actual cluster latency in mind. Too short causes constant leader churn from GC pauses or temporary network congestion. Too long delays recovery from actual failures. Random jitter is essential to prevent split votes.

### Bad Code Example
```go
// Dangerous: Fixed timeout, no consideration for latency
const ElectionTimeout = 300 * time.Millisecond  // Fixed!

func (r *RaftNode) StartElectionTimer() {
    time.Sleep(ElectionTimeout)  // No randomization
    r.startElection()
}

// Problem: If cluster latency is 200ms, constant leader elections
// Problem: All nodes timeout simultaneously -> split votes
```

### Good Code Example
```go
// Safe: Adaptive timeout with randomization
type RaftNode struct {
    baseElectionTimeout time.Duration  // e.g., 300ms
    clusterLatency     time.Duration   // Measured
    // ...
}

func (r *RaftNode) GetElectionTimeout() time.Duration {
    // Timeout should be multiple of cluster latency
    minTimeout := r.clusterLatency * 10

    if r.baseElectionTimeout < minTimeout {
        r.baseElectionTimeout = minTimeout
    }

    // Add random jitter (50-100% of base)
    jitter := rand.Int63n(int64(r.baseElectionTimeout))
    return r.baseElectionTimeout + time.Duration(jitter)
}

func (r *RaftNode) StartElectionTimer() {
    timeout := r.GetElectionTimeout()  // Different for each node
    time.Sleep(timeout)
    r.startElection()
}

func (r *RaftNode) MeasureClusterLatency() {
    // Periodically measure round-trip times
    latencies := []time.Duration{}
    for _, peer := range r.peers {
        start := time.Now()
        peer.Ping()
        latencies = append(latencies, time.Since(start))
    }
    r.clusterLatency = percentile95(latencies)
}
```

### Key Takeaway
Election timeout should be at least 10x cluster latency. Always add random jitter (typically 50-100% of base timeout) to prevent split votes. Consider measuring actual cluster latency and adapting timeouts dynamically.

---

## 7. Paxos Dueling Proposers (Livelock)

### Description
In Basic Paxos, multiple proposers can interfere with each other indefinitely. Proposer A prepares with ballot N, proposer B prepares with N+1 (invalidating A), A tries again with N+2 (invalidating B), and so on. No value ever gets accepted, causing livelock and preventing progress.

### Bad Code Example
```python
# Dangerous: No coordination between proposers
class NaivePaxosProposer:
    def propose(self, value):
        while True:
            ballot = self.next_ballot()

            # Prepare phase
            promises = self.send_prepare(ballot)
            if len(promises) <= len(self.acceptors) / 2:
                # Failed - try immediately with higher ballot
                continue  # Infinite conflict possible!

            # Accept phase
            accepts = self.send_accept(ballot, value)
            if len(accepts) > len(self.acceptors) / 2:
                return "SUCCESS"
            # Failed - retry immediately (causes livelock)
```

### Good Code Example
```python
# Safe: Leader election + exponential backoff
class SafePaxosProposer:
    def __init__(self):
        self.backoff = 0.1  # seconds
        self.max_backoff = 10.0
        self.leader = self.elect_stable_leader()

    def propose(self, value):
        # Only designated leader proposes
        if not self.is_leader():
            return self.forward_to_leader(value)

        attempt = 0
        while attempt < MAX_ATTEMPTS:
            ballot = self.next_ballot()

            # Prepare phase
            promises = self.send_prepare(ballot)
            if len(promises) <= len(self.acceptors) / 2:
                # Exponential backoff before retry
                time.sleep(self.backoff * (2 ** attempt))
                attempt += 1
                continue

            # Accept phase
            accepts = self.send_accept(ballot, value)
            if len(accepts) > len(self.acceptors) / 2:
                return "SUCCESS"

            time.sleep(self.backoff * (2 ** attempt))
            attempt += 1

        return "FAILED"

    def elect_stable_leader(self):
        # Use leader election protocol
        # Only one node acts as proposer
        return self.run_leader_election()
```

### Key Takeaway
Prevent Paxos livelock by: (1) electing a stable leader/distinguished proposer, or (2) implementing exponential backoff with randomization. Production systems typically use Multi-Paxos with a stable leader.

---

## 8. Two-Phase Commit Blocking Problem

### Description
2PC blocks indefinitely if the coordinator fails after sending PREPARE but before sending COMMIT/ABORT. Participants have locked resources and cannot make progress without coordinator's decision. This causes system-wide unavailability and requires manual intervention.

### Bad Code Example
```python
# Dangerous: Classic 2PC with blocking
class TwoPhaseCommitParticipant:
    def handle_prepare(self, txn_id):
        # Lock resources
        self.lock_resources(txn_id)
        self.state = "PREPARED"

        # Wait indefinitely for coordinator
        while self.state == "PREPARED":
            msg = self.receive_from_coordinator()  # BLOCKS FOREVER
            if msg == "COMMIT":
                self.commit(txn_id)
            elif msg == "ABORT":
                self.abort(txn_id)

        # Resources locked until coordinator responds!
```

### Good Code Example
```python
# Better: Three-Phase Commit with timeout and recovery
class ThreePhaseCommitParticipant:
    def handle_prepare(self, txn_id):
        self.lock_resources(txn_id)
        self.state = "PREPARED"
        return "VOTE_COMMIT"

    def handle_pre_commit(self, txn_id):
        # All voted yes - safe to commit
        self.state = "PRE_COMMITTED"
        return "ACK"

    def handle_do_commit(self, txn_id):
        self.commit(txn_id)
        self.unlock_resources(txn_id)
        self.state = "COMMITTED"

    def timeout_handler(self):
        if self.state == "PREPARED":
            # No pre-commit received - safe to abort
            self.abort(self.current_txn)
            self.unlock_resources(self.current_txn)

        elif self.state == "PRE_COMMITTED":
            # Pre-commit received - safe to commit
            # (coordinator must have received all votes)
            self.commit(self.current_txn)
            self.unlock_resources(self.current_txn)
```

### Best Practice
```python
# Best: Avoid distributed transactions entirely
class SagaPattern:
    """Use compensating transactions instead of 2PC/3PC"""

    def execute_distributed_transaction(self, operations):
        completed = []

        try:
            for op in operations:
                result = op.execute()  # Local transaction
                completed.append((op, result))
        except Exception as e:
            # Rollback using compensating transactions
            for op, result in reversed(completed):
                op.compensate(result)  # Undo operation
            raise

        return "SUCCESS"
```

### Key Takeaway
2PC is considered an anti-pattern in modern architectures. It's expensive (many messages + forced log writes), blocks on failures, and cannot handle network partitions. Use 3PC for better availability, or better yet, avoid distributed transactions entirely using patterns like Sagas, eventual consistency, or idempotent operations.

---

## 9. Unsafe Linearizable Reads Without Quorum

### Description
Reading from a single node (including the leader) without confirming leadership can return stale data. The "leader" might have been partitioned and a new leader elected. Linearizable reads require either: (1) read quorum, (2) read index with heartbeat confirmation, or (3) lease-based reads.

### Bad Code Example
```go
// Dangerous: Read from leader without confirmation
func (r *RaftNode) HandleRead(key string) (string, error) {
    if r.state != Leader {
        return "", errors.New("not leader")
    }

    // Dangerous: might be stale if this node was partitioned
    return r.stateMachine.Get(key), nil
}
```

### Good Code Example (Option 1: Read Quorum)
```go
// Safe: Read from quorum
func (r *RaftNode) HandleReadWithQuorum(key string) (string, error) {
    responses := []string{}

    // Read from self
    responses = append(responses, r.stateMachine.Get(key))

    // Read from followers
    for _, follower := range r.followers {
        val, err := follower.ReadValue(key)
        if err == nil {
            responses = append(responses, val)
        }
    }

    // Need majority to confirm
    if len(responses) <= len(r.clusterNodes)/2 {
        return "", errors.New("no quorum")
    }

    // Return most recent value (by commit index)
    return r.getMostRecentValue(responses), nil
}
```

### Good Code Example (Option 2: ReadIndex)
```go
// Safe: Confirm leadership before read
func (r *RaftNode) HandleReadWithLeaderCheck(key string) (string, error) {
    if r.state != Leader {
        return "", errors.New("not leader")
    }

    // Record current commit index
    readIndex := r.commitIndex

    // Confirm leadership by sending heartbeat to quorum
    acks := r.sendHeartbeatToAll()
    if len(acks) <= len(r.clusterNodes)/2 {
        return "", errors.New("lost leadership")
    }

    // Wait for state machine to catch up to readIndex
    r.waitForApply(readIndex)

    // Now safe to read
    return r.stateMachine.Get(key), nil
}
```

### Good Code Example (Option 3: Lease-based)
```go
// Safe: Lease-based reads (most efficient)
type LeaseBasedReads struct {
    leaseTimeout   time.Duration
    lastLeaseRenew time.Time
}

func (r *RaftNode) HandleReadWithLease(key string) (string, error) {
    if r.state != Leader {
        return "", errors.New("not leader")
    }

    // Check if lease is still valid
    if time.Since(r.lastLeaseRenew) > r.leaseTimeout {
        return "", errors.New("lease expired")
    }

    // Safe to read without quorum - lease guarantees no other leader
    return r.stateMachine.Get(key), nil
}

func (r *RaftNode) RenewLease() {
    // Send heartbeat to quorum
    acks := r.sendHeartbeatToAll()
    if len(acks) > len(r.clusterNodes)/2 {
        r.lastLeaseRenew = time.Now()
    }
}
```

### Key Takeaway
Never perform reads from leader alone without leadership confirmation. Use read quorum, ReadIndex protocol, or lease-based reads (with Check Quorum enabled) for linearizable semantics. Each approach trades off latency vs. complexity.

---

## 10. Configuration Change Without Joint Consensus

### Description
Directly switching from old cluster configuration to new configuration can create a moment where two disjoint majorities exist, allowing two leaders to be elected simultaneously. Raft's original single-server membership change had a safety bug discovered in 2014. Joint consensus (C-old,new) is the safe approach.

### Bad Code Example
```go
// Dangerous: Direct configuration switch
func (r *RaftNode) AddServer(newServer string) error {
    // Directly update configuration
    r.clusterNodes = append(r.clusterNodes, newServer)

    // Problem: Old majority {A,B,C} can elect leader
    //          New majority {C,D,E} can elect leader
    //          Both can be true simultaneously!

    return r.replicateConfig(r.clusterNodes)
}
```

### Good Code Example
```go
// Safe: Joint consensus configuration change
func (r *RaftNode) AddServerSafe(newServer string) error {
    // Phase 1: Enter joint consensus (C-old,new)
    // Both old and new configurations must agree
    jointConfig := &ClusterConfig{
        Old: r.currentConfig,
        New: append(r.currentConfig.Nodes, newServer),
    }

    // Commit C-old,new configuration
    if err := r.commitConfig(jointConfig); err != nil {
        return err
    }

    // Wait for new server to catch up
    r.waitForServerCatchup(newServer)

    // Phase 2: Switch to C-new
    r.currentConfig = &ClusterConfig{
        Old: nil,  // No longer in joint consensus
        New: jointConfig.New,
    }

    return r.commitConfig(r.currentConfig)
}

func (r *RaftNode) requiresJointQuorum() bool {
    if r.currentConfig.Old == nil {
        return false  // Normal mode
    }

    // Joint consensus: need quorum from BOTH old and new
    return true
}

func (r *RaftNode) hasQuorum(acks []string) bool {
    if !r.requiresJointQuorum() {
        // Normal: simple majority
        return len(acks) > len(r.currentConfig.New)/2
    }

    // Joint consensus: majority of BOTH configurations
    oldAcks := filterNodes(acks, r.currentConfig.Old)
    newAcks := filterNodes(acks, r.currentConfig.New)

    return len(oldAcks) > len(r.currentConfig.Old)/2 &&
           len(newAcks) > len(r.currentConfig.New)/2
}
```

### Key Takeaway
Always use joint consensus (C-old,new) for configuration changes. Direct configuration switches create windows where split-brain is possible. Raft's membership change system is complex and has not been formally verified—implement with extreme care or use well-tested libraries.

---

## 11. Ignoring Commit Index Regression

### Description
A follower should never accept a commit index that goes backwards. If a leader sends an older commit index, it indicates either a bug, message corruption, or a network issue. Accepting it can cause committed entries to become uncommitted, violating safety.

### Bad Code Example
```go
// Dangerous: Blindly accept any commit index
func (r *RaftNode) HandleAppendEntries(req *AppendRequest) {
    // Append entries...

    // Blindly update commit index
    r.commitIndex = req.LeaderCommit  // Can go backwards!

    // This can "uncommit" entries that were previously committed
}
```

### Good Code Example
```go
// Safe: Validate commit index never regresses
func (r *RaftNode) HandleAppendEntries(req *AppendRequest) *AppendResponse {
    // Validate term
    if req.Term < r.currentTerm {
        return &AppendResponse{Success: false}
    }

    // Validate commit index doesn't go backwards
    if req.LeaderCommit < r.commitIndex {
        // This should never happen in correct implementation
        r.logger.Error("commit index regression detected",
            "current", r.commitIndex,
            "received", req.LeaderCommit,
            "leader", req.LeaderID)

        // Don't panic - but log for investigation
        return &AppendResponse{Success: false, Reason: "commit_regression"}
    }

    // Append entries...

    // Safely update commit index (monotonically increasing)
    if req.LeaderCommit > r.commitIndex {
        r.commitIndex = min(req.LeaderCommit, r.lastLogIndex())
    }

    return &AppendResponse{Success: true}
}
```

### Key Takeaway
Commit index must be monotonically increasing. Regression indicates a serious bug or corruption. Log and reject rather than panicking, as it might be a transient network issue, but investigate thoroughly.

---

## 12. Race Conditions in Distributed State

### Description
Concurrent operations in distributed systems without proper coordination lead to race conditions and inconsistent state. Transaction isolation handles races in concurrent transactions, while distributed consensus handles coordinating state across nodes. Both are required.

### Bad Code Example
```python
# Dangerous: No coordination on distributed counter
class DistributedCounter:
    def increment(self):
        # Read from local cache
        current = self.cache.get("counter")  # Stale!

        # Increment
        new_value = current + 1

        # Write back (lost updates!)
        self.cache.set("counter", new_value)

        # Multiple nodes can read "5", increment to "6"
        # Final value should be "7" but ends up "6"
```

### Good Code Example (Option 1: Consensus-based)
```python
# Safe: Consensus-based counter
class ConsensusCounter:
    def increment(self):
        # Propose increment operation through Raft
        operation = {"type": "increment", "key": "counter"}

        # Raft ensures this is applied in same order on all nodes
        result = self.raft.propose(operation)

        # State machine applies increment atomically
        return result
```

### Good Code Example (Option 2: CRDT)
```python
# Safe: CRDT counter (no coordination needed)
class CRDTCounter:
    """Conflict-free Replicated Data Type"""

    def __init__(self, node_id):
        self.node_id = node_id
        self.counts = {}  # node_id -> count

    def increment(self):
        # Each node tracks its own increments
        if self.node_id not in self.counts:
            self.counts[self.node_id] = 0
        self.counts[self.node_id] += 1

    def value(self):
        # Convergent: all nodes compute same result
        return sum(self.counts.values())

    def merge(self, other_counts):
        # Merge from another replica
        for node_id, count in other_counts.items():
            self.counts[node_id] = max(
                self.counts.get(node_id, 0),
                count
            )
```

### Key Takeaway
Distributed state updates require coordination. Use consensus algorithms (Raft/Paxos) for strong consistency, or CRDTs for eventual consistency without coordination. Never assume local reads are up-to-date without confirmation.

---

## Summary of Critical Rules

1. **Always require quorum**: Majorities prevent split-brain
2. **Always fsync before acknowledging**: Durability is non-negotiable
3. **Persist term before logs**: Maintain critical ordering invariants
4. **Implement Pre-Vote**: Prevent unnecessary elections
5. **Tune election timeouts**: 10x cluster latency + random jitter
6. **Use leader election in Paxos**: Prevent dueling proposers livelock
7. **Avoid 2PC**: Blocking problem and FLP impossibility
8. **Confirm leadership for reads**: Prevent stale reads
9. **Use joint consensus for config changes**: Prevent split-brain during membership changes
10. **Validate monotonic invariants**: Commit index never regresses
11. **Coordinate distributed state**: Use consensus or CRDTs, never assume local reads are current

---

## Testing and Verification

Production consensus implementations should include:

- **Chaos testing**: Kill nodes, partition networks, introduce latency
- **Formal verification**: Use TLA+ or similar to verify protocols
- **Jepsen testing**: Test linearizability and consistency under failures
- **Fault injection**: Disk corruption, clock skew, asymmetric partitions
- **Long-running soak tests**: Hours/days to expose rare race conditions

Even battle-tested implementations like etcd and HashiCorp Raft regularly surface correctness bugs. Extreme diligence is required.

---

## References and Further Reading

This document synthesizes knowledge from:
- Raft paper: "In Search of an Understandable Consensus Algorithm"
- Paxos papers: "Paxos Made Simple" and "Paxos Made Moderately Complex"
- Production implementations: etcd, Consul, HashiCorp Raft, Cockroach DB
- Academic research on distributed consensus and coordination
- Real-world bug reports and postmortems from distributed systems

For LLM training: These patterns represent real bugs found in production systems. When reviewing code for consensus/coordination, check for these specific anti-patterns.
