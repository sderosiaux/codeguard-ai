# Concurrency Bug Patterns

This document catalogs common concurrency bugs found in production systems, with code examples and detection patterns.

## 1. Memory Visibility Issues

### Description
Without proper synchronization or volatile keywords, changes to shared fields made by one thread may never be visible to other threads due to CPU caches and compiler optimizations. This leads to threads seeing stale data indefinitely.

### Bad Example (Java)
```java
public class TaskProcessor {
    private boolean shutdownRequested = false;  // Missing volatile!

    public void run() {
        while (!shutdownRequested) {  // May never see the change
            processTask();
        }
    }

    public void shutdown() {
        shutdownRequested = true;  // Write may never be visible to run()
    }
}
```

**Bug**: The thread executing `run()` may cache `shutdownRequested` and never see the update, causing it to run forever.

### Bad Example - Double-Checked Locking (Java)
```java
public class ConnectionPool {
    private Connection connection;  // Missing volatile!

    public Connection getConnection() {
        if (connection == null) {  // First check (no lock)
            synchronized(this) {
                if (connection == null) {  // Second check (with lock)
                    connection = new Connection();  // Partially constructed object can be visible!
                }
            }
        }
        return connection;  // May return partially constructed object
    }
}
```

**Bug**: Without `volatile`, another thread may see a non-null `connection` reference that points to a partially constructed object.

### Good Example (Java)
```java
public class TaskProcessor {
    private volatile boolean shutdownRequested = false;  // volatile ensures visibility

    public void run() {
        while (!shutdownRequested) {
            processTask();
        }
    }

    public void shutdown() {
        shutdownRequested = true;
    }
}

// Double-checked locking fixed:
public class ConnectionPool {
    private volatile Connection connection;  // volatile is critical here

    public Connection getConnection() {
        if (connection == null) {
            synchronized(this) {
                if (connection == null) {
                    connection = new Connection();
                }
            }
        }
        return connection;
    }
}
```

### Bad Example (Python)
```python
class TaskProcessor:
    def __init__(self):
        self.shutdown_requested = False  # No memory barrier

    def run(self):
        while not self.shutdown_requested:  # May not see updates
            self.process_task()

    def shutdown(self):
        self.shutdown_requested = True  # Update may not be visible
```

**Bug**: CPython's GIL provides some protection, but in implementations like Jython or when using multiprocessing, this pattern fails.

### Good Example (Python)
```python
import threading

class TaskProcessor:
    def __init__(self):
        self.shutdown_event = threading.Event()  # Proper synchronization primitive

    def run(self):
        while not self.shutdown_event.is_set():
            self.process_task()

    def shutdown(self):
        self.shutdown_event.set()
```

### Search Patterns
```bash
# Find shared mutable fields without volatile (Java)
grep -n "private.*boolean.*=" *.java | grep -v volatile | grep -v final

# Find double-checked locking without volatile
grep -B5 "synchronized.*{" *.java | grep -A10 "if.*== null"

# Find shared state in Python without threading primitives
grep -n "self\.[a-z_]* = False" *.py
```

### Key Takeaway
**Always use `volatile` (Java) or proper synchronization primitives (Python) for shared state that's written by one thread and read by another. Memory visibility is not guaranteed without them.**

---

## 2. Check-Then-Act Race Conditions

### Description
A time gap between checking a condition and acting on it allows other threads to change the state, making the original check invalid. This is one of the most common concurrency bugs.

### Bad Example (Java)
```java
public class UserCache {
    private ConcurrentHashMap<String, User> cache = new ConcurrentHashMap<>();

    public void addUser(String id, User user) {
        if (cache.get(id) == null) {  // Check
            cache.put(id, user);       // Act - another thread may have inserted between check and act!
        }
    }

    public User getOrCreate(String id) {
        if (!cache.containsKey(id)) {  // Check
            cache.put(id, new User(id));  // Act - race condition!
        }
        return cache.get(id);  // May return null if key was removed!
    }
}
```

**Bug**: Between the check (`get() == null`) and the act (`put()`), another thread can insert the same key, causing overwrites or inconsistent state.

### Bad Example - Queue Operations (Java)
```java
public class MessageProcessor {
    private BlockingQueue<Message> queue = new LinkedBlockingQueue<>();

    public void processNext() {
        if (queue.peek() != null) {  // Check if queue has items
            Message msg = queue.poll();  // Act - queue may be empty now!
            if (msg != null) {  // Defensive check masks the bug
                process(msg);
            }
        }
    }
}
```

**Bug**: Between `peek()` and `poll()`, another thread may have removed all items.

