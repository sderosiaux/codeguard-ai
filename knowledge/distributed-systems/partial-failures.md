# Partial Failures, Network Partitions, and Split Brain in Distributed Systems

## Introduction

Distributed systems introduce unique failure modes that don't exist in single-machine architectures. Unlike complete system failures, partial failures occur when some components of a distributed system fail while others continue operating. This creates challenges in maintaining consistency, preventing data corruption, and ensuring availability. Networks fail regularly across all scales—from single NICs to global routing infrastructure—and failures can last from seconds to days.

This document captures key anti-patterns, failure modes, and their solutions for building resilient distributed systems.

---

## 1. Split-Brain Syndrome

### Description
Split-brain occurs when a network partition divides a distributed cluster into isolated groups, and multiple nodes independently assume leadership or authority. This leads to divergent state across partitions, potentially causing data corruption, conflicting writes, and loss of consistency guarantees. When the partition heals, reconciling divergent states becomes extremely difficult or impossible.

### Bad Code Example

```python
# Anti-pattern: Simple leader election without quorum
class LeaderElection:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.is_leader = False

    def check_leadership(self):
        # BAD: Assumes leadership if can't reach other nodes
        reachable_peers = [p for p in self.peers if self.can_ping(p)]

        if len(reachable_peers) == 0:
            # Dangerous: Multiple nodes may independently decide they're leader
            self.is_leader = True
            print(f"Node {self.node_id} became leader")

    def process_write(self, data):
        if self.is_leader:
            # Each isolated node processes writes independently
            self.database.write(data)
```

**Problem:** During a network partition, each isolated node may independently declare itself leader, resulting in multiple primaries simultaneously accepting conflicting writes.

### Good Code Example

```python
# Good: Raft-based consensus with majority quorum
class RaftNode:
    def __init__(self, node_id, cluster_nodes):
        self.node_id = node_id
        self.cluster_nodes = cluster_nodes
        self.current_term = 0
        self.voted_for = None
        self.state = 'follower'  # follower, candidate, or leader

    def request_votes(self):
        """Candidate requests votes from other nodes"""
        votes = 1  # Vote for self
        majority = len(self.cluster_nodes) // 2 + 1

        for node in self.cluster_nodes:
            if node.request_vote(self.current_term, self.node_id):
                votes += 1

        # Only become leader if MAJORITY agrees
        if votes >= majority:
            self.state = 'leader'
            return True
        return False

    def process_write(self, data):
        if self.state != 'leader':
            raise Exception("Not the leader")

        # Replicate to majority before committing
        replicas = 1  # Self
        majority = len(self.cluster_nodes) // 2 + 1

        for node in self.cluster_nodes:
            if node.replicate(data, self.current_term):
                replicas += 1

        if replicas >= majority:
            self.commit(data)
            return True
        else:
            # Cannot achieve consensus - abort write
            raise Exception("Cannot reach quorum")
```

**Solution:** Use consensus algorithms (Raft, Paxos, Zab) that require majority agreement before any state changes. This mathematically ensures only one partition can make progress.

### Key Takeaway
Always require a **quorum (majority) of nodes** to agree on leadership and state changes. In a cluster of N nodes, require N/2 + 1 agreement. Use odd numbers of nodes (3, 5, 7) to ensure clear majorities. Never allow isolated nodes to assume authority independently.

---

## 2. Insufficient Quorum Configuration

### Description
Many distributed systems allow quorum configuration but ship with unsafe defaults or allow operators to configure insufficient quorum sizes. This permits split-brain scenarios even when consensus mechanisms are available. ElasticSearch's `minimum_master_nodes` is a notorious example where incorrect configuration leads to simultaneous primaries.

### Bad Code Example

```yaml
# ElasticSearch configuration - UNSAFE default
cluster.name: production-cluster
node.master: true
node.data: true
# BAD: No minimum_master_nodes set
# Default allows any single node to form a cluster
discovery.zen.ping.unicast.hosts: ["node1", "node2", "node3"]
```

