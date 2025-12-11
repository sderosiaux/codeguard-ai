# Kafka Consumer Anti-Patterns

This document catalogs common anti-patterns, bugs, and misconfigurations in Kafka consumer implementations across Java, Python, and Kotlin. Each pattern includes detection hints and code examples showing both problematic and corrected implementations.

---

## Table of Contents

1. [Poll Loop Anti-Patterns](#poll-loop-anti-patterns)
2. [Commit Timing Anti-Patterns](#commit-timing-anti-patterns)
3. [Rebalance Anti-Patterns](#rebalance-anti-patterns)
4. [Configuration Anti-Patterns](#configuration-anti-patterns)
5. [Partition Assignment Anti-Patterns](#partition-assignment-anti-patterns)
6. [Async Processing Anti-Patterns](#async-processing-anti-patterns)

---

## Poll Loop Anti-Patterns

### 1. Blocking Poll Loop (Synchronous Processing)

**Description:** Processing messages synchronously within the poll loop blocks the consumer thread, preventing heartbeats from being sent to the broker. When processing time exceeds `max.poll.interval.ms`, the broker considers the consumer dead and triggers a rebalance.

**Impact:**
- Unnecessary rebalances
- Duplicate message processing
- Consumer group instability
- Processing delays across all partitions

**Detection Hints:**
```bash
# Grep for synchronous processing in poll loop
grep -A 10 "consumer\.poll" | grep -v "executor\|async\|Future\|CompletableFuture"

# Check for missing pause/resume patterns
grep -L "pause\|resume" consumer_files.java

# Look for long-running operations in poll loop
grep -A 20 "consumer\.poll" | grep "http\|database\|sleep\|Thread.sleep"
```

**Configuration Indicators:**
- `max.poll.interval.ms` is default (300000ms/5 minutes) with complex processing
- Frequent `CommitFailedException` in logs
- Rebalance logs showing "member failed to send heartbeat"

**Bad Example (Java):**
```java
public class BlockingConsumer {
    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                // ANTI-PATTERN: Blocking synchronous processing
                processMessage(record);  // Takes 10+ seconds
                callExternalAPI(record);  // Network I/O blocks thread
                writeToDatabase(record);  // DB operation blocks thread
            }

            consumer.commitSync();
        }
    }
}
```

**Bad Example (Python):**
```python
from kafka import KafkaConsumer

consumer = KafkaConsumer('my-topic')

for message in consumer:
    # ANTI-PATTERN: Blocking processing prevents heartbeats
    process_message(message)  # Takes 10+ seconds
    call_external_api(message.value)  # Blocks the consumer thread
    write_to_database(message.value)
    # No heartbeat sent during processing!
```

**Good Example (Java) - Async Processing with Pause/Resume:**
```java
public class NonBlockingConsumer {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);
    private final KafkaConsumer<String, String> consumer;

    @KafkaListener(
        topics = {"my-topic"},
        id = "${kafka.container.id}",
        properties = {
            "max.poll.interval.ms=30000",
            "max.poll.records=10"
        }
    )
    public void consume(String message) {
        // Pause consumption during processing
        consumer.pause(consumer.assignment());

        CompletableFuture
            .supplyAsync(() -> processMessage(message), executor)
            .thenAccept(result -> {
                // Resume after processing completes
                consumer.resume(consumer.assignment());
            })
            .exceptionally(ex -> {
                consumer.resume(consumer.assignment());
                return null;
            });
    }
}
```

**Good Example (Python) - Separate Processing Thread:**
```python
from kafka import KafkaConsumer
from concurrent.futures import ThreadPoolExecutor
import queue

consumer = KafkaConsumer(
    'my-topic',
    max_poll_interval_ms=300000,
    max_poll_records=10
)

executor = ThreadPoolExecutor(max_workers=10)
message_queue = queue.Queue(maxsize=100)

def process_worker():
    while True:
        message = message_queue.get()
        try:
            process_message(message)
            call_external_api(message.value)
            write_to_database(message.value)
        finally:
            message_queue.task_done()

# Start worker threads
for _ in range(10):
    executor.submit(process_worker)

# Non-blocking poll loop
for message in consumer:
    message_queue.put(message)  # Quick handoff, continue polling
```

**Good Example (Kotlin) - Coroutines:**
```kotlin
class NonBlockingConsumer(
    private val consumer: KafkaConsumer<String, String>
) {
    suspend fun consume() = coroutineScope {
        while (isActive) {
            val records = consumer.poll(Duration.ofMillis(100))

            records.forEach { record ->
                // Launch async coroutine, don't block poll loop
                launch(Dispatchers.IO) {
                    processMessage(record)
                }
            }
        }
    }
}
```

---

### 2. Poll Timeout Confusion (Indefinite Blocking)

**Description:** Using deprecated `poll(long timeout)` or misconfiguring poll duration can cause indefinite blocking, even when a timeout is specified. The consumer may spin indefinitely waiting for cluster metadata.

**Impact:**
- Consumer appears to hang
- Unable to gracefully shutdown
- Resource exhaustion

**Detection Hints:**
```bash
# Look for deprecated poll method
grep "poll([0-9]\+)" *.java

# Check for missing wakeup mechanism
grep -L "wakeup()" consumer_files.java
```

**Bad Example (Java):**
```java
public class BlockingPollConsumer {
    public void consume() {
        while (running) {
            // ANTI-PATTERN: Deprecated method, may block indefinitely
            ConsumerRecords<String, String> records = consumer.poll(1000);

            for (ConsumerRecord<String, String> record : records) {
                process(record);
            }
        }
        // Can't gracefully shutdown - no wakeup mechanism
    }
}
```

**Good Example (Java):**
```java
public class GracefulConsumer {
    private final AtomicBoolean running = new AtomicBoolean(true);
    private final KafkaConsumer<String, String> consumer;

    public void consume() {
        try {
            while (running.get()) {
                // Use Duration-based poll (not deprecated)
                ConsumerRecords<String, String> records =
                    consumer.poll(Duration.ofMillis(100));

                for (ConsumerRecord<String, String> record : records) {
                    process(record);
                }
            }
        } catch (WakeupException e) {
            // Expected on shutdown
        } finally {
            consumer.close();
        }
    }

    public void shutdown() {
        running.set(false);
        consumer.wakeup();  // Interrupt blocking poll
    }
}
```

---

### 3. Processing Before All Records Consumed

**Description:** With auto-commit enabled, starting to process records from a `ConsumerRecords` batch without consuming all of them before the next poll can cause offsets to be committed for unprocessed messages.

**Impact:**
- Message loss
- Incorrect offset tracking
- Silent data skipping

**Detection Hints:**
```bash
# Check for early poll calls or incomplete iteration
grep -A 15 "consumer\.poll" | grep "break\|return\|continue"

# Verify enable.auto.commit setting
grep "enable.auto.commit.*true" config_files
```

**Bad Example (Java):**
```java
public class IncompleteProcessingConsumer {
    public void consume() {
        consumer.subscribe(Arrays.asList("my-topic"));

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                if (shouldSkip(record)) {
                    // ANTI-PATTERN: Breaking out without processing all records
                    // Auto-commit may commit offsets for unprocessed messages
                    break;
                }
                process(record);
            }
            // Next poll() may trigger auto-commit for ALL polled records
        }
    }
}
```

**Good Example (Java):**
```java
public class CompleteProcessingConsumer {
    public void consume() {
        Properties props = new Properties();
        props.put("enable.auto.commit", "false");  // Disable auto-commit

        consumer.subscribe(Arrays.asList("my-topic"));

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            // Process ALL records before committing
            for (ConsumerRecord<String, String> record : records) {
                process(record);
            }

            // Manual commit only after all records processed
            consumer.commitSync();
        }
    }
}
```

---

## Commit Timing Anti-Patterns

### 4. Commit Before Processing (Data Loss)

**Description:** Committing offsets before actually processing messages causes data loss when the consumer crashes. This is the most critical consumer anti-pattern.

**Impact:**
- **Permanent data loss**
- Messages marked as consumed but never processed
- At-most-once delivery (usually unwanted)

**Detection Hints:**
```bash
# Look for commits before processing
grep -B 5 "commit" consumer_files | grep "poll"

# Check for auto-commit with async processing
grep "enable.auto.commit.*true" | xargs grep -l "async\|executor\|Future"

# Look for commits in wrong order
grep -A 10 "consumer\.poll" | grep -B 3 "commitSync\|commitAsync"
```

**Bad Example (Java):**
```java
public class CommitBeforeProcessing {
    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            // ANTI-PATTERN: Commit BEFORE processing
            consumer.commitSync();

            for (ConsumerRecord<String, String> record : records) {
                try {
                    processMessage(record);  // If this fails, message is lost!
                    writeToDatabase(record);  // If this fails, message is lost!
                } catch (Exception e) {
                    // Too late! Already committed. Message is LOST.
                    log.error("Failed to process, but already committed!", e);
                }
            }
        }
    }
}
```

**Bad Example (Python):**
```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'my-topic',
    enable_auto_commit=True,  # ANTI-PATTERN with slow processing
    auto_commit_interval_ms=5000
)

for message in consumer:
    # Auto-commit happens every 5 seconds, possibly BEFORE processing!
    time.sleep(10)  # Slow processing
    process_message(message)  # If crash happens here, message is lost!
```

**Good Example (Java):**
```java
public class CommitAfterProcessing {
    public void consume() {
        Properties props = new Properties();
        props.put("enable.auto.commit", "false");

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            // Process FIRST
            for (ConsumerRecord<String, String> record : records) {
                try {
                    processMessage(record);
                    writeToDatabase(record);
                } catch (Exception e) {
                    log.error("Processing failed, will retry on restart", e);
                    throw e;  // Don't commit if processing fails
                }
            }

            // Commit AFTER successful processing
            consumer.commitSync();
        }
    }
}
```

**Good Example (Python):**
```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'my-topic',
    enable_auto_commit=False  # Manual commit control
)

for message in consumer:
    try:
        # Process FIRST
        process_message(message)
        write_to_database(message.value)

        # Commit AFTER successful processing
        consumer.commit()
    except Exception as e:
        # Don't commit on failure - will reprocess on restart
        logger.error(f"Processing failed: {e}")
```

---

### 5. Async Commit Without Retry Logic

**Description:** Using `commitAsync()` without understanding that it doesn't retry on failure can lead to offset tracking issues. If an earlier async commit fails while a later one succeeds, retrying the earlier commit could cause duplicate consumption.

**Impact:**
- Lost offset tracking
- Potential duplicate processing
- Silent commit failures

**Detection Hints:**
```bash
# Look for commitAsync without callback
grep "commitAsync()" *.java | grep -v "OffsetCommitCallback"

# Check for commitAsync without final sync commit
grep -A 20 "commitAsync" | grep -L "commitSync.*finally\|close"
```

**Bad Example (Java):**
```java
public class AsyncCommitWithoutCallback {
    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                process(record);
            }

            // ANTI-PATTERN: No callback, no error handling
            consumer.commitAsync();
            // If this fails, we'll never know!
        }
    }
}
```

**Good Example (Java):**
```java
public class AsyncCommitWithCallback {
    public void consume() {
        try {
            while (running) {
                ConsumerRecords<String, String> records =
                    consumer.poll(Duration.ofMillis(100));

                for (ConsumerRecord<String, String> record : records) {
                    process(record);
                }

                // Async commit with callback for error handling
                consumer.commitAsync((offsets, exception) -> {
                    if (exception != null) {
                        log.error("Async commit failed for offsets: {}",
                                  offsets, exception);
                        // Consider alerting or metrics
                    }
                });
            }
        } finally {
            try {
                // IMPORTANT: Final sync commit ensures last offsets are committed
                consumer.commitSync();
            } finally {
                consumer.close();
            }
        }
    }
}
```

**Good Example (Kotlin):**
```kotlin
class SafeAsyncCommitConsumer(
    private val consumer: KafkaConsumer<String, String>
) {
    fun consume() {
        try {
            while (running) {
                val records = consumer.poll(Duration.ofMillis(100))

                records.forEach { record ->
                    process(record)
                }

                // Async commit with callback
                consumer.commitAsync { offsets, exception ->
                    exception?.let {
                        logger.error("Async commit failed", it)
                    }
                }
            }
        } finally {
            try {
                consumer.commitSync()  // Ensure final commit succeeds
            } finally {
                consumer.close()
            }
        }
    }
}
```

---

### 6. Commit During Rebalance

**Description:** Attempting to commit offsets during a rebalance fails because partitions are being reassigned. Without proper rebalance listeners, commits are lost.

**Impact:**
- `CommitFailedException`
- Lost progress tracking
- Duplicate message processing after rebalance

**Detection Hints:**
```bash
# Check for missing rebalance listeners
grep -L "ConsumerRebalanceListener" consumer_files.java

# Look for commits without rebalance handling
grep "commitSync\|commitAsync" | xargs grep -L "onPartitionsRevoked"
```

**Bad Example (Java):**
```java
public class NoRebalanceHandling {
    public void consume() {
        consumer.subscribe(Arrays.asList("my-topic"));

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                process(record);
            }

            // ANTI-PATTERN: Commit can fail during rebalance
            try {
                consumer.commitSync();
            } catch (CommitFailedException e) {
                // Rebalance happened, offsets not committed!
                log.error("Commit failed", e);
            }
        }
    }
}
```

**Good Example (Java):**
```java
public class RebalanceAwareConsumer {
    private Map<TopicPartition, OffsetAndMetadata> currentOffsets =
        new HashMap<>();

    public void consume() {
        consumer.subscribe(
            Arrays.asList("my-topic"),
            new ConsumerRebalanceListener() {
                @Override
                public void onPartitionsRevoked(
                    Collection<TopicPartition> partitions
                ) {
                    // Commit offsets before partitions are revoked
                    log.info("Committing offsets before rebalance");
                    consumer.commitSync(currentOffsets);
                }

                @Override
                public void onPartitionsAssigned(
                    Collection<TopicPartition> partitions
                ) {
                    log.info("Partitions assigned: {}", partitions);
                }
            }
        );

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                process(record);

                // Track offsets
                currentOffsets.put(
                    new TopicPartition(record.topic(), record.partition()),
                    new OffsetAndMetadata(record.offset() + 1)
                );
            }

            consumer.commitAsync(currentOffsets, null);
        }
    }
}
```

---

## Rebalance Anti-Patterns

### 7. Session Timeout vs Max Poll Interval Confusion

**Description:** Misunderstanding the difference between `session.timeout.ms` (heartbeat-based failure detection) and `max.poll.interval.ms` (poll interval-based failure detection) leads to inappropriate configuration and unnecessary rebalances.

**Key Differences:**
- **`session.timeout.ms`**: Detects consumer crashes/network failures via missing heartbeats
- **`max.poll.interval.ms`**: Detects slow message processing (alive but not polling)

**Impact:**
- Unnecessary rebalances
- Consumer marked as dead despite being healthy
- Processing interruptions

**Detection Hints:**
```bash
# Check for configuration issues
grep -E "session\.timeout\.ms|max\.poll\.interval\.ms" *.properties

# Look for logs indicating timeout issues
grep "consumer.*failed to send heartbeat\|max\.poll\.interval" logs/

# Check if heartbeat interval is misconfigured
# heartbeat.interval.ms should be < 1/3 of session.timeout.ms
```

**Configuration Indicators:**
- `session.timeout.ms` is too low (< 30000ms for complex processing)
- `max.poll.interval.ms` equals or is close to `session.timeout.ms`
- `heartbeat.interval.ms` is >= 1/3 of `session.timeout.ms`

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: Timeouts too low for processing needs
session.timeout.ms=10000
max.poll.interval.ms=15000
heartbeat.interval.ms=8000  # Too close to session timeout!
max.poll.records=500  # Too many records to process in 15 seconds
```

**Good Example (Configuration):**
```properties
# Proper configuration for processing-intensive consumers
# Session timeout: Detects actual consumer crashes
session.timeout.ms=60000

# Max poll interval: Allows time for processing
max.poll.interval.ms=300000  # 5 minutes

# Heartbeat interval: 1/3 of session timeout
heartbeat.interval.ms=20000

# Limit batch size for timely processing
max.poll.records=50
```

**Good Example (Java) - Adaptive Configuration:**
```java
public class AdaptiveConsumer {
    public KafkaConsumer<String, String> createConsumer() {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "my-group");

        // For fast, simple processing
        if (isSimpleProcessing) {
            props.put("session.timeout.ms", "30000");
            props.put("max.poll.interval.ms", "300000");
            props.put("heartbeat.interval.ms", "10000");
            props.put("max.poll.records", "500");
        }
        // For slow, complex processing
        else {
            props.put("session.timeout.ms", "60000");
            props.put("max.poll.interval.ms", "600000");  // 10 minutes
            props.put("heartbeat.interval.ms", "20000");
            props.put("max.poll.records", "10");  // Smaller batches
        }

        return new KafkaConsumer<>(props);
    }
}
```

---

### 8. Unnecessary Rebalances (No Static Membership)

**Description:** When consumers restart (e.g., during deployment), the default behavior triggers a full rebalance. Static membership (`group.instance.id`) prevents rebalancing during consumer restarts.

**Impact:**
- Processing pauses for all consumers in the group
- Lost in-memory state/caches
- Increased latency during deployments

**Detection Hints:**
```bash
# Check for missing group.instance.id
grep -L "group\.instance\.id" *.properties

# Check for CooperativeStickyAssignor
grep "partition\.assignment\.strategy" | grep -v "CooperativeStickyAssignor"
```

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: No static membership
group.id=my-consumer-group
# No group.instance.id configured
partition.assignment.strategy=RangeAssignor  # Poor rebalancing
```

**Good Example (Configuration):**
```properties
# Static membership prevents rebalance on restart
group.id=my-consumer-group
group.instance.id=consumer-1  # Unique per instance
session.timeout.ms=60000  # Allow time for restarts

# CooperativeStickyAssignor minimizes partition movement
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor
```

**Good Example (Java) - Dynamic Instance ID:**
```java
public class StaticMembershipConsumer {
    public KafkaConsumer<String, String> createConsumer(String instanceId) {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "my-group");

        // Static membership for stable restarts
        props.put("group.instance.id", instanceId);
        props.put("session.timeout.ms", "60000");

        // Cooperative rebalancing
        props.put("partition.assignment.strategy",
            "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");

        return new KafkaConsumer<>(props);
    }
}
```

---

### 9. Slow Member Bottleneck

**Description:** In classic rebalancing, all consumers wait for the slowest member to complete their rebalance operations (e.g., closing connections, saving state). This creates a bottleneck.

**Impact:**
- Extended downtime during rebalances
- Processing delays for all consumers
- Amplified impact of slow or unhealthy consumers

**Detection Hints:**
```bash
# Look for rebalance timing in logs
grep "rebalance.*completed\|join.*took" logs/

# Check for eager rebalancing strategy
grep "partition\.assignment\.strategy" | grep -E "Range|RoundRobin" | grep -v Cooperative
```

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: Eager rebalancing (default in older clients)
partition.assignment.strategy=org.apache.kafka.clients.consumer.RangeAssignor

# No incremental rebalancing - all consumers wait for slowest
```

**Good Example (Configuration):**
```properties
# Incremental rebalancing reduces downtime
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor

# Allows consumers to continue processing non-revoked partitions
```

**Good Example (Java) - Migrate to Cooperative Rebalancing:**
```java
public class CooperativeRebalanceConsumer {
    public void setupConsumer() {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "my-group");

        // Cooperative sticky assignor for incremental rebalancing
        props.put("partition.assignment.strategy",
            "org.apache.kafka.clients.consumer.CooperativeStickyAssignor");

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        consumer.subscribe(
            Arrays.asList("my-topic"),
            new ConsumerRebalanceListener() {
                @Override
                public void onPartitionsRevoked(
                    Collection<TopicPartition> partitions
                ) {
                    // Only revoked partitions, not all partitions
                    log.info("Incrementally revoking: {}", partitions);
                    consumer.commitSync();
                }

                @Override
                public void onPartitionsAssigned(
                    Collection<TopicPartition> partitions
                ) {
                    // Continue processing other partitions during this
                    log.info("Incrementally assigned: {}", partitions);
                }
            }
        );
    }
}
```

---

## Configuration Anti-Patterns

### 10. Auto-Commit with Long Processing

**Description:** Using `enable.auto.commit=true` (default) with processing that takes longer than `auto.commit.interval.ms` creates a window where offsets are committed before processing completes.

**Impact:**
- Data loss on consumer crash
- Messages marked consumed but not processed
- Difficult to debug issues

**Detection Hints:**
```bash
# Check for auto-commit with no override
grep -E "enable\.auto\.commit|auto\.commit\.interval\.ms" *.properties

# Look for long-running processing without manual commits
grep "enable.auto.commit.*true" | xargs grep -l "http\|database\|sleep"
```

**Bad Example (Java):**
```java
public class AutoCommitConsumer {
    public void setupConsumer() {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "my-group");
        props.put("enable.auto.commit", "true");  // Default
        props.put("auto.commit.interval.ms", "5000");  // Every 5 seconds

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                // ANTI-PATTERN: Processing takes 10 seconds
                // Auto-commit happens at 5 seconds
                // If crash happens between 5-10s, message is LOST
                slowProcessing(record);  // 10 seconds
            }
        }
    }
}
```

**Good Example (Java):**
```java
public class ManualCommitConsumer {
    public void setupConsumer() {
        Properties props = new Properties();
        props.put("bootstrap.servers", "localhost:9092");
        props.put("group.id", "my-group");
        props.put("enable.auto.commit", "false");  // Manual control

        KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                slowProcessing(record);  // 10 seconds - safe!
            }

            // Commit only after ALL processing completes
            consumer.commitSync();
        }
    }
}
```

---

### 11. Excessive Fetch Sizes (Memory Issues)

**Description:** Setting `fetch.max.bytes` or `max.partition.fetch.bytes` too high causes excessive memory consumption. Setting them too low increases network overhead.

**Impact:**
- OutOfMemoryError
- Slow processing due to memory pressure
- Garbage collection issues
- Network chattiness with small fetch sizes

**Detection Hints:**
```bash
# Check for extreme fetch configurations
grep -E "fetch\.max\.bytes|max\.partition\.fetch\.bytes" *.properties