### Bad Example - Size Check (Java)
```java
public class BatchProcessor {
    private ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();

    public void processBatch() {
        if (tasks.size() >= 10) {  // Check
            // Another thread may remove items here!
            for (String key : tasks.keySet()) {  // Act on assumption that size >= 10
                processTask(tasks.get(key));
            }
        }
    }
}
```

**Bug**: `size()` on concurrent collections is only a snapshot; the size can change immediately after checking.

### Good Example (Java)
```java
public class UserCache {
    private ConcurrentHashMap<String, User> cache = new ConcurrentHashMap<>();

    public void addUser(String id, User user) {
        cache.putIfAbsent(id, user);  // Atomic check-then-act
    }

    public User getOrCreate(String id) {
        return cache.computeIfAbsent(id, User::new);  // Atomic: computes only if absent
    }
}

public class MessageProcessor {
    private BlockingQueue<Message> queue = new LinkedBlockingQueue<>();

    public void processNext() {
        Message msg = queue.poll();  // Just poll, no separate check
        if (msg != null) {
            process(msg);
        }
    }
}
```

### Bad Example (Python)
```python
class UserCache:
    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def add_user(self, user_id, user):
        if user_id not in self.cache:  # Check without lock!
            self.cache[user_id] = user  # Act without lock! Race condition!
```

**Bug**: Check and act both need to be inside the same lock.

### Good Example (Python)
```python
class UserCache:
    def __init__(self):
        self.cache = {}
        self.lock = threading.Lock()

    def add_user(self, user_id, user):
        with self.lock:
            if user_id not in self.cache:  # Check and act both under lock
                self.cache[user_id] = user

    # Even better: use dict's atomic operation
    def add_user_atomic(self, user_id, user):
        with self.lock:
            self.cache.setdefault(user_id, user)  # Atomic in intent
```

### Search Patterns
```bash
# Find check-then-act patterns with get/put (Java)
grep -n "\.get(" *.java | grep -A3 "== null" | grep "\.put("

# Find peek followed by poll
grep -n "\.peek()" *.java | grep -A2 "\.poll()"

# Find size() checks followed by operations
grep -n "\.size()" *.java | grep -A5 ">="

# Find Python check-then-act without locks
grep -n "if.*not in" *.py | grep -A2 "self\."
```

### Key Takeaway
**Use atomic methods like `putIfAbsent()`, `computeIfAbsent()`, or `compute()` instead of separate check and act operations. The check and act must be atomic.**

---

## 3. Non-Atomic Compound Operations

### Description
Operations that look like a single logical action but consist of multiple non-atomic steps. Without atomicity, other threads can interleave and cause incorrect results.

### Bad Example - Read-Modify-Write (Java)
```java
public class CounterService {
    private ConcurrentHashMap<String, Integer> counters = new ConcurrentHashMap<>();

    public void increment(String key) {
        Integer current = counters.get(key);  // Read
        if (current == null) {
            current = 0;
        }
        counters.put(key, current + 1);  // Modify-Write - Lost updates!
    }
}
```

**Bug**: Two threads can read the same value (e.g., 5), both increment it to 6, and both write 6 instead of the correct final value of 7.

### Bad Example - Multiple Method Calls (Java)
```java
public class AccountService {
    private ConcurrentHashMap<String, Double> balances = new ConcurrentHashMap<>();

    public void transfer(String from, String to, double amount) {
        Double fromBalance = balances.get(from);  // Step 1
        if (fromBalance >= amount) {
            balances.put(from, fromBalance - amount);  // Step 2
            Double toBalance = balances.get(to);       // Step 3
            balances.put(to, toBalance + amount);      // Step 4
        }
    }
}
```

**Bug**: Another thread can modify balances between any of these steps, causing inconsistent state or lost updates.

### Bad Example - Size Check (Java)
```java
public class TaskQueue {
    private ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();

    public void addIfRoom(String id, Task task) {
        if (tasks.size() < 100) {  // Check size
            tasks.put(id, task);    // Add - may exceed 100!
        }
    }
}
```

**Bug**: `size()` is not synchronized with `put()`. Multiple threads can pass the size check simultaneously and cause the map to exceed 100 items.

### Good Example (Java)
```java
public class CounterService {
    private ConcurrentHashMap<String, AtomicInteger> counters = new ConcurrentHashMap<>();

    public void increment(String key) {
        counters.computeIfAbsent(key, k -> new AtomicInteger(0))
                .incrementAndGet();  // Atomic read-modify-write
    }

    // Or use merge for primitive values:
    public void incrementWithMerge(String key) {
        counters.merge(key, 1, Integer::sum);  // Atomic merge operation
    }
}

public class AccountService {
    private ConcurrentHashMap<String, Double> balances = new ConcurrentHashMap<>();
    private final Object transferLock = new Object();

    public void transfer(String from, String to, double amount) {
        synchronized(transferLock) {  // Entire operation is atomic
            Double fromBalance = balances.get(from);
            if (fromBalance >= amount) {
                balances.put(from, fromBalance - amount);
                balances.merge(to, amount, Double::sum);
            }
        }
    }
}

public class TaskQueue {
    private ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();
    private AtomicInteger count = new AtomicInteger(0);

    public void addIfRoom(String id, Task task) {
        if (count.get() < 100 && count.incrementAndGet() <= 100) {
            tasks.put(id, task);
        } else {
            count.decrementAndGet();  // Back off if over limit
        }
    }
}
```