```python
# Application code assuming single master
class ElasticCluster:
    def __init__(self, nodes):
        self.nodes = nodes

    def get_master(self):
        # BAD: Assumes single master exists
        for node in self.nodes:
            if node.is_master():
                return node
        raise Exception("No master found")

    def write_data(self, index, doc):
        master = self.get_master()
        # Problem: Multiple masters may exist during partition
        master.index(index, doc)
```

### Good Code Example

```yaml
# ElasticSearch configuration - SAFE quorum
cluster.name: production-cluster
node.master: true
node.data: true
# GOOD: Require majority for master election (for 5-node cluster)
discovery.zen.minimum_master_nodes: 3
discovery.zen.ping.unicast.hosts: ["node1", "node2", "node3", "node4", "node5"]
```

```python
# Application code with split-brain awareness
class ElasticCluster:
    def __init__(self, nodes, required_quorum):
        self.nodes = nodes
        self.required_quorum = required_quorum

    def get_master_with_quorum(self):
        masters = [node for node in self.nodes if node.is_master()]

        if len(masters) == 0:
            raise NoMasterException("No master available")

        if len(masters) > 1:
            # Split-brain detected!
            raise SplitBrainException(f"Multiple masters detected: {masters}")

        master = masters[0]

        # Verify master can reach quorum
        reachable = sum(1 for node in self.nodes if master.can_reach(node))
        if reachable < self.required_quorum:
            raise QuorumException(f"Master cannot reach quorum: {reachable}/{self.required_quorum}")

        return master

    def write_data(self, index, doc):
        try:
            master = self.get_master_with_quorum()
            master.index(index, doc)
        except (SplitBrainException, QuorumException) as e:
            # Fail fast rather than risk inconsistency
            raise ServiceUnavailableException(str(e))
```

### Key Takeaway
**Always explicitly configure quorum requirements** in distributed systems. For a cluster of N nodes, set `minimum_master_nodes = N/2 + 1`. Deploy dedicated master-eligible nodes separate from data nodes to prevent resource contention from causing false failure detection. Validate quorum before any cluster state changes.

---

## 3. Asymmetric Network Failures

### Description
Asymmetric failures occur when communication works in one direction but fails in the other, or when some nodes can communicate while others cannot (partial partition). These violate common assumptions in distributed systems design and can lead to undetected isolation where a node continues operating without realizing it's disconnected from the cluster.

### Bad Code Example

```python
# Anti-pattern: Unidirectional heartbeat
class HealthMonitor:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.last_heartbeat = {}

    def send_heartbeats(self):
        """Send heartbeats to all peers"""
        for peer in self.peers:
            # BAD: Only sending, not receiving acknowledgments
            peer.heartbeat(self.node_id)

    def check_peer_health(self, peer_id):
        last_seen = self.last_heartbeat.get(peer_id, 0)
        # Problem: If outbound works but inbound fails,
        # we think peer is dead but peer thinks we're alive
        if time.time() - last_seen > TIMEOUT:
            return False
        return True
```

**Problem:** The Broadcom BCM5709 NIC bug demonstrated this: outbound heartbeats continued while inbound packets were dropped. The sending node appeared healthy while actually isolated, preventing proper failover for hours.

### Good Code Example

```python
# Good: Bidirectional health checks with request-response
class HealthMonitor:
    def __init__(self, node_id, peers):
        self.node_id = node_id
        self.peers = peers
        self.health_status = {}

    def check_bidirectional_health(self, peer_id):
        """Request-response pattern ensures bidirectional communication"""
        try:
            # Send ping and expect pong response
            start_time = time.time()
            response = self.send_ping_wait_pong(peer_id, timeout=5)
            rtt = time.time() - start_time

            if response and response.can_reach_me:
                # Confirm peer can also reach us
                self.health_status[peer_id] = {
                    'healthy': True,
                    'bidirectional': True,
                    'rtt': rtt,
                    'timestamp': time.time()
                }
                return True
            else:
                # Asymmetric failure detected
                self.health_status[peer_id] = {
                    'healthy': False,
                    'bidirectional': False,
                    'reason': 'asymmetric_partition'
                }
                return False

        except TimeoutException:
            self.health_status[peer_id] = {
                'healthy': False,
                'bidirectional': False,
                'reason': 'timeout'
            }
            return False

    def send_ping_wait_pong(self, peer_id, timeout):
        """Send ping and wait for pong - ensures round-trip"""
        request_id = generate_uuid()

        # Send ping
        self.send_message(peer_id, {
            'type': 'PING',
            'request_id': request_id,
            'from': self.node_id
        })

        # Wait for matching pong
        return self.wait_for_response(request_id, timeout)
```