# Look for memory-related errors in logs
grep "OutOfMemoryError\|GC overhead" logs/
```

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: Fetch sizes too large
fetch.max.bytes=104857600  # 100MB - can exhaust memory
max.partition.fetch.bytes=52428800  # 50MB per partition
max.poll.records=10000  # Too many records

# With 10 partitions assigned, could fetch 500MB in one poll!
```

**Good Example (Configuration):**
```properties
# Balanced fetch sizes
fetch.max.bytes=52428800  # 50MB total
max.partition.fetch.bytes=1048576  # 1MB per partition
max.poll.records=500  # Reasonable batch

# Prevents memory exhaustion while maintaining throughput
```

---

### 12. Improper Isolation Level

**Description:** Using default `isolation.level=read_uncommitted` with transactional producers risks consuming messages from aborted transactions.

**Impact:**
- Processing aborted/invalid data
- Inconsistent state
- Data quality issues

**Detection Hints:**
```bash
# Check isolation level with transactional producers
grep "transactional.id" producer_config | \
  xargs grep -L "isolation\.level=read_committed" consumer_config
```

**Bad Example (Configuration):**
```properties
# Producer uses transactions
# Producer config:
transactional.id=my-producer
enable.idempotence=true

# Consumer doesn't respect transaction boundaries
# Consumer config:
isolation.level=read_uncommitted  # ANTI-PATTERN: Default value
# May read aborted transaction data!
```