### Bad Example (Python)
```python
class CounterService:
    def __init__(self):
        self.counters = {}

    def increment(self, key):
        current = self.counters.get(key, 0)  # Read
        self.counters[key] = current + 1     # Modify-Write - Lost updates!
```

**Bug**: Race condition leads to lost increments.

### Good Example (Python)
```python
import threading
from collections import defaultdict

class CounterService:
    def __init__(self):
        self.counters = defaultdict(int)
        self.lock = threading.Lock()

    def increment(self, key):
        with self.lock:
            self.counters[key] += 1  # Entire operation under lock
```

### Search Patterns
```bash
# Find get followed by put (Java)
grep -n "\.get(" *.java | grep -B2 -A2 "\.put("

# Find read-modify-write patterns
grep -n "= .*\.get(" *.java | grep -A3 "+ 1\|+= 1\|- 1"

# Find size() used for capacity checks
grep -n "\.size().*<\|\.size().*>" *.java

# Python increment patterns without locks
grep -n "\[.*\] = .*\[.*\] + 1" *.py
```

### Key Takeaway
**Use atomic methods like `compute()`, `merge()`, or `computeIfPresent()` for compound operations. If not possible, synchronize the entire logical operation.**

---

## 4. Integer Overflow in Concurrent Counters

### Description
Integer counters that wrap around on overflow can cause serious bugs, especially when used for array indexing or capacity tracking. This is particularly dangerous in high-throughput systems.

### Bad Example - AtomicInteger Overflow (Java)
```java
public class RequestTracker {
    private AtomicInteger requestCounter = new AtomicInteger(0);

    public long getNextRequestId() {
        return requestCounter.incrementAndGet();  // Will wrap to negative at 2^31!
    }

    public void recordRequest(long requestId) {
        // requestId may be negative after overflow!
        if (requestId < 0) {
            throw new IllegalStateException("Request ID overflow!");
        }
    }
}
```

**Bug**: `AtomicInteger` wraps to `Integer.MIN_VALUE` after `Integer.MAX_VALUE`, causing negative IDs.

### Bad Example - Array Indexing with Bitwise AND (Java)
```java
public class CircularBuffer {
    private static final int SIZE = 1000;  // NOT a power of 2!
    private Object[] buffer = new Object[SIZE];
    private AtomicInteger index = new AtomicInteger(0);

    public void add(Object item) {
        int i = index.getAndIncrement() & (SIZE - 1);  // Wrong! Only works for powers of 2
        buffer[i] = item;  // May access wrong index since 999 & 1000-1 = 999, but 1000 & 999 = 1000 (out of bounds)
    }
}
```

**Bug**: Bitwise AND with `(SIZE - 1)` only works correctly when SIZE is a power of 2. For non-power-of-2 sizes, this will cause out-of-bounds access or incorrect indexing.

### Bad Example - Counter for Indexing (Java)
```java
public class ShardedCache {
    private static final int SHARD_COUNT = 10;
    private Cache[] shards = new Cache[SHARD_COUNT];
    private AtomicInteger counter = new AtomicInteger(0);

    public void put(String key, Object value) {
        int shardIndex = counter.getAndIncrement() % SHARD_COUNT;  // Negative after overflow!
        shards[shardIndex].put(key, value);  // ArrayIndexOutOfBoundsException when counter wraps!
    }
}
```

**Bug**: After overflow, `counter` becomes negative, and `negative % SHARD_COUNT` returns a negative number, causing `ArrayIndexOutOfBoundsException`.