```python
# Additional pattern: Mutual agreement before declaring failure
class ClusterCoordinator:
    def declare_node_failed(self, suspect_node_id):
        """Get consensus from multiple nodes before declaring failure"""
        votes = 0
        majority = len(self.peers) // 2 + 1

        # Ask other nodes if they can reach suspect
        for peer in self.peers:
            if peer.can_reach(suspect_node_id):
                # If others can reach it, might be asymmetric failure
                # affecting only us
                return False
            else:
                votes += 1

        # Only declare failed if majority agrees
        if votes >= majority:
            self.mark_as_failed(suspect_node_id)
            return True
        return False
```

### Key Takeaway
Use **bidirectional health checks** (request-response pattern) rather than unidirectional heartbeats. Implement timeout configuration with generous values (15+ seconds) to prevent false positives. Consider using multiple independent failure detectors that must agree before declaring a node failed. Be aware that asymmetric failures are real and relatively common in production networks.

---

## 4. Unsafe Distributed Locking Without Fencing

### Description
Distributed locks are commonly used to coordinate access to shared resources, but naive implementations fail during network partitions, GC pauses, or clock skew. A client may believe it holds a lock while another client has already acquired it, leading to concurrent modifications of supposedly protected resources. This is especially dangerous when locks protect external resources like databases or file systems.

### Bad Code Example

```python
# Anti-pattern: Lock without fencing tokens
class DistributedLock:
    def __init__(self, lock_service, resource_name):
        self.lock_service = lock_service
        self.resource_name = resource_name
        self.lock_acquired = False

    def acquire(self, ttl=30):
        # Acquire lock with TTL
        self.lock_acquired = self.lock_service.acquire(self.resource_name, ttl)
        return self.lock_acquired

    def execute_critical_section(self, database):
        if not self.lock_acquired:
            raise Exception("Lock not held")

        # BAD: No protection against stale lock holder
        data = database.read("key")
        time.sleep(2)  # Simulate work

        # Problem: If GC pause or network delay caused lock to expire,
        # another client may now hold the lock!
        database.write("key", data + 1)

    def release(self):
        self.lock_service.release(self.resource_name)
        self.lock_acquired = False
```

**Scenario:** Client A acquires lock, experiences GC pause, lock expires. Client B acquires lock, gets fencing token 2. Client A wakes up, still thinks it has lock, writes to database with stale state.

### Good Code Example

```python
# Good: Fencing tokens prevent stale lock operations
class FencedLock:
    def __init__(self, lock_service, resource_name):
        self.lock_service = lock_service
        self.resource_name = resource_name
        self.fencing_token = None

    def acquire(self, ttl=30):
        # Lock service returns monotonically increasing token
        result = self.lock_service.acquire_with_token(self.resource_name, ttl)
        if result:
            self.fencing_token = result['token']
            return True
        return False

    def execute_critical_section(self, fenced_database):
        if self.fencing_token is None:
            raise Exception("Lock not held")

        # Read with fencing token
        data = fenced_database.read("key", fence_token=self.fencing_token)
        time.sleep(2)  # Simulate work

        # Write with fencing token - database rejects if token is stale
        try:
            fenced_database.write(
                "key",
                data + 1,
                fence_token=self.fencing_token
            )
        except StaleFenceTokenException:
            # Database rejected our write because it has seen higher token
            raise Exception("Lock was lost during operation")

    def release(self):
        self.lock_service.release(self.resource_name, self.fencing_token)
        self.fencing_token = None


# Database/resource implementation with fencing
class FencedDatabase:
    def __init__(self):
        self.data = {}
        self.fence_tokens = {}  # Track highest token per key

    def write(self, key, value, fence_token):
        current_token = self.fence_tokens.get(key, 0)

        if fence_token < current_token:
            # Reject stale token
            raise StaleFenceTokenException(
                f"Stale token {fence_token}, current is {current_token}"
            )

        # Accept write and update token
        self.data[key] = value
        self.fence_tokens[key] = fence_token
        return True

    def read(self, key, fence_token):
        # Optionally validate token on reads too
        current_token = self.fence_tokens.get(key, 0)
        if fence_token < current_token:
            raise StaleFenceTokenException(
                f"Stale token {fence_token}, current is {current_token}"
            )
        return self.data.get(key)
```