**Good Example (Configuration):**
```properties
# Producer uses transactions
# Producer config:
transactional.id=my-producer
enable.idempotence=true

# Consumer respects transaction boundaries
# Consumer config:
isolation.level=read_committed
# Only reads committed transaction data
```

---

## Partition Assignment Anti-Patterns

### 13. Consumer Starvation (Unfair Partition Assignment)

**Description:** With large `max.partition.fetch.bytes`, Kafka fetches from the same partition until the limit is reached before moving to the next partition. This starves other partitions of processing.

**Impact:**
- Uneven lag across partitions
- Delayed processing for some partitions
- Poor load distribution

**Detection Hints:**
```bash
# Check consumer lag per partition
kafka-consumer-groups --describe --group my-group | awk '{print $2,$4}' | sort -k2 -n

# Look for large max.partition.fetch.bytes
grep "max\.partition\.fetch\.bytes" | awk -F= '$2 > 10485760'  # > 10MB
```

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: Large per-partition fetch
max.partition.fetch.bytes=10485760  # 10MB

# With 50 partitions assigned, consumer fetches 10MB from Partition-1
# before moving to Partition-2, causing starvation
```

**Scenario:**
```
Topic: 50 partitions
Consumer: Assigned 5 partitions (1, 2, 3, 4, 5)
Configuration: max.partition.fetch.bytes=10MB