### Good Example (Java)
```java
public class RequestTracker {
    private AtomicLong requestCounter = new AtomicLong(0);  // Use long to avoid overflow

    public long getNextRequestId() {
        return requestCounter.incrementAndGet();  // 2^63 requests before overflow
    }
}

public class CircularBuffer {
    private static final int SIZE = 1024;  // Power of 2!
    private Object[] buffer = new Object[SIZE];
    private AtomicInteger index = new AtomicInteger(0);

    public void add(Object item) {
        int i = index.getAndIncrement() & (SIZE - 1);  // Correct with power of 2
        buffer[i] = item;
    }

    // Or for non-power-of-2:
    private static final int SIZE_NON_POW2 = 1000;
    private Object[] buffer2 = new Object[SIZE_NON_POW2];
    private AtomicInteger index2 = new AtomicInteger(0);

    public void addNonPow2(Object item) {
        int i = Math.abs(index2.getAndIncrement()) % SIZE_NON_POW2;  // Use modulo
        buffer2[i] = item;
    }
}

public class ShardedCache {
    private static final int SHARD_COUNT = 10;
    private Cache[] shards = new Cache[SHARD_COUNT];
    private AtomicInteger counter = new AtomicInteger(0);

    public void put(String key, Object value) {
        int count = counter.getAndIncrement();
        int shardIndex = Math.abs(count) % SHARD_COUNT;  // Handle negatives correctly
        shards[shardIndex].put(key, value);
    }

    // Even better: use the key's hash
    public void putWithHash(String key, Object value) {
        int shardIndex = Math.abs(key.hashCode()) % SHARD_COUNT;
        shards[shardIndex].put(key, value);
    }
}
```

### Bad Example (Python)
```python
import threading

class RequestTracker:
    def __init__(self):
        self.counter = 0
        self.lock = threading.Lock()

    def get_next_id(self):
        with self.lock:
            self.counter += 1
            if self.counter > 2**31:  # Trying to prevent overflow
                self.counter = 0  # Wrong! Creates duplicate IDs
            return self.counter
```

**Bug**: Resetting the counter creates duplicate IDs.

### Good Example (Python)
```python
import threading
import itertools

class RequestTracker:
    def __init__(self):
        self.counter = itertools.count(start=1)  # Unbounded counter

    def get_next_id(self):
        return next(self.counter)  # Python ints have unlimited precision

# For indexing:
class ShardedCache:
    def __init__(self):
        self.shards = [Cache() for _ in range(10)]
        self.counter = itertools.count()

    def put(self, key, value):
        # Use key hash instead of counter for sharding
        shard_index = abs(hash(key)) % len(self.shards)
        self.shards[shard_index].put(key, value)
```

### Search Patterns
```bash
# Find AtomicInteger used for IDs or indexing
grep -n "AtomicInteger.*Id\|AtomicInteger.*index" *.java

# Find bitwise AND with size-1
grep -n "& (.*SIZE.*- 1)\|& (.*LENGTH.*- 1)" *.java

# Find modulo operations on potentially negative numbers
grep -n "% [0-9]\+\|% SIZE\|% COUNT" *.java | grep -B3 "getAndIncrement\|incrementAndGet"

# Find counter wrapping logic
grep -n "counter.*= 0\|reset.*counter" *.py *.java
```

### Key Takeaway
**Use `AtomicLong` instead of `AtomicInteger` for counters that may overflow. When using bitwise AND for indexing, ensure the size is a power of 2. When using modulo, wrap with `Math.abs()` to handle negative values correctly.**

---

## 5. Incorrect Concurrent Collection Usage

### Description
Using concurrent collections incorrectly defeats their thread-safety guarantees. Common mistakes include iterating while modifying, making assumptions about size, or using the wrong collection type.

### Bad Example - Iteration While Modifying (Java)
```java
public class TaskManager {
    private ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();

    public void removeCompletedTasks() {
        for (String key : tasks.keySet()) {  // Weakly consistent iterator
            if (tasks.get(key).isCompleted()) {  // Task may have been removed!
                tasks.remove(key);  // May not remove all completed tasks
            }
        }
    }
}
```

**Bug**: The iterator is weakly consistent - it may not reflect additions, removals, or updates that occur during iteration. The task retrieved by `get(key)` might be null or different from when the key was returned by the iterator.

### Bad Example - Assuming Accurate Size (Java)
```java
public class ConnectionPool {
    private ConcurrentHashMap<String, Connection> connections = new ConcurrentHashMap<>();
    private static final int MAX_CONNECTIONS = 100;

    public Connection getOrCreateConnection(String host) {
        if (connections.size() < MAX_CONNECTIONS) {  // Size is just a snapshot
            return connections.computeIfAbsent(host, h -> new Connection(h));
            // May create more than MAX_CONNECTIONS!
        }
        return null;
    }
}
```

**Bug**: Multiple threads can pass the size check simultaneously before any `computeIfAbsent` completes, exceeding the maximum.

### Bad Example - Wrong Collection Type (Java)
```java
public class EventLog {
    // Need ordering but using HashMap
    private ConcurrentHashMap<Long, Event> events = new ConcurrentHashMap<>();

    public void addEvent(Event event) {
        events.put(event.timestamp(), event);
    }

    public List<Event> getRecentEvents(int count) {
        // No guarantee of order!
        return events.values().stream()
                .limit(count)
                .collect(Collectors.toList());
    }
}
```