### Key Takeaway
**Never rely on lock TTLs alone** for coordination. Implement fencing tokens: monotonically increasing sequence numbers returned with each lock acquisition. Protected resources must track the highest token seen and reject operations with lower tokens. This mathematically prevents stale lock holders from corrupting state, even during GC pauses, network delays, or clock skew.

---

## 5. Retry Without Backoff (Thundering Herd)

### Description
When a service experiences failures or latency, aggressive retries from clients can amplify load and delay recovery. The "thundering herd" problem occurs when many clients simultaneously retry failed operations, overwhelming the recovering service. Without exponential backoff and jitter, retry storms can keep systems in a failed state long after the original issue is resolved.

### Bad Code Example

```python
# Anti-pattern: Aggressive immediate retry
class ServiceClient:
    def __init__(self, service_url):
        self.service_url = service_url

    def call_service(self, request):
        max_retries = 10

        for attempt in range(max_retries):
            try:
                response = requests.post(self.service_url, json=request)
                if response.status_code == 200:
                    return response.json()

                # BAD: Immediate retry without backoff
                if response.status_code >= 500:
                    continue  # Retry immediately

            except requests.RequestException:
                # BAD: Immediate retry on network errors
                continue

        raise Exception("Max retries exceeded")


# Scenario: Service goes down briefly
# - 1000 clients immediately retry 10 times each
# - Service receives 10,000 requests instantly when recovering
# - Service becomes overwhelmed and fails again
# - Cycle repeats indefinitely
```

### Good Code Example

```python
import random
import time
from datetime import datetime, timedelta

class ResilientServiceClient:
    def __init__(self, service_url, max_retries=5):
        self.service_url = service_url
        self.max_retries = max_retries
        self.base_delay = 0.1  # 100ms
        self.max_delay = 30.0  # 30 seconds

    def exponential_backoff_with_jitter(self, attempt):
        """Calculate delay with exponential backoff and jitter"""
        # Exponential backoff: 2^attempt * base_delay
        exp_delay = min(self.base_delay * (2 ** attempt), self.max_delay)

        # Add jitter: random value between 0 and exp_delay
        # This prevents synchronized retries across clients
        jitter = random.uniform(0, exp_delay)

        return jitter

    def is_retryable_error(self, status_code):
        """Determine if error is transient and worth retrying"""
        # Retry on server errors and specific client errors
        retryable = {
            429,  # Too Many Requests
            502,  # Bad Gateway
            503,  # Service Unavailable
            504,  # Gateway Timeout
        }
        return status_code in retryable

    def call_service(self, request, idempotency_key=None):
        """Make service call with exponential backoff"""

        headers = {}
        if idempotency_key:
            # Include idempotency key to prevent duplicate processing
            headers['Idempotency-Key'] = idempotency_key

        for attempt in range(self.max_retries):
            try:
                response = requests.post(
                    self.service_url,
                    json=request,
                    headers=headers,
                    timeout=5  # Timeout prevents hanging
                )

                if response.status_code == 200:
                    return response.json()

                if not self.is_retryable_error(response.status_code):
                    # Non-retryable error (4xx client errors)
                    raise ServiceException(f"Non-retryable error: {response.status_code}")

                # Retryable error - wait before retry
                if attempt < self.max_retries - 1:
                    delay = self.exponential_backoff_with_jitter(attempt)
                    print(f"Retry attempt {attempt + 1} after {delay:.2f}s")
                    time.sleep(delay)

            except requests.Timeout:
                # Timeout is retryable
                if attempt < self.max_retries - 1:
                    delay = self.exponential_backoff_with_jitter(attempt)
                    time.sleep(delay)

            except requests.RequestException as e:
                # Network errors are retryable
                if attempt < self.max_retries - 1:
                    delay = self.exponential_backoff_with_jitter(attempt)
                    time.sleep(delay)
                else:
                    raise ServiceException(f"Max retries exceeded: {e}")

        raise ServiceException("Max retries exceeded")


# Circuit breaker pattern - stop retrying persistent failures
class CircuitBreaker:
    def __init__(self, failure_threshold=5, timeout=60):
        self.failure_threshold = failure_threshold
        self.timeout = timeout
        self.failures = 0
        self.last_failure_time = None
        self.state = 'CLOSED'  # CLOSED, OPEN, HALF_OPEN

    def call(self, func, *args, **kwargs):
        if self.state == 'OPEN':
            # Check if timeout has passed
            if datetime.now() - self.last_failure_time > timedelta(seconds=self.timeout):
                self.state = 'HALF_OPEN'
            else:
                raise CircuitBreakerOpenException("Circuit breaker is OPEN")

        try:
            result = func(*args, **kwargs)
            # Success - reset failures
            self.failures = 0
            self.state = 'CLOSED'
            return result

        except Exception as e:
            self.failures += 1
            self.last_failure_time = datetime.now()

            if self.failures >= self.failure_threshold:
                self.state = 'OPEN'
                print(f"Circuit breaker OPEN after {self.failures} failures")

            raise e
```