Poll 1-10: Fetch from Partition-1 (1000 msgs × 1MB each = 10MB total)
Poll 11-20: Fetch from Partition-2 (10MB)
Poll 21-30: Fetch from Partition-3 (10MB)
...
Result: Partitions 2-5 starved for ~40-50 polls!
```

**Good Example (Configuration):**
```properties
# Smaller per-partition fetch prevents starvation
max.partition.fetch.bytes=1048576  # 1MB

# Consumer fetches smaller chunks from each partition
# More even distribution across partitions
```

**Good Example (Python) - Monitor and Alert:**
```python
from kafka import KafkaConsumer, TopicPartition
import time

consumer = KafkaConsumer(
    'my-topic',
    max_partition_fetch_bytes=1048576,  # 1MB to prevent starvation
    max_poll_records=100
)

def monitor_partition_lag():
    """Monitor lag across partitions to detect starvation"""
    partitions = consumer.assignment()
    lag_by_partition = {}

    for partition in partitions:
        end_offsets = consumer.end_offsets([partition])
        current_position = consumer.position(partition)
        lag = end_offsets[partition] - current_position
        lag_by_partition[partition] = lag

    # Alert if lag variance is high (indicates starvation)
    max_lag = max(lag_by_partition.values())
    min_lag = min(lag_by_partition.values())

    if max_lag - min_lag > 10000:
        print(f"WARNING: Partition starvation detected!")
        print(f"Lag by partition: {lag_by_partition}")