**Bug**: `ConcurrentHashMap` doesn't maintain insertion order or sort by key. Should use `ConcurrentSkipListMap` for sorted access.

### Good Example (Java)
```java
public class TaskManager {
    private ConcurrentHashMap<String, Task> tasks = new ConcurrentHashMap<>();

    public void removeCompletedTasks() {
        // Use removeIf or compute functions
        tasks.entrySet().removeIf(entry -> entry.getValue().isCompleted());
    }

    // Or use compute to atomically check and remove:
    public void removeTaskIfCompleted(String key) {
        tasks.computeIfPresent(key, (k, task) ->
            task.isCompleted() ? null : task  // Returning null removes the entry
        );
    }
}

public class ConnectionPool {
    private ConcurrentHashMap<String, Connection> connections = new ConcurrentHashMap<>();
    private AtomicInteger connectionCount = new AtomicInteger(0);
    private static final int MAX_CONNECTIONS = 100;

    public Connection getOrCreateConnection(String host) {
        if (connectionCount.get() >= MAX_CONNECTIONS) {
            return null;
        }

        return connections.computeIfAbsent(host, h -> {
            if (connectionCount.incrementAndGet() <= MAX_CONNECTIONS) {
                return new Connection(h);
            } else {
                connectionCount.decrementAndGet();
                return null;
            }
        });
    }
}

public class EventLog {
    // Use ConcurrentSkipListMap for sorted keys
    private ConcurrentSkipListMap<Long, Event> events = new ConcurrentSkipListMap<>();

    public void addEvent(Event event) {
        events.put(event.timestamp(), event);
    }

    public List<Event> getRecentEvents(int count) {
        return events.descendingMap().values().stream()
                .limit(count)
                .collect(Collectors.toList());
    }
}
```

### Bad Example (Python)
```python
import threading

class TaskManager:
    def __init__(self):
        self.tasks = {}  # Regular dict

    def remove_completed_tasks(self):
        # RuntimeError: dictionary changed size during iteration
        for key in self.tasks.keys():
            if self.tasks[key].is_completed():
                del self.tasks[key]  # Modifying while iterating!
```

**Bug**: Python raises `RuntimeError` when dictionary size changes during iteration.

### Good Example (Python)
```python
import threading

class TaskManager:
    def __init__(self):
        self.tasks = {}
        self.lock = threading.Lock()

    def remove_completed_tasks(self):
        with self.lock:
            # Create list of keys to remove
            keys_to_remove = [key for key, task in self.tasks.items()
                            if task.is_completed()]
            for key in keys_to_remove:
                del self.tasks[key]

    # Or use dictionary comprehension to create new dict:
    def remove_completed_tasks_v2(self):
        with self.lock:
            self.tasks = {k: v for k, v in self.tasks.items()
                         if not v.is_completed()}
```

### Search Patterns
```bash
# Find iteration with modification
grep -n "for.*keySet()\|for.*entrySet()" *.java | grep -A5 "\.remove(\|\.put("

# Find size() used for capacity decisions
grep -n "\.size().*<.*MAX\|\.size().*>" *.java

# Find ConcurrentHashMap where ordering matters
grep -n "ConcurrentHashMap" *.java | grep -B5 "sort\|order\|first\|last"

# Python iteration with modification
grep -n "for.*in.*\.keys()\|for.*in.*\.items()" *.py | grep -A3 "del "
```

### Key Takeaway
**Use bulk atomic operations like `removeIf()`, `computeIfPresent()`, or iterate over a snapshot. Never rely on `size()` for correctness. Use `ConcurrentSkipListMap` when you need sorted concurrent access.**

---

## 6. Lock Issues

### Description
Locks are powerful but error-prone. Common mistakes include using locks that don't span distributed systems, creating deadlocks through inconsistent lock ordering, or missing locks entirely.

### Bad Example - synchronized Across JVMs (Java)
```java
public class DistributedCounter {
    private static int counter = 0;

    // Multiple instances across different servers
    public synchronized void increment() {  // Only synchronizes within one JVM!
        counter++;  // Race condition across servers
    }
}
```

**Bug**: `synchronized` only works within a single JVM. In distributed systems with multiple instances, each instance has its own lock, providing no coordination across servers.

### Bad Example - Deadlock from Inconsistent Lock Ordering (Java)
```java
public class BankingService {
    public void transfer(Account from, Account to, double amount) {
        synchronized(from) {  // Thread 1: locks A
            synchronized(to) {  // Thread 1: tries to lock B
                from.debit(amount);
                to.credit(amount);
            }
        }
    }

    // Meanwhile, another thread does:
    // transfer(accountB, accountA, 100)  -> Thread 2: locks B, tries to lock A
    // DEADLOCK!
}
```