### Key Takeaway
**Always implement exponential backoff with jitter** for retries. Start with small delays (100ms) and double with each attempt, capping at reasonable maximum (30s). Add random jitter to prevent synchronized retry storms. Combine with circuit breakers to fail fast when errors persist. Only retry transient errors (5xx, timeouts). Use idempotency keys to safely retry potentially duplicate requests.

---

## 6. Ignoring Partial Failures (All-or-Nothing Assumption)

### Description
Distributed systems experience partial failures where some operations succeed while others fail. Code that assumes atomic "all-or-nothing" semantics can leave systems in inconsistent states. Examples include multi-step workflows, fan-out operations, or cross-service transactions where intermediate failures are not properly handled.

### Bad Code Example

```python
# Anti-pattern: Assuming all operations succeed or all fail
class OrderService:
    def __init__(self, inventory_service, payment_service, shipping_service):
        self.inventory = inventory_service
        self.payment = payment_service
        self.shipping = shipping_service

    def process_order(self, order):
        # BAD: No handling of partial failures

        # Step 1: Reserve inventory
        self.inventory.reserve(order.items)

        # Step 2: Charge payment
        self.payment.charge(order.user_id, order.total)

        # Step 3: Schedule shipping
        self.shipping.schedule(order.address, order.items)

        # Problem: If shipping fails, we've already charged payment
        # and reserved inventory with no rollback!

        return {"status": "success"}
```

**Scenario:** Payment succeeds but shipping service is down. Customer is charged but order never ships. Inventory is reserved but stuck. No compensation logic to undo partial work.

### Good Code Example