# Poll and monitor
while True:
    records = consumer.poll(timeout_ms=1000)
    for record in records.values():
        for msg in record:
            process(msg)

    # Periodically check for starvation
    if time.time() % 60 < 1:  # Every minute
        monitor_partition_lag()
```

---

### 14. Range Assignor Imbalance

**Description:** Using `RangeAssignor` (default in older clients) can lead to uneven partition distribution where some consumers get more partitions than others.

**Impact:**
- Uneven load distribution
- Some consumers overworked, others idle
- Suboptimal resource utilization

**Detection Hints:**
```bash
# Check assignment strategy
grep "partition\.assignment\.strategy" | grep "Range"

# Check partition distribution
kafka-consumer-groups --describe --group my-group | \
  awk '{print $1,$6}' | sort | uniq -c
```

**Scenario (Range Assignor Problem):**
```
Topics: topic-A (5 partitions), topic-B (5 partitions)
Consumers: 3 (C1, C2, C3)
Strategy: RangeAssignor

Assignment:
C1: topic-A [0,1], topic-B [0,1] = 4 partitions
C2: topic-A [2,3], topic-B [2,3] = 4 partitions
C3: topic-A [4], topic-B [4] = 2 partitions

C3 is underutilized! Imbalanced load.
```

**Bad Example (Configuration):**
```properties
# ANTI-PATTERN: Range assignor causes imbalance
partition.assignment.strategy=org.apache.kafka.clients.consumer.RangeAssignor
```

**Good Example (Configuration):**
```properties
# Better strategies for balanced assignment
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor

# Or RoundRobin for even distribution (but no partition stickiness)
# partition.assignment.strategy=org.apache.kafka.clients.consumer.RoundRobinAssignor
```

**Good Example (Kotlin) - Custom Assignor:**
```kotlin
class FairAssignor : AbstractPartitionAssignor() {
    override fun assign(
        partitionsPerTopic: Map<String, Int>,
        subscriptions: Map<String, Subscription>
    ): Map<String, Assignment> {

        val assignments = mutableMapOf<String, Assignment>()
        val allPartitions = mutableListOf<TopicPartition>()

        // Collect all partitions
        partitionsPerTopic.forEach { (topic, partitionCount) ->
            (0 until partitionCount).forEach { partition ->
                allPartitions.add(TopicPartition(topic, partition))
            }
        }

        // Round-robin assignment for fairness
        val consumers = subscriptions.keys.sorted()
        allPartitions.forEachIndexed { index, partition ->
            val consumerIndex = index % consumers.size
            val consumer = consumers[consumerIndex]

            val current = assignments[consumer]?.partitions()?.toMutableList()
                ?: mutableListOf()
            current.add(partition)
            assignments[consumer] = Assignment(current)
        }

        return assignments
    }

    override fun name() = "fair"
}
```

---

### 15. More Consumers Than Partitions

**Description:** Creating more consumer instances than topic partitions leaves excess consumers idle, wasting resources.

**Impact:**
- Wasted compute resources
- Unnecessary cost
- False sense of scalability

**Detection Hints:**
```bash
# Check consumer group details
kafka-consumer-groups --describe --group my-group | grep "CONSUMER-ID" | wc -l

# Check topic partition count
kafka-topics --describe --topic my-topic | grep "PartitionCount"

# Alert if consumers > partitions
```

**Bad Example (Deployment):**
```yaml
# ANTI-PATTERN: More consumers than partitions
# Topic has 10 partitions
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-consumer
spec:
  replicas: 20  # 10 will be idle!
  template:
    spec:
      containers:
      - name: consumer
        image: my-consumer:latest
```

**Good Example (Deployment):**
```yaml
# Match consumers to partitions (or slightly fewer)
# Topic has 30 partitions
apiVersion: apps/v1
kind: Deployment
metadata:
  name: kafka-consumer
spec:
  replicas: 30  # 1:1 ratio for maximum parallelism
  template:
    spec:
      containers:
      - name: consumer
        image: my-consumer:latest
        env:
        - name: GROUP_ID
          value: "my-consumer-group"
```

**Good Example (Python) - Dynamic Scaling:**
```python
from kafka import KafkaConsumer, KafkaAdminClient
import os

def get_optimal_consumer_count(topic, max_consumers=100):
    """
    Determine optimal consumer count based on partition count
    """
    admin_client = KafkaAdminClient(
        bootstrap_servers=['localhost:9092']
    )

    topic_metadata = admin_client.describe_topics([topic])
    partition_count = len(topic_metadata[0]['partitions'])

    # Don't create more consumers than partitions
    return min(partition_count, max_consumers)

# Use in autoscaling logic
optimal_count = get_optimal_consumer_count('my-topic')
print(f"Recommended consumers: {optimal_count}")
```

---

## Async Processing Anti-Patterns

### 16. Async Processing with Sync Commits (Race Condition)

**Description:** Processing messages asynchronously (e.g., in thread pools) while committing synchronously in the main poll loop creates a race condition where offsets are committed before async processing completes.

**Impact:**
- Data loss on consumer crash
- Messages marked consumed before processing
- Difficult to debug race conditions

**Detection Hints:**
```bash
# Look for executor + commitSync in poll loop
grep -A 20 "executor\|async" *.java | grep "commitSync"

# Check for Future/CompletableFuture without waiting
grep "submit\|async" | grep -v "get()\|join()\|await"
```

**Bad Example (Java):**
```java
public class AsyncProcessingSyncCommit {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            for (ConsumerRecord<String, String> record : records) {
                // ANTI-PATTERN: Submit to async processing
                executor.submit(() -> {
                    processMessage(record);  // Takes 10 seconds
                    writeToDatabase(record);
                });
            }

            // RACE CONDITION: Committing before async processing completes!
            consumer.commitSync();
            // If consumer crashes, async tasks lose their messages
        }
    }
}
```

**Bad Example (Python):**
```python
from kafka import KafkaConsumer
from concurrent.futures import ThreadPoolExecutor

consumer = KafkaConsumer(
    'my-topic',
    enable_auto_commit=False
)

executor = ThreadPoolExecutor(max_workers=10)

for message in consumer:
    # ANTI-PATTERN: Submit async, commit immediately
    future = executor.submit(process_message, message)

    # Don't wait for completion!
    consumer.commit()  # RACE CONDITION!
```

**Good Example (Java) - Wait for Async Completion:**
```java
public class SafeAsyncProcessing {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);

    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            List<Future<?>> futures = new ArrayList<>();

            for (ConsumerRecord<String, String> record : records) {
                Future<?> future = executor.submit(() -> {
                    processMessage(record);
                    writeToDatabase(record);
                });
                futures.add(future);
            }

            // Wait for ALL async processing to complete
            for (Future<?> future : futures) {
                try {
                    future.get();  // Block until done
                } catch (Exception e) {
                    log.error("Processing failed", e);
                    throw new RuntimeException(e);  // Don't commit on failure
                }
            }

            // Commit only after all async processing succeeds
            consumer.commitSync();
        }
    }
}
```

**Good Example (Python) - Wait for Futures:**
```python
from kafka import KafkaConsumer
from concurrent.futures import ThreadPoolExecutor, as_completed

consumer = KafkaConsumer(
    'my-topic',
    enable_auto_commit=False,
    max_poll_records=100
)