**Bug**: If thread 1 calls `transfer(A, B)` while thread 2 calls `transfer(B, A)`, they acquire locks in opposite order and deadlock.

### Bad Example - Missing Lock (Java)
```java
public class StatsCollector {
    private Map<String, Integer> stats = new HashMap<>();  // Not thread-safe!

    public void recordStat(String key) {
        stats.merge(key, 1, Integer::sum);  // Race condition!
    }

    public synchronized Map<String, Integer> getStats() {  // Lock here doesn't help
        return new HashMap<>(stats);  // Reading unsafely
    }
}
```

**Bug**: `recordStat()` is not synchronized, allowing concurrent modifications to corrupt the HashMap. Synchronizing only `getStats()` doesn't protect writes.

### Bad Example - Locking on Mutable Object (Java)
```java
public class ConfigManager {
    private String config = "initial";  // String is reassigned, not mutated

    public void updateConfig(String newConfig) {
        synchronized(config) {  // Locking on object that changes!
            config = newConfig;  // Now locking on different object
        }
    }
}
```

**Bug**: Each time `config` is reassigned, the lock object changes. Different threads lock on different objects.

### Good Example (Java)
```java
// For distributed systems, use distributed locks
public class DistributedCounter {
    private RedissonClient redisson;
    private AtomicLong counter;

    public void increment() {
        RLock lock = redisson.getLock("counter-lock");
        lock.lock();
        try {
            counter.incrementAndGet();
        } finally {
            lock.unlock();
        }
    }
}

// Fix deadlock with consistent lock ordering
public class BankingService {
    public void transfer(Account from, Account to, double amount) {
        // Always lock accounts in consistent order (e.g., by ID)
        Account first = from.getId() < to.getId() ? from : to;
        Account second = from.getId() < to.getId() ? to : from;

        synchronized(first) {
            synchronized(second) {
                from.debit(amount);
                to.credit(amount);
            }
        }
    }
}

// Fix missing locks
public class StatsCollector {
    private Map<String, Integer> stats = new HashMap<>();
    private final Object lock = new Object();  // Dedicated lock object

    public void recordStat(String key) {
        synchronized(lock) {
            stats.merge(key, 1, Integer::sum);
        }
    }

    public Map<String, Integer> getStats() {
        synchronized(lock) {
            return new HashMap<>(stats);
        }
    }
}

// Fix locking on mutable object
public class ConfigManager {
    private String config = "initial";
    private final Object lock = new Object();  // Dedicated immutable lock

    public void updateConfig(String newConfig) {
        synchronized(lock) {
            config = newConfig;
        }
    }

    public String getConfig() {
        synchronized(lock) {
            return config;
        }
    }
}
```

### Bad Example (Python)
```python
class StatsCollector:
    def __init__(self):
        self.stats = {}
        # No lock!

    def record_stat(self, key):
        self.stats[key] = self.stats.get(key, 0) + 1  # Race condition!
```

**Bug**: Multiple threads can corrupt the dictionary.

### Good Example (Python)
```python
import threading
from collections import defaultdict

class StatsCollector:
    def __init__(self):
        self.stats = defaultdict(int)
        self.lock = threading.Lock()

    def record_stat(self, key):
        with self.lock:
            self.stats[key] += 1

    def get_stats(self):
        with self.lock:
            return dict(self.stats)

# For distributed systems, use Redis or database locks
import redis

class DistributedLockService:
    def __init__(self):
        self.redis = redis.Redis()

    def with_distributed_lock(self, lock_key, timeout=10):
        lock_value = str(uuid.uuid4())
        acquired = self.redis.set(lock_key, lock_value, nx=True, ex=timeout)
        if acquired:
            try:
                yield
            finally:
                # Release only if we still own the lock
                script = """
                if redis.call("get", KEYS[1]) == ARGV[1] then
                    return redis.call("del", KEYS[1])
                else
                    return 0
                end
                """
                self.redis.eval(script, 1, lock_key, lock_value)
```

### Search Patterns
```bash
# Find synchronized methods in classes that might be distributed
grep -n "synchronized.*void\|synchronized.*int" *.java | grep -B10 "@Service\|@Component"

# Find nested synchronized blocks (potential deadlock)
grep -n "synchronized" *.java | grep -A10 "synchronized"

# Find unsynchronized access to shared mutable state
grep -n "private.*Map\|private.*List" *.java | grep -v "final\|synchronized\|Concurrent"

# Find locks on non-final objects
grep -n "synchronized(" *.java | grep "this\.\|[a-z]"

# Python missing locks
grep -n "self\.[a-z_]* = " *.py | grep -B10 "class.*Thread\|threading"
```