```python
from enum import Enum
from dataclasses import dataclass
from typing import Optional

class OrderStatus(Enum):
    PENDING = "pending"
    INVENTORY_RESERVED = "inventory_reserved"
    PAYMENT_CHARGED = "payment_charged"
    SHIPPING_SCHEDULED = "shipping_scheduled"
    COMPLETED = "completed"
    FAILED = "failed"
    COMPENSATING = "compensating"

@dataclass
class OrderState:
    order_id: str
    status: OrderStatus
    inventory_reservation_id: Optional[str] = None
    payment_transaction_id: Optional[str] = None
    shipping_id: Optional[str] = None


class ResilientOrderService:
    def __init__(self, inventory_service, payment_service, shipping_service, state_store):
        self.inventory = inventory_service
        self.payment = payment_service
        self.shipping = shipping_service
        self.state_store = state_store

    def process_order(self, order):
        """Process order with compensation on partial failure"""

        # Create persistent state
        state = OrderState(
            order_id=order.id,
            status=OrderStatus.PENDING
        )
        self.state_store.save(state)

        try:
            # Step 1: Reserve inventory
            reservation_id = self.inventory.reserve(order.items)
            state.inventory_reservation_id = reservation_id
            state.status = OrderStatus.INVENTORY_RESERVED
            self.state_store.save(state)

            # Step 2: Charge payment
            try:
                transaction_id = self.payment.charge(order.user_id, order.total)
                state.payment_transaction_id = transaction_id
                state.status = OrderStatus.PAYMENT_CHARGED
                self.state_store.save(state)
            except PaymentException as e:
                # Payment failed - compensate by releasing inventory
                self.compensate_inventory(state)
                raise OrderException(f"Payment failed: {e}")

            # Step 3: Schedule shipping
            try:
                shipping_id = self.shipping.schedule(order.address, order.items)
                state.shipping_id = shipping_id
                state.status = OrderStatus.SHIPPING_SCHEDULED
                self.state_store.save(state)
            except ShippingException as e:
                # Shipping failed - compensate both payment and inventory
                self.compensate_payment(state)
                self.compensate_inventory(state)
                raise OrderException(f"Shipping failed: {e}")

            # All steps succeeded
            state.status = OrderStatus.COMPLETED
            self.state_store.save(state)
            return {"status": "success", "order_id": order.id}

        except Exception as e:
            state.status = OrderStatus.FAILED
            self.state_store.save(state)
            raise e

    def compensate_inventory(self, state):
        """Release reserved inventory"""
        if state.inventory_reservation_id:
            try:
                self.inventory.release(state.inventory_reservation_id)
            except Exception as e:
                # Log compensation failure for manual intervention
                self.log_compensation_failure("inventory", state, e)

    def compensate_payment(self, state):
        """Refund payment"""
        if state.payment_transaction_id:
            try:
                self.payment.refund(state.payment_transaction_id)
            except Exception as e:
                # Log compensation failure for manual intervention
                self.log_compensation_failure("payment", state, e)

    def recover_partial_orders(self):
        """Background job to recover from partial failures"""
        partial_orders = self.state_store.find_by_status([
            OrderStatus.INVENTORY_RESERVED,
            OrderStatus.PAYMENT_CHARGED,
            OrderStatus.COMPENSATING
        ])

        for state in partial_orders:
            try:
                # Attempt to complete or compensate
                if state.status == OrderStatus.PAYMENT_CHARGED:
                    # Try to complete shipping
                    order = self.load_order(state.order_id)
                    shipping_id = self.shipping.schedule(order.address, order.items)
                    state.shipping_id = shipping_id
                    state.status = OrderStatus.COMPLETED
                    self.state_store.save(state)
                else:
                    # Compensate incomplete orders
                    self.full_compensation(state)
            except Exception as e:
                self.log_recovery_failure(state, e)


# Alternative: Saga pattern with explicit compensation
class OrderSaga:
    def __init__(self):
        self.steps = []
        self.compensation_steps = []

    def add_step(self, action, compensation):
        """Add step with its compensation"""
        self.steps.append(action)
        self.compensation_steps.append(compensation)

    def execute(self):
        executed = []

        try:
            for i, step in enumerate(self.steps):
                result = step()
                executed.append((i, result))
            return {"status": "success"}

        except Exception as e:
            # Compensate in reverse order
            for i, result in reversed(executed):
                try:
                    self.compensation_steps[i](result)
                except Exception as comp_error:
                    # Log compensation failure
                    print(f"Compensation failed for step {i}: {comp_error}")

            raise e
```

### Key Takeaway
**Design for partial failures from the start**. Persist operation state at each step. Implement compensating transactions to undo partial work. Use the Saga pattern for multi-step workflows with explicit compensation logic. Make compensations idempotent since they may execute multiple times. Include background recovery jobs to handle stuck operations. Accept that compensation itself may fail and log for manual intervention.

---

## 7. False Failure Detection from Resource Contention