executor = ThreadPoolExecutor(max_workers=10)

while True:
    messages = consumer.poll(timeout_ms=1000)

    if not messages:
        continue

    futures = []
    for topic_partition, records in messages.items():
        for record in records:
            future = executor.submit(process_message, record)
            futures.append(future)

    # Wait for ALL processing to complete
    for future in as_completed(futures):
        try:
            future.result()  # Raises exception if processing failed
        except Exception as e:
            print(f"Processing failed: {e}")
            raise  # Don't commit on failure

    # Commit only after all processing succeeds
    consumer.commit()
```

**Good Example (Kotlin) - Coroutines with Semaphore:**
```kotlin
class SafeAsyncConsumer(
    private val consumer: KafkaConsumer<String, String>,
    private val maxConcurrency: Int = 10
) {
    private val semaphore = Semaphore(maxConcurrency)

    suspend fun consume() = coroutineScope {
        while (isActive) {
            val records = consumer.poll(Duration.ofMillis(100))

            // Process all records concurrently, wait for completion
            val jobs = records.map { record ->
                async {
                    semaphore.withPermit {
                        processMessage(record)
                    }
                }
            }

            // Wait for all async processing to complete
            jobs.awaitAll()

            // Commit only after all processing succeeds
            consumer.commitSync()
        }
    }
}
```

---

### 17. Pause Without Resume (Stuck Consumer)

**Description:** Pausing partitions during async processing but failing to resume them (e.g., due to exception) causes the consumer to stop consuming permanently.

**Impact:**
- Consumer appears stuck
- Growing consumer lag
- No error messages (silent failure)

**Detection Hints:**
```bash
# Look for pause without resume
grep "pause(" *.java | xargs grep -L "resume("

# Check for missing finally blocks around resume
grep -A 10 "pause(" | grep -B 5 "resume" | grep -v "finally"
```

**Bad Example (Java):**
```java
public class PauseWithoutResume {
    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            if (!records.isEmpty()) {
                // Pause consumption
                consumer.pause(consumer.assignment());

                try {
                    processAsync(records);
                } catch (Exception e) {
                    // ANTI-PATTERN: Exception prevents resume!
                    log.error("Processing failed", e);
                    throw e;
                    // Consumer remains paused forever!
                }

                consumer.resume(consumer.assignment());
            }
        }
    }
}
```

**Good Example (Java):**
```java
public class SafePauseResume {
    public void consume() {
        while (running) {
            ConsumerRecords<String, String> records =
                consumer.poll(Duration.ofMillis(100));

            if (!records.isEmpty()) {
                consumer.pause(consumer.assignment());

                try {
                    processAsync(records);
                } catch (Exception e) {
                    log.error("Processing failed", e);
                    throw e;
                } finally {
                    // ALWAYS resume in finally block
                    consumer.resume(consumer.assignment());
                }
            }
        }
    }
}
```

**Good Example (Kotlin):**
```kotlin
class SafePauseResumeConsumer(
    private val consumer: KafkaConsumer<String, String>
) {
    suspend fun consume() {
        while (isActive) {
            val records = consumer.poll(Duration.ofMillis(100))

            if (records.isEmpty) continue

            consumer.pause(consumer.assignment())

            try {
                processAsync(records)
            } finally {
                // Guaranteed resume even on exception
                consumer.resume(consumer.assignment())
            }
        }
    }
}
```

---

## Detection Summary

### Quick Grep Patterns

```bash
# 1. Blocking poll loop
grep -A 20 "consumer\.poll" | grep -E "sleep|http|database" | grep -v "async|executor"

# 2. Commit before processing
grep -B 5 "commitSync\|commitAsync" | grep "poll" | grep -A 5 "process"

# 3. Auto-commit with slow processing
grep "enable.auto.commit.*true" *.properties && grep -E "sleep|http|database" *.java

# 4. Missing rebalance listener
grep -L "ConsumerRebalanceListener" consumer_*.java

# 5. Session timeout misconfiguration
grep -E "session\.timeout\.ms|heartbeat\.interval\.ms" *.properties

# 6. Missing static membership
grep -L "group\.instance\.id" *.properties

# 7. Async processing without waiting
grep "executor\.submit\|CompletableFuture" | grep -v "get()\|join()"

# 8. Pause without resume
grep "pause(" *.java | xargs grep -L "finally.*resume"

# 9. Range assignor
grep "partition\.assignment\.strategy.*Range" *.properties

# 10. Large fetch sizes
awk -F= '/max\.partition\.fetch\.bytes/ {if ($2 > 10485760) print FILENAME":"$0}' *.properties
```

### Configuration Checks

```bash
# Check for dangerous configuration combinations
function check_kafka_config() {
    local config_file=$1

    # Auto-commit enabled
    if grep -q "enable.auto.commit.*true" "$config_file"; then
        echo "WARNING: Auto-commit enabled in $config_file"
    fi

    # Session timeout too low
    local session_timeout=$(grep "session.timeout.ms" "$config_file" | awk -F= '{print $2}')
    if [ "$session_timeout" -lt 30000 ]; then
        echo "WARNING: session.timeout.ms too low: $session_timeout"
    fi

    # Heartbeat interval too high
    local heartbeat=$(grep "heartbeat.interval.ms" "$config_file" | awk -F= '{print $2}')
    if [ "$heartbeat" -gt $((session_timeout / 3)) ]; then
        echo "WARNING: heartbeat.interval.ms too high relative to session.timeout.ms"
    fi

    # No static membership
    if ! grep -q "group.instance.id" "$config_file"; then
        echo "INFO: Consider enabling static membership with group.instance.id"
    fi
}
```

---

## Testing Anti-Patterns

### Testing for Data Loss

```java
@Test
public void testCommitBeforeProcessing_causesDataLoss() {
    // Simulate commit before processing
    EmbeddedKafka kafka = new EmbeddedKafka();
    kafka.send("test-topic", "message1");

    AtomicBoolean processed = new AtomicBoolean(false);

    KafkaConsumer<String, String> consumer = createConsumer();
    consumer.subscribe(Arrays.asList("test-topic"));

    ConsumerRecords<String, String> records =
        consumer.poll(Duration.ofMillis(1000));

    // ANTI-PATTERN: Commit before processing
    consumer.commitSync();

    // Simulate crash before processing
    consumer.close();

    // Create new consumer
    KafkaConsumer<String, String> consumer2 = createConsumer();
    consumer2.subscribe(Arrays.asList("test-topic"));

    ConsumerRecords<String, String> records2 =
        consumer2.poll(Duration.ofMillis(1000));

    // Message is LOST - not reprocessed
    assertEquals(0, records2.count());
}