### Key Takeaway
**Use distributed locks (Redis, Zookeeper) for coordination across JVMs. Always acquire multiple locks in a consistent order (e.g., sorted by ID). Use dedicated `final` lock objects instead of locking on `this` or mutable fields.**

---

## 7. Fire-and-Forget Async

### Description
Starting asynchronous operations without proper error handling means failures silently disappear. This is especially dangerous in production where silent failures can cascade into larger issues.

### Bad Example - CompletableFuture Without Error Handling (Java)
```java
public class NotificationService {
    private ExecutorService executor = Executors.newFixedThreadPool(10);

    public void sendNotification(String userId, String message) {
        CompletableFuture.runAsync(() -> {
            emailService.send(userId, message);  // If this throws, no one knows!
        }, executor);
        // Caller thinks notification succeeded, but it may have failed
    }
}
```

**Bug**: If `emailService.send()` throws an exception, it's swallowed by the CompletableFuture and never logged or handled.

### Bad Example - Kafka Producer Without Ack (Java)
```java
public class EventPublisher {
    private KafkaProducer<String, String> producer;

    public void publishEvent(Event event) {
        ProducerRecord<String, String> record =
            new ProducerRecord<>("events", event.toJson());
        producer.send(record);  // Fire and forget - no idea if it succeeded!
    }
}
```

**Bug**: `send()` returns immediately without waiting for acknowledgment. The message may never reach Kafka due to network issues, serialization errors, or broker unavailability.

### Bad Example - Uncaught Thread Exceptions (Java)
```java
public class BackgroundProcessor {
    public void startProcessing() {
        new Thread(() -> {
            processData();  // If this throws, thread dies silently
        }).start();
    }
}
```

**Bug**: Uncaught exceptions in threads cause them to die silently without any notification.

### Bad Example - HTTP Client Without Error Handling (Java)
```java
public class WebhookService {
    private HttpClient httpClient = HttpClient.newHttpClient();

    public void sendWebhook(String url, String payload) {
        httpClient.sendAsync(
            HttpRequest.newBuilder().uri(URI.create(url))
                      .POST(HttpRequest.BodyPublishers.ofString(payload))
                      .build(),
            HttpResponse.BodyHandlers.ofString()
        );  // No error handling!
    }
}
```

**Bug**: Network failures, timeouts, or 5xx responses are silently ignored.

### Good Example (Java)
```java
public class NotificationService {
    private static final Logger logger = LoggerFactory.getLogger(NotificationService.class);
    private ExecutorService executor = Executors.newFixedThreadPool(10);

    public CompletableFuture<Void> sendNotification(String userId, String message) {
        return CompletableFuture.runAsync(() -> {
            try {
                emailService.send(userId, message);
            } catch (Exception e) {
                logger.error("Failed to send notification to user {}", userId, e);
                throw e;  // Re-throw to mark future as failed
            }
        }, executor)
        .exceptionally(ex -> {
            // Handle failure, maybe retry or alert
            alertService.notifyFailure("Email notification failed", ex);
            return null;
        });
    }
}

public class EventPublisher {
    private static final Logger logger = LoggerFactory.getLogger(EventPublisher.class);
    private KafkaProducer<String, String> producer;

    public void publishEvent(Event event) {
        ProducerRecord<String, String> record =
            new ProducerRecord<>("events", event.toJson());

        producer.send(record, (metadata, exception) -> {
            if (exception != null) {
                logger.error("Failed to publish event {}", event.getId(), exception);
                // Retry logic, dead letter queue, or alert
                deadLetterQueue.add(event);
            } else {
                logger.debug("Published event {} to partition {}",
                           event.getId(), metadata.partition());
            }
        });
    }
}

public class BackgroundProcessor {
    private static final Logger logger = LoggerFactory.getLogger(BackgroundProcessor.class);

    public void startProcessing() {
        Thread thread = new Thread(() -> {
            try {
                processData();
            } catch (Exception e) {
                logger.error("Background processing failed", e);
                // Alert, restart, or recover
            }
        });

        thread.setUncaughtExceptionHandler((t, e) -> {
            logger.error("Uncaught exception in thread {}", t.getName(), e);
            alertService.criticalAlert("Background thread died", e);
        });

        thread.start();
    }
}

public class WebhookService {
    private static final Logger logger = LoggerFactory.getLogger(WebhookService.class);
    private HttpClient httpClient = HttpClient.newHttpClient();

    public CompletableFuture<String> sendWebhook(String url, String payload) {
        return httpClient.sendAsync(
            HttpRequest.newBuilder().uri(URI.create(url))
                      .POST(HttpRequest.BodyPublishers.ofString(payload))
                      .timeout(Duration.ofSeconds(10))
                      .build(),
            HttpResponse.BodyHandlers.ofString()
        )
        .thenApply(response -> {
            if (response.statusCode() >= 400) {
                logger.warn("Webhook returned status {}: {}",
                          response.statusCode(), response.body());
            }
            return response.body();
        })
        .exceptionally(ex -> {
            logger.error("Webhook failed for URL {}", url, ex);
            // Retry with exponential backoff, or add to retry queue
            retryQueue.add(new WebhookTask(url, payload));
            return null;
        });
    }
}
```