### Description
Application-level resource contention (CPU, memory, disk I/O) can prevent timely heartbeat transmission or response processing, causing healthy nodes to be incorrectly marked as failed. This is particularly common during garbage collection pauses in JVM/CLR languages, where stop-the-world pauses can exceed heartbeat timeouts. These false positives trigger unnecessary failovers and can cascade into cluster instability.

### Bad Code Example

```python
# Anti-pattern: Tight timeout with no consideration for GC/load
class HealthChecker:
    HEARTBEAT_TIMEOUT = 3  # 3 seconds - too tight!

    def __init__(self, peers):
        self.peers = peers
        self.last_heartbeat = {}

    def check_health(self):
        current_time = time.time()

        for peer in self.peers:
            last_seen = self.last_heartbeat.get(peer.id, 0)

            # BAD: Tight timeout doesn't account for GC pauses or high load
            if current_time - last_seen > self.HEARTBEAT_TIMEOUT:
                self.declare_peer_dead(peer)
                self.trigger_failover(peer)


# Scenario on peer node:
class ResourceIntensiveService:
    def process_requests(self):
        while True:
            request = self.receive_request()

            # Heavy computation - pegs CPU at 100%
            result = self.expensive_operation(request)

            # Problem: Heartbeat thread can't get CPU time
            # Other nodes declare this node dead even though it's working
```

### Good Code Example

```python
import threading
from dataclasses import dataclass
from typing import Optional

@dataclass
class HealthConfig:
    heartbeat_interval: float = 5.0  # Send heartbeat every 5s
    heartbeat_timeout: float = 15.0  # Declare dead after 15s (3x interval)
    gc_pause_tolerance: float = 5.0  # Additional tolerance for GC
    consecutive_misses: int = 3  # Require multiple consecutive misses


class AdaptiveHealthChecker:
    def __init__(self, peers, config=None):
        self.peers = peers
        self.config = config or HealthConfig()
        self.heartbeat_history = {}  # Track multiple measurements
        self.last_gc_pause = {}

    def check_health(self, peer):
        """Check health with tolerance for transient issues"""
        current_time = time.time()

        if peer.id not in self.heartbeat_history:
            self.heartbeat_history[peer.id] = []

        last_seen = self.last_heartbeat.get(peer.id, 0)
        time_since_heartbeat = current_time - last_seen

        # Calculate adaptive timeout based on recent behavior
        adaptive_timeout = self.calculate_adaptive_timeout(peer)

        if time_since_heartbeat > adaptive_timeout:
            # Record a miss
            self.heartbeat_history[peer.id].append({
                'time': current_time,
                'status': 'missed'
            })

            # Only declare dead after consecutive misses
            recent_misses = self.count_recent_misses(peer.id)

            if recent_misses >= self.config.consecutive_misses:
                # Double-check with direct probe before declaring dead
                if not self.direct_health_probe(peer):
                    self.declare_peer_dead(peer)
        else:
            # Reset miss counter on successful heartbeat
            self.heartbeat_history[peer.id] = []

    def calculate_adaptive_timeout(self, peer):
        """Adjust timeout based on peer characteristics"""
        base_timeout = self.config.heartbeat_timeout

        # Add GC pause tolerance for JVM/CLR nodes
        if peer.runtime in ['jvm', 'clr']:
            base_timeout += self.config.gc_pause_tolerance

        # Increase timeout if peer is under high load
        if self.peer_load_percentage(peer) > 80:
            base_timeout *= 1.5

        return base_timeout

    def direct_health_probe(self, peer):
        """Send immediate health check request"""
        try:
            response = peer.ping(timeout=5)
            return response.healthy
        except Exception:
            return False


# Solution on service side: Dedicated heartbeat thread
class ResilientService:
    def __init__(self, peers):
        self.peers = peers
        self.shutdown = False

        # Dedicated thread for heartbeats - not affected by main workload
        self.heartbeat_thread = threading.Thread(
            target=self.heartbeat_loop,
            daemon=False  # Explicit shutdown
        )
        self.heartbeat_thread.start()

    def heartbeat_loop(self):
        """Dedicated heartbeat thread with high priority"""
        # Set thread priority (OS-specific)
        try:
            import os
            # Increase thread priority
            os.nice(-10)
        except Exception:
            pass

        while not self.shutdown:
            try:
                # Send heartbeats to all peers
                for peer in self.peers:
                    self.send_heartbeat(peer)

                time.sleep(5)  # 5 second interval

            except Exception as e:
                # Heartbeat thread must never die
                print(f"Heartbeat error: {e}")

    def send_heartbeat(self, peer):
        """Send heartbeat with metadata"""
        try:
            peer.heartbeat({
                'node_id': self.node_id,
                'timestamp': time.time(),
                'cpu_usage': self.get_cpu_usage(),
                'gc_paused': self.is_gc_paused(),
                'load_avg': self.get_load_average()
            })
        except Exception as e:
            # Log but don't crash heartbeat thread
            print(f"Failed to send heartbeat to {peer.id}: {e}")

    def process_requests(self):
        """Main request processing loop"""
        while True:
            request = self.receive_request()

            # Heavy computation
            result = self.expensive_operation(request)

            # Heartbeat thread runs independently
            # and isn't blocked by this work


# ElasticSearch-style: Separate master and data nodes
class ClusterArchitecture:
    """
    Separate master-eligible nodes from data nodes to prevent
    resource contention from affecting cluster coordination
    """

    def __init__(self):
        # Dedicated master nodes: lightweight, just coordination
        self.master_nodes = [
            Node(role='master', data_enabled=False),
            Node(role='master', data_enabled=False),
            Node(role='master', data_enabled=False)
        ]

        # Data nodes: handle queries and indexing
        self.data_nodes = [
            Node(role='data', master_eligible=False),
            Node(role='data', master_eligible=False),
            # ... more data nodes
        ]

    def configure_master_node(self, node):
        """Master nodes should not serve user requests"""
        node.accept_client_requests = False
        node.accept_search_queries = False
        node.accept_indexing = False

        # Only handle cluster coordination
        node.handle_cluster_state = True
        node.handle_leader_election = True
```