@Test
public void testCommitAfterProcessing_preventsDataLoss() {
    // Proper pattern: commit after processing
    EmbeddedKafka kafka = new EmbeddedKafka();
    kafka.send("test-topic", "message1");

    KafkaConsumer<String, String> consumer = createConsumer();
    consumer.subscribe(Arrays.asList("test-topic"));

    ConsumerRecords<String, String> records =
        consumer.poll(Duration.ofMillis(1000));

    // Process first (simulate crash before commit)
    for (ConsumerRecord<String, String> record : records) {
        process(record);
    }

    // Simulate crash before commit
    consumer.close();

    // Create new consumer
    KafkaConsumer<String, String> consumer2 = createConsumer();
    consumer2.subscribe(Arrays.asList("test-topic"));

    ConsumerRecords<String, String> records2 =
        consumer2.poll(Duration.ofMillis(1000));

    // Message is REPROCESSED - no data loss
    assertEquals(1, records2.count());
}
```

---

## Recommended Configuration Template

### Production-Ready Consumer Configuration

```properties
# Bootstrap and Group
bootstrap.servers=localhost:9092
group.id=my-consumer-group

# Static membership for stable restarts
group.instance.id=${HOSTNAME}

# Reliability
enable.auto.commit=false
isolation.level=read_committed

# Timeouts (for processing-intensive workloads)
session.timeout.ms=60000
max.poll.interval.ms=300000
heartbeat.interval.ms=20000

# Fetch configuration
fetch.min.bytes=1024
fetch.max.wait.ms=500
max.poll.records=100
max.partition.fetch.bytes=1048576

# Assignment strategy
partition.assignment.strategy=org.apache.kafka.clients.consumer.CooperativeStickyAssignor

# Serialization
key.deserializer=org.apache.kafka.common.serialization.StringDeserializer
value.deserializer=org.apache.kafka.common.serialization.StringDeserializer

# Security (if applicable)
security.protocol=SASL_SSL
sasl.mechanism=PLAIN
```

### Monitoring Metrics

```bash
# Key metrics to monitor for anti-patterns

# 1. Rebalance frequency (should be rare)
kafka.consumer:type=consumer-coordinator-metrics,client-id=*,attribute=rebalance-rate-per-hour

# 2. Commit failure rate (should be near zero)
kafka.consumer:type=consumer-coordinator-metrics,client-id=*,attribute=commit-rate

# 3. Time between polls (should be < max.poll.interval.ms)
kafka.consumer:type=consumer-metrics,client-id=*,attribute=time-between-poll-avg

# 4. Consumer lag (should be stable or decreasing)
kafka.consumer:type=consumer-fetch-manager-metrics,client-id=*,partition=*,attribute=records-lag

# 5. Partition assignment (should be balanced)
kafka.consumer:type=consumer-coordinator-metrics,client-id=*,attribute=assigned-partitions
```

---

## References and Sources

This knowledge base was compiled from the following authoritative sources:

- [Kafka Consumer for Confluent Platform | Confluent Documentation](https://docs.confluent.io/platform/current/clients/consumer.html)
- [How to avoid rebalances and disconnections in Kafka consumers | Red Hat Developer](https://developers.redhat.com/articles/2023/12/01/how-avoid-rebalances-and-disconnections-kafka-consumers)
- [Optimizing Kafka consumers | Strimzi Blog](https://strimzi.io/blog/2021/01/07/consumer-tuning/)
- [Kafka Consumer Configuration Reference | Confluent Documentation](https://docs.confluent.io/platform/current/installation/configuration/consumer-configs.html)
- [Apache Kafka Patterns and Anti-Patterns | DZone](https://dzone.com/refcardz/apache-kafka-patterns-and-anti-patterns)
- [Kafka Anti-Patterns: Common Pitfalls | Medium](https://medium.com/@shailendrasinghpatil/kafka-anti-patterns-common-pitfalls-and-how-to-avoid-them-833cdcf2df89)
- [Solving Kafka Rebalancing Issues | Medium](https://medium.com/bakdata/solving-my-weird-kafka-rebalancing-problems-c05e99535435)
- [Optimizing Kafka Partition Consumption | Medium](https://medium.com/@karthik.chavanlearn/optimizing-kafka-partition-consumption-avoiding-imbalances-and-starvation-588e9945c384)
- [Understanding Kafka partition assignment strategies | Medium](https://medium.com/streamthoughts/understanding-kafka-partition-assignment-strategies-and-how-to-write-your-own-custom-assignor-ebeda1fc06f3)

---

## Version History

- **v1.0** (2025-12-11): Initial compilation of Kafka consumer anti-patterns from web sources
- Covers: Poll loop, commit timing, rebalance, configuration, partition assignment, async processing
- Languages: Java, Python, Kotlin
- Detection: Grep patterns, configuration checks, monitoring metrics