### Bad Example (Python)
```python
import threading

class NotificationService:
    def send_notification(self, user_id, message):
        # Fire and forget
        threading.Thread(target=lambda: self._send(user_id, message)).start()

    def _send(self, user_id, message):
        email_service.send(user_id, message)  # Exception disappears!
```

**Bug**: Exceptions in threads are not propagated to the caller.

### Good Example (Python)
```python
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
import asyncio

logger = logging.getLogger(__name__)

class NotificationService:
    def __init__(self):
        self.executor = ThreadPoolExecutor(max_workers=10)

    def send_notification(self, user_id, message):
        future = self.executor.submit(self._send, user_id, message)
        future.add_done_callback(self._handle_result)
        return future

    def _send(self, user_id, message):
        try:
            email_service.send(user_id, message)
        except Exception as e:
            logger.error(f"Failed to send notification to {user_id}", exc_info=True)
            raise

    def _handle_result(self, future):
        try:
            future.result()  # Re-raises exception if any
        except Exception as e:
            logger.error("Notification failed", exc_info=True)
            # Alert or retry

# Async version with proper error handling
class AsyncNotificationService:
    async def send_notification(self, user_id, message):
        try:
            await email_service.send_async(user_id, message)
        except Exception as e:
            logger.error(f"Failed to send notification to {user_id}", exc_info=True)
            # Retry or alert
            await self.handle_failure(user_id, message, e)

    async def handle_failure(self, user_id, message, error):
        # Implement retry logic or dead letter queue
        await retry_queue.add((user_id, message))
```

### Search Patterns
```bash
# Find CompletableFuture without error handling
grep -n "CompletableFuture\.runAsync\|CompletableFuture\.supplyAsync" *.java | grep -v "exceptionally\|handle\|whenComplete"

# Find Kafka send without callback
grep -n "producer\.send(" *.java | grep -v "\.send(.*,.*->"

# Find new Thread without exception handler
grep -n "new Thread\|\.start()" *.java | grep -B5 -A5 -v "UncaughtExceptionHandler"

# Find async HTTP calls without error handling
grep -n "sendAsync\|executeAsync" *.java | grep -v "exceptionally\|catch"

# Python thread start without error handling
grep -n "Thread(target=" *.py | grep -v "try:\|except:"
```

### Key Takeaway
**Never fire-and-forget async operations. Always attach error handlers using `.exceptionally()`, callbacks, or try-catch blocks. Log failures, implement retries, and alert on critical failures. Use `UncaughtExceptionHandler` for threads.**

---

## Summary Table

| Pattern | Key Indicator | Fix |
|---------|---------------|-----|
| Memory Visibility | Shared field without `volatile` | Add `volatile` or use synchronization primitives |
| Check-Then-Act | `if (map.get(key) == null) map.put(...)` | Use `putIfAbsent()`, `computeIfAbsent()` |
| Non-Atomic Compound | `get()` followed by `put()` | Use `compute()`, `merge()`, or lock entire operation |
| Integer Overflow | `AtomicInteger` for IDs/indexing | Use `AtomicLong` or handle overflow explicitly |
| Collection Misuse | Iterating while modifying | Use `removeIf()` or iterate over snapshot |
| Lock Issues | `synchronized` in distributed system | Use distributed locks (Redis, Zookeeper) |
| Fire-and-Forget | `CompletableFuture.runAsync()` without handlers | Add `.exceptionally()` or `.handle()` |

---

## General Detection Strategy

1. **Look for shared mutable state** - Any field accessed by multiple threads needs synchronization
2. **Find time gaps** - Operations split into check-then-act or read-modify-write
3. **Check atomicity** - Multiple method calls that should be atomic
4. **Review arithmetic** - Counters that can overflow or go negative
5. **Inspect collections** - Concurrent collections used incorrectly
6. **Trace lock scope** - Locks that don't span the full critical section
7. **Follow async paths** - Async operations without error handling

---

## References and Further Reading

- Java Concurrency in Practice (Goetz et al.)
- The Art of Multiprocessor Programming (Herlihy & Shavit)
- JDK ConcurrentHashMap JavaDoc
- Python `threading` module documentation
- Redis distributed locking (Redlock algorithm)