### Key Takeaway
**Use generous timeouts** (15+ seconds instead of 3 seconds) to accommodate GC pauses and temporary load spikes. Require multiple consecutive missed heartbeats before declaring failure. Implement dedicated heartbeat threads that run independently of main workload. Include peer load metadata in heartbeats to adjust timeout dynamically. For critical coordination services (like ElasticSearch), use dedicated master nodes that don't serve user requests to prevent resource contention from affecting cluster stability.

---

## Summary of Key Principles

1. **Quorum Consensus**: Always require majority agreement (N/2 + 1) for state changes to prevent split-brain
2. **Fencing Tokens**: Use monotonically increasing tokens to prevent stale lock holders from corrupting state
3. **Bidirectional Health Checks**: Verify communication works in both directions with request-response patterns
4. **Exponential Backoff with Jitter**: Prevent retry storms with increasing delays and randomization
5. **Explicit Compensation**: Design multi-step operations with compensating transactions for partial failures
6. **Adaptive Timeouts**: Account for GC pauses and resource contention with generous, adaptive timeouts
7. **State Persistence**: Persist operation state at each step to enable recovery from partial failures
8. **Circuit Breakers**: Stop retrying persistent failures to prevent cascading overload
9. **Separation of Concerns**: Isolate coordination components from heavy workloads

---

## References and Further Reading

The patterns and anti-patterns in this document are derived from production failures and distributed systems research:

- **Jepsen Testing**: Kyle Kingsbury's analyses of distributed database failures under partition
- **AWS Builder's Library**: AWS engineering team's patterns for timeouts, retries, and backoff
- **etcd Documentation**: Raft consensus, split-brain prevention, and fencing mechanisms
- **Production Incidents**: Real-world failures from ElasticSearch, MongoDB, RabbitMQ, and cloud providers
- **Academic Research**: Raft (Ongaro & Ousterhout), Paxos (Lamport), Byzantine Generals Problem

This document focuses on practical, actionable patterns suitable for training LLMs to recognize and prevent distributed systems failures in code review and generation tasks.
