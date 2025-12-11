# Kafka Ordering, Deduplication, and Scalability Anti-Patterns

This document catalogs common anti-patterns in Apache Kafka related to message ordering, deduplication, and scalability issues that can severely impact system performance and correctness.

## Table of Contents

1. [Ordering Anti-Patterns](#ordering-anti-patterns)
2. [Deduplication Anti-Patterns](#deduplication-anti-patterns)
3. [Partitioning Anti-Patterns](#partitioning-anti-patterns)
4. [Throughput Anti-Patterns](#throughput-anti-patterns)
5. [Broker Saturation Anti-Patterns](#broker-saturation-anti-patterns)
6. [Exactly-Once Semantics Anti-Patterns](#exactly-once-semantics-anti-patterns)

---

## Ordering Anti-Patterns

### 1. Producing Messages Without Partition Keys

**Pattern Name:** Keyless Message Production

**Description:** When messages are produced without a message key, Kafka distributes them using round-robin across partitions, breaking any implicit ordering requirements between related events.

**Bug Impact:**
- Related messages can be written to different partitions (e.g., partition 0 and 2)
- Consumer polling for batches from partitions will receive related messages in unknown order
- Events may be processed out of sequence, causing nonsensical state (e.g., address change for a customer that doesn't exist yet)

**Bad Example:**
```java
// BAD: No key specified - messages distributed randomly
ProducerRecord<String, String> record = new ProducerRecord<>(
    "user-events",
    "UserCreated: userId=123"
);
producer.send(record);

ProducerRecord<String, String> record2 = new ProducerRecord<>(
    "user-events",
    "AddressChanged: userId=123"
);
producer.send(record2);
// AddressChanged may arrive before UserCreated!
```

**Good Example:**
```java
// GOOD: Use userId as partition key to maintain ordering
String userId = "123";

ProducerRecord<String, String> record = new ProducerRecord<>(
    "user-events",
    userId, // partition key
    "UserCreated: userId=123"
);
producer.send(record);

ProducerRecord<String, String> record2 = new ProducerRecord<>(
    "user-events",
    userId, // same key = same partition = ordered
    "AddressChanged: userId=123"
);
producer.send(record2);
```

**Detection Hints:**
- Look for `new ProducerRecord<>(topic, value)` with only 2 parameters
- Search for round-robin or random partitioning strategies
- Check for event-driven systems where ordering matters but keys are missing
- Monitor for "impossible state" errors in consumers

---

### 2. Splitting Related Events Across Topics

**Pattern Name:** Topic-Per-Event-Type Anti-Pattern

**Description:** Different topics mean different partitions, and ordering is not preserved across partitions. If you use different topics for different event types, consumers may see events in nonsensical order.

**Bug Impact:**
- Cross-topic ordering cannot be guaranteed
- Consumer may process events before their prerequisites arrive
- Violates Martin Kleppmann's rule: "Any events that need to stay in a fixed order must go in the same topic"

**Bad Example:**
```java
// BAD: Split events into separate topics
ProducerRecord<String, String> customerCreated = new ProducerRecord<>(
    "customer-created", // Topic 1
    customerId,
    createEventJson
);

ProducerRecord<String, String> addressChanged = new ProducerRecord<>(
    "address-changed", // Topic 2 - different topic!
    customerId,
    addressEventJson
);
```

**Good Example:**
```java
// GOOD: All related events in same topic with partition key
String customerId = "customer-123";

ProducerRecord<String, CustomerEvent> customerCreated = new ProducerRecord<>(
    "customer-events", // Single topic
    customerId,
    new CustomerCreated(...)
);

ProducerRecord<String, CustomerEvent> addressChanged = new ProducerRecord<>(
    "customer-events", // Same topic
    customerId,
    new AddressChanged(...)
);
```

**Detection Hints:**
- Multiple topics with related event types (e.g., `user-created`, `user-updated`)
- Topic names ending with event types
- Consumers subscribing to multiple topics expecting ordered processing
- Event correlation logic trying to "wait" for prerequisite events

---

### 3. Changing Partition Count After Deployment

**Pattern Name:** Runtime Partition Expansion

**Description:** The key-to-partition mapping is consistent only as long as the number of partitions remains the same. Adding new partitions breaks ordering guarantees for existing keys.

**Bug Impact:**
- Messages with the same key might get written to different partitions before and after the change
- Historical order is lost
- Consumers see discontinuous sequences

**Bad Example:**
```bash
# BAD: Changing partitions on existing topic with keyed messages
kafka-topics --alter --topic user-events \
  --partitions 20 \
  --bootstrap-server localhost:9092
# Now keys that went to partition 5 might go to partition 15!
```

**Good Example:**
```bash
# GOOD: Plan partition count upfront based on expected load
kafka-topics --create --topic user-events \
  --partitions 20 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# If you must increase partitions, understand ordering will break
# and plan migration strategy (e.g., new topic with parallel processing)
```

**Detection Hints:**
- `ALTER TOPIC` commands with `--partitions` flag
- Partition count changes in topic configuration
- Consumer errors about unexpected ordering after infrastructure changes
- Monitoring tools showing partition count modifications

---

### 4. Retry Mechanism Without Idempotence

**Pattern Name:** Concurrent Retry Ordering Violation

**Description:** When network failures trigger retries, multiple active requests for the same partition can complete out of order, violating message ordering.

**Bug Impact:**
- Two records sent sequentially may be stored in reverse order
- Retry of message 1 arrives after successful delivery of message 2
- Breaks causal ordering

**Bad Example:**
```java
// BAD: Default configuration allows reordering on retry
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
// Missing: enable.idempotence
// Missing: max.in.flight.requests.per.connection = 1 (if idempotence not used)

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

**Good Example:**
```java
// GOOD: Enable idempotence to prevent reordering
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("key.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("value.serializer", "org.apache.kafka.common.serialization.StringSerializer");
props.put("enable.idempotence", "true"); // Guarantees ordering with retries
props.put("acks", "all"); // Required for idempotence
props.put("max.in.flight.requests.per.connection", "5"); // Safe with idempotence

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

**Detection Hints:**
- Producer configs missing `enable.idempotence=true`
- `max.in.flight.requests.per.connection > 1` without idempotence
- Network error logs coinciding with ordering violations
- Duplicate sequence numbers in broker logs

---

## Deduplication Anti-Patterns

### 5. Missing Idempotent Producer Configuration

**Pattern Name:** At-Least-Once Without Deduplication

**Description:** Producers retry on failure but without idempotence enabled, creating duplicate messages when acknowledgments are lost.

**Bug Impact:**
- Duplicate messages written to Kafka on retry
- Same (PID, sequence number) not tracked
- Consumer must handle duplicates manually

**Bad Example:**
```java
// BAD: Retries without idempotence = duplicates
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("retries", 3); // Will retry but can create duplicates
props.put("enable.idempotence", "false"); // Default in older versions
```

**Good Example:**
```java
// GOOD: Idempotence prevents duplicates from producer retries
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("enable.idempotence", "true"); // Broker deduplicates via (PID, seqNum)
props.put("acks", "all");
props.put("retries", Integer.MAX_VALUE);
```

**Detection Hints:**
- `enable.idempotence` not set or set to `false`
- Producer configs with `retries > 0` but no idempotence
- Duplicate message complaints in consumer logs
- Same business key appearing multiple times in output

---

### 6. Reinventing Deduplication Logic

**Pattern Name:** Custom Deduplication Instead of Native Features

**Description:** Building custom deduplication instead of using Kafka's native exactly-once semantics is error-prone and complex.

**Bug Impact:**
- Reinventing proven patterns introduces bugs
- State management complexity
- Race conditions in custom implementations
- Performance overhead

**Bad Example:**
```java
// BAD: Custom deduplication logic
Set<String> processedMessageIds = new ConcurrentHashSet<>();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        String messageId = extractMessageId(record.value());

        // Custom deduplication - error prone!
        if (processedMessageIds.contains(messageId)) {
            continue; // Skip duplicate
        }

        processMessage(record);
        processedMessageIds.add(messageId);

        // What if crash happens here? State lost!
    }
}
```

**Good Example:**
```java
// GOOD: Use Kafka's native transactional/exactly-once support
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("enable.idempotence", "true");
props.put("transactional.id", "my-transactional-id");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions();

try {
    producer.beginTransaction();
    // Produce messages
    producer.send(record1);
    producer.send(record2);
    // Commit offsets and messages atomically
    producer.sendOffsetsToTransaction(offsets, consumerGroupId);
    producer.commitTransaction();
} catch (Exception e) {
    producer.abortTransaction();
}
```

**Detection Hints:**
- Custom Set/Map structures for tracking message IDs
- Manual offset management without transactions
- Database lookups to check for duplicate processing
- Code comments mentioning "deduplication" or "idempotency"

---

### 7. Auto-Commit Before Processing

**Pattern Name:** Premature Offset Commit

**Description:** Auto-committing offsets before processing completes leads to data loss or duplicate processing.

**Bug Impact:**
- Offset committed but processing fails = data loss
- Consumer crashes after commit = messages never processed
- No rollback mechanism

**Bad Example:**
```java
// BAD: Auto-commit can commit before processing completes
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "true"); // Dangerous!
props.put("auto.commit.interval.ms", "1000");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("my-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        // Processing might fail, but offset already committed!
        riskyDatabaseWrite(record);
    }
}
```

**Good Example:**
```java
// GOOD: Manual commit after successful processing
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false"); // Manual control

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("my-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        try {
            processMessage(record);
            // Only commit after successful processing
            consumer.commitSync();
        } catch (Exception e) {
            // Don't commit - will reprocess on restart
            log.error("Processing failed, will retry", e);
        }
    }
}
```

**Detection Hints:**
- `enable.auto.commit=true` in consumer configs
- Short `auto.commit.interval.ms` values
- Data loss reports after consumer restarts
- Duplicate processing after failures

---

## Partitioning Anti-Patterns

### 8. Hot Partitions from Skewed Key Distribution

**Pattern Name:** Uneven Key Cardinality

**Description:** Using partition keys with low cardinality or skewed distribution creates hot partitions where one partition receives disproportionate traffic.

**Bug Impact:**
- One broker becomes overloaded (CPU, memory, disk)
- Other brokers sit idle
- Cluster lag and performance degradation
- Single consumer in group becomes bottleneck

**Bad Example:**
```java
// BAD: Low cardinality key - only a few countries
ProducerRecord<String, Order> record = new ProducerRecord<>(
    "orders",
    order.getCountry(), // e.g., only "US", "UK", "FR" - creates 3 hot partitions
    order
);

// BAD: Skewed distribution - 90% of users in one region
ProducerRecord<String, Event> record = new ProducerRecord<>(
    "user-events",
    user.getRegion(), // "US-EAST" gets 90% of traffic
    event
);
```

**Good Example:**
```java
// GOOD: High cardinality composite key
ProducerRecord<String, Order> record = new ProducerRecord<>(
    "orders",
    order.getCountry() + "|" + order.getCustomerId(), // Much higher cardinality
    order
);

// GOOD: Add salt to hot keys
String partitionKey;
if (isHotKey(user.getRegion())) {
    // Spread hot key across multiple sub-keys
    int salt = Math.abs(user.getUserId().hashCode() % 10);
    partitionKey = user.getRegion() + "|" + salt;
} else {
    partitionKey = user.getRegion();
}

ProducerRecord<String, Event> record = new ProducerRecord<>(
    "user-events",
    partitionKey,
    event
);
```

**Detection Hints:**
- Partition key fields with low cardinality (country, region, status)
- Monitoring showing uneven partition sizes
- One broker with high CPU while others idle
- Consumer lag on specific partitions
- Top N keys accounting for >50% of traffic

---

### 9. Using Round-Robin When Ordering Matters

**Pattern Name:** Order-Insensitive Partitioning for Order-Sensitive Data

**Description:** Using round-robin or null keys when business logic requires ordering breaks causality.

**Bug Impact:**
- Events for same entity split across partitions
- Cannot guarantee processing order
- Race conditions in downstream systems

**Bad Example:**
```java
// BAD: Round-robin destroys ordering for related events
Properties props = new Properties();
props.put("partitioner.class", "org.apache.kafka.clients.producer.RoundRobinPartitioner");

// These related events may go to different partitions!
producer.send(new ProducerRecord<>("account-events", null, "AccountCreated:123"));
producer.send(new ProducerRecord<>("account-events", null, "BalanceUpdated:123"));
producer.send(new ProducerRecord<>("account-events", null, "AccountClosed:123"));
```

**Good Example:**
```java
// GOOD: Use entity ID as key for ordering
String accountId = "123";

producer.send(new ProducerRecord<>("account-events", accountId, "AccountCreated:123"));
producer.send(new ProducerRecord<>("account-events", accountId, "BalanceUpdated:123"));
producer.send(new ProducerRecord<>("account-events", accountId, "AccountClosed:123"));
// All go to same partition, processed in order
```

**Detection Hints:**
- `RoundRobinPartitioner` or custom partitioner in config
- Null keys on records that should be related
- Business logic with "wait for prerequisite event" patterns
- State machines showing impossible transitions

---

### 10. Too Many Partitions for Low Throughput Topics

**Pattern Name:** Over-Partitioning

**Description:** Creating excessive partitions for low-throughput topics prevents effective batching and wastes resources.

**Bug Impact:**
- Records are batched per topic-partition, so too many partitions = sparse batches
- Messages linger waiting for batch to fill
- Reduced throughput despite low volume
- Increased broker overhead (file handles, memory)

**Bad Example:**
```bash
# BAD: Way too many partitions for low-volume topic
kafka-topics --create --topic low-volume-events \
  --partitions 100 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# Topic only receives 100 messages/day
# = 1 message per partition per day
# = No batching benefits, lots of overhead
```

**Good Example:**
```bash
# GOOD: Match partition count to expected throughput
kafka-topics --create --topic low-volume-events \
  --partitions 3 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# Start small, monitor, scale up if needed
# Rule of thumb: target MB/s per partition, not just parallelism
```

**Detection Hints:**
- High partition count (>50) for low-traffic topics
- Many partitions with 0 or very low message rate
- High `linger.ms` values with low throughput
- Broker metrics showing many idle partitions

---

## Throughput Anti-Patterns

### 11. Disabled or Minimal Batching

**Pattern Name:** One-Message-Per-Request

**Description:** Setting `batch.size=0` or `linger.ms=0` with small messages disables batching, destroying throughput.

**Bug Impact:**
- Each message sent individually over network
- Network overhead dominates
- CPU wasted on per-message protocol overhead
- Throughput can drop 10-100x

**Bad Example:**
```java
// BAD: Batching disabled or too aggressive
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("batch.size", "0"); // Disables batching entirely!
props.put("linger.ms", "0"); // Send immediately, no waiting

// OR: Average message 4MB but batch.size only 16KB
props.put("batch.size", "16384"); // Default, but too small for large messages
props.put("linger.ms", "0");

// Result: Every message sent individually
```

**Good Example:**
```java
// GOOD: Proper batching for high throughput
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("batch.size", "100000"); // 100KB - allow batching multiple messages
props.put("linger.ms", "100"); // Wait up to 100ms to fill batch
props.put("compression.type", "lz4"); // Compress batches

// Result: Messages batched together, compressed, sent efficiently
```

**Detection Hints:**
- `batch.size=0` in producer config
- `linger.ms=0` with high-frequency small messages
- Monitoring showing high request rate with low MB/s
- Network utilization high but throughput low

---

### 12. No Compression on High-Volume Topics

**Pattern Name:** Uncompressed Wire Transfer

**Description:** Sending large volumes without compression wastes network bandwidth and increases latency.

**Bug Impact:**
- Network becomes bottleneck
- Higher latency due to large transfer sizes
- Increased broker disk usage
- Missed opportunity for 5-10x reduction in size

**Bad Example:**
```java
// BAD: No compression on high-volume text data
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("compression.type", "none"); // Or missing entirely

// Sending JSON/XML logs - highly compressible but sent raw
producer.send(new ProducerRecord<>("logs", null, largeJsonPayload));
```

**Good Example:**
```java
// GOOD: Enable compression for compressible data
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("compression.type", "lz4"); // Fast compression, good ratio
// Alternatives: snappy (faster), gzip (better ratio), zstd (best balance)

producer.send(new ProducerRecord<>("logs", null, largeJsonPayload));
// Compressed before sending, decompressed by consumer
```

**Configuration Trade-offs:**
```java
// Compression type selection:
// - lz4: Good balance of speed and ratio (recommended default)
// - snappy: Fastest, moderate compression
// - gzip: Slowest, best compression ratio
// - zstd: Best balance, requires newer Kafka version
// - none: Only for already-compressed data (images, video)

props.put("compression.type", "lz4");
```

**Detection Hints:**
- `compression.type=none` or missing
- High network utilization on producer/broker
- Monitoring showing bytes sent >> bytes after compression
- Text/JSON/XML payloads without compression

---

### 13. Synchronous Send Without Batching

**Pattern Name:** Request-Response Producer Pattern

**Description:** Using `.get()` on producer send futures waits for each message to be acknowledged, completely eliminating batching benefits.

**Bug Impact:**
- Throughput collapses to ~few messages per RTT
- Network latency multiplied by message count
- CPU idle waiting for acknowledgments
- Cannot leverage async batching

**Bad Example:**
```java
// BAD: Synchronous send - waits for each message
for (Order order : orders) {
    RecordMetadata metadata = producer.send(
        new ProducerRecord<>("orders", order.getId(), order)
    ).get(); // BLOCKS until acknowledged!

    // Next message only sent after this one completes
    // = messages/second limited by network latency
}

// With 10ms RTT, max throughput = 100 messages/sec
```

**Good Example:**
```java
// GOOD: Async send with batching
List<Future<RecordMetadata>> futures = new ArrayList<>();

for (Order order : orders) {
    Future<RecordMetadata> future = producer.send(
        new ProducerRecord<>("orders", order.getId(), order),
        (metadata, exception) -> {
            if (exception != null) {
                log.error("Send failed", exception);
            }
        }
    );
    futures.add(future);
    // Returns immediately, message queued for batching
}

// Optionally wait for all at the end
for (Future<RecordMetadata> future : futures) {
    future.get();
}

// Messages batched together, sent in parallel
```

**Detection Hints:**
- `.get()` called immediately after `.send()`
- Producer throughput ~= 1/RTT
- High latency with low CPU utilization
- Code pattern: send inside loop with blocking

---

### 14. Wrong Batch Size for Message Size

**Pattern Name:** Batch Size Mismatch

**Description:** Default `batch.size=16KB` prevents batching when average message size is larger, or wastes memory when messages are tiny.

**Bug Impact:**
- Large messages: batch size reached with 1 message = no batching
- Small messages: batch rarely fills, waiting for timeout
- Missed throughput opportunities

**Bad Example:**
```java
// BAD: Default batch size with 4MB average messages
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("batch.size", "16384"); // 16KB default
props.put("linger.ms", "100");

// Average message = 4MB
// Batch will NEVER contain more than 1 message
// linger.ms timeout wasted on every message
```

**Good Example:**
```java
// GOOD: Tune batch size to message characteristics

// For large messages (MB scale):
Properties props = new Properties();
props.put("batch.size", "5000000"); // 5MB - can fit multiple large messages
props.put("linger.ms", "100");

// For small messages (KB scale):
Properties props2 = new Properties();
props2.put("batch.size", "100000"); // 100KB - fit many small messages
props2.put("linger.ms", "10"); // Shorter linger, fill batches faster

// Monitor batch fill rate and adjust accordingly
```

**Detection Hints:**
- `batch.size` value close to average message size
- Metrics showing batches with 1 message
- High `linger.ms` with single-message batches
- Throughput not improving with increased `linger.ms`

---

## Broker Saturation Anti-Patterns

### 15. Page Cache Thrashing

**Pattern Name:** Memory Competition with Page Cache

**Description:** Kafka brokers rely heavily on OS page cache for performance. Overallocation of heap or other processes competing for memory causes cache evictions and disk reads.

**Bug Impact:**
- Page cache hit rate drops
- Disk I/O increases dramatically
- Latency spikes (ms → seconds)
- Throughput collapses under load

**Bad Example:**
```bash
# BAD: Over-allocating heap, starving page cache
# Server with 32GB RAM
export KAFKA_HEAP_OPTS="-Xmx28G -Xms28G"
# Only 4GB left for page cache - disaster!

# Or: Running other memory-heavy apps on broker
# - Elasticsearch
# - Large Java apps
# - Memory-intensive processing
```

**Good Example:**
```bash
# GOOD: Leave majority of RAM for page cache
# Server with 32GB RAM
export KAFKA_HEAP_OPTS="-Xmx6G -Xms6G"
# 26GB left for page cache - Kafka's sweet spot

# General rule:
# - Heap: 6-8GB for most brokers (rarely need more)
# - Page cache: 50-75% of total RAM
# - OS + other: Remaining

# Monitor page cache hit rate
# - Target: >99% hit rate
# - Below 95%: cache thrashing likely
```

**Detection Hints:**
- High disk read I/O on brokers
- Heap allocation >8GB on brokers
- Memory pressure in OS metrics
- Latency spikes correlated with GC
- Page cache metrics showing frequent evictions

---

### 16. Insufficient Thread Pools

**Pattern Name:** Network/IO Thread Starvation

**Description:** Default thread pool sizes are too small for high-throughput, high-connection-count clusters.

**Bug Impact:**
- Broker cannot handle request load
- Requests queue up, latency increases
- Clients timeout waiting for responses
- Throughput ceiling hit prematurely

**Bad Example:**
```properties
# BAD: Default values insufficient for high load
# In server.properties
num.network.threads=3
num.io.threads=8

# With 100+ client connections and high request rate:
# - Network threads overwhelmed
# - I/O threads bottleneck on disk
```

**Good Example:**
```properties
# GOOD: Scale thread pools to workload
# In server.properties

# Network threads: handle requests from clients
# Formula: 1 thread per ~50 connections, or scale with CPU cores
num.network.threads=8

# I/O threads: handle disk operations
# Formula: number of disks × 2 (for parallel I/O)
num.io.threads=16

# Also increase request queue sizes if needed
queued.max.requests=1000
```

**Detection Hints:**
- Broker logs: "Too many connections" or "Request queue full"
- Client-side timeouts despite broker being up
- Thread pool metrics showing 100% utilization
- Low CPU usage despite high request rate (thread-bound)

---

### 17. Unbalanced Partition Distribution

**Pattern Name:** Lopsided Partition Assignment

**Description:** Partitions unevenly distributed across brokers, causing some brokers to be overloaded while others idle.

**Bug Impact:**
- Hot broker becomes cluster bottleneck
- Cannot scale horizontally despite available capacity
- Uneven disk usage and wear
- Wasted hardware resources

**Bad Example:**
```bash
# BAD: Manual partition assignment without balance check
# Broker 1: 100 partition replicas
# Broker 2: 100 partition replicas
# Broker 3: 20 partition replicas  # Underutilized!

# Or: Not rebalancing after broker addition
# Added Broker 4, but partitions still on 1-3
```

**Good Example:**
```bash
# GOOD: Use Kafka tools to rebalance partitions
kafka-reassign-partitions --bootstrap-server localhost:9092 \
  --generate \
  --topics-to-move-json-file topics.json \
  --broker-list "0,1,2,3"

# Execute the reassignment plan
kafka-reassign-partitions --bootstrap-server localhost:9092 \
  --execute \
  --reassignment-json-file reassignment.json

# Verify balanced distribution
kafka-topics --bootstrap-server localhost:9092 --describe
```

**Monitoring:**
```python
# Monitor partition distribution balance
# Pseudocode for detection
partition_count_per_broker = {
    broker_id: count_partitions(broker_id)
    for broker_id in cluster.brokers
}

max_count = max(partition_count_per_broker.values())
min_count = min(partition_count_per_broker.values())
imbalance_ratio = max_count / min_count

if imbalance_ratio > 1.5:
    alert("Partition distribution unbalanced")
```

**Detection Hints:**
- One broker consistently at high CPU while others low
- Uneven disk usage across brokers
- Metrics showing partition count variance >30%
- Leader election always electing same broker

---

### 18. Replication Factor Mismatch with Availability Requirements

**Pattern Name:** Under-Replicated Topics

**Description:** Setting replication factor too low for availability requirements or broker count.

**Bug Impact:**
- Single broker failure = data loss
- Cannot tolerate failures
- acks=all provides false security
- Cluster unavailable during maintenance

**Bad Example:**
```bash
# BAD: Single replication on critical topic
kafka-topics --create --topic payment-transactions \
  --partitions 10 \
  --replication-factor 1 \
  --bootstrap-server localhost:9092

# Broker failure = payment data loss!

# BAD: RF=2 with acks=all
# Still only 1 backup, broker failure during write = data loss
```

**Good Example:**
```bash
# GOOD: RF=3 for production (tolerates 2 failures)
kafka-topics --create --topic payment-transactions \
  --partitions 10 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# With acks=all, ensures durability
# Can tolerate 2 broker failures without data loss
```

**Configuration:**
```properties
# Broker-level default
default.replication.factor=3

# Minimum in-sync replicas
min.insync.replicas=2

# Producer setting
acks=all
```

**Detection Hints:**
- Topics with `replication-factor=1`
- `min.insync.replicas` not set or =1
- Under-replicated partition alerts
- Single broker storing all replicas

---

## Exactly-Once Semantics Anti-Patterns

### 19. Exactly-Once Claims with External Side Effects

**Pattern Name:** Transactional Boundary Gap

**Description:** Kafka's exactly-once guarantees only apply within Kafka. External systems (databases, APIs) are not covered, breaking exactly-once semantics.

**Bug Impact:**
- Database writes may execute multiple times
- API calls duplicated on consumer retry
- Money transferred twice
- False sense of security from `enable.idempotence=true`

**Bad Example:**
```java
// BAD: Exactly-once in Kafka, but external DB writes not protected
Properties consumerProps = new Properties();
consumerProps.put("isolation.level", "read_committed"); // Thinks it's safe!

KafkaConsumer<String, Payment> consumer = new KafkaConsumer<>(consumerProps);

while (true) {
    ConsumerRecords<String, Payment> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, Payment> record : records) {
        Payment payment = record.value();

        // PROBLEM: This external DB write not in Kafka transaction!
        database.executeUpdate(
            "INSERT INTO payments VALUES (?, ?)",
            payment.getId(),
            payment.getAmount()
        );

        // Consumer crashes after DB write but before commit
        // = duplicate payment on restart!
    }

    consumer.commitSync(); // Too late!
}
```

**Good Example - Option 1: Idempotent Consumer Pattern:**
```java
// GOOD: Idempotent consumer with deduplication table
Properties consumerProps = new Properties();
consumerProps.put("enable.auto.commit", "false");

KafkaConsumer<String, Payment> consumer = new KafkaConsumer<>(consumerProps);

while (true) {
    ConsumerRecords<String, Payment> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, Payment> record : records) {
        Payment payment = record.value();
        String messageId = record.key();

        // Use database transaction with deduplication check
        database.transaction(() -> {
            // Check if already processed
            if (database.exists("processed_messages", messageId)) {
                return; // Skip duplicate
            }

            // Process payment
            database.executeUpdate(
                "INSERT INTO payments VALUES (?, ?)",
                payment.getId(),
                payment.getAmount()
            );

            // Record processing
            database.executeUpdate(
                "INSERT INTO processed_messages VALUES (?)",
                messageId
            );
        });

        // Commit offset only after successful processing
        consumer.commitSync(Collections.singletonMap(
            new TopicPartition(record.topic(), record.partition()),
            new OffsetAndMetadata(record.offset() + 1)
        ));
    }
}
```

**Good Example - Option 2: Transactional Outbox Pattern:**
```java
// GOOD: Outbox pattern - atomic write to DB and Kafka topic
database.transaction(() -> {
    // 1. Write business data
    database.executeUpdate(
        "INSERT INTO payments VALUES (?, ?)",
        payment.getId(),
        payment.getAmount()
    );

    // 2. Write to outbox table (same transaction)
    database.executeUpdate(
        "INSERT INTO outbox VALUES (?, ?, ?)",
        UUID.randomUUID(),
        "payment-processed",
        paymentJson
    );
});

// Separate process reads outbox and publishes to Kafka
// This decouples Kafka transaction from DB transaction
```

**Detection Hints:**
- External database/API calls in consumer loop
- `isolation.level=read_committed` with external side effects
- Duplicate payments, orders, or emails reported
- No deduplication table or idempotency keys
- Comments claiming "exactly once" with external systems

---

### 20. Transaction Timeout Mismatch

**Pattern Name:** Transaction Expiration During Processing

**Description:** Setting `transaction.timeout.ms` too low for processing time causes transactions to abort mid-processing.

**Bug Impact:**
- Transactions expire before commit
- Work rolled back after completion
- Processing appears to succeed but is lost
- Infinite retry loops

**Bad Example:**
```java
// BAD: Short timeout for long-running processing
Properties props = new Properties();
props.put("transactional.id", "my-transaction-id");
props.put("transaction.timeout.ms", "60000"); // 60 seconds

producer.initTransactions();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    producer.beginTransaction();

    for (ConsumerRecord<String, String> record : records) {
        // Processing takes 2 minutes per batch!
        expensiveProcessing(record);

        ProducerRecord<String, String> outputRecord = transform(record);
        producer.send(outputRecord);
    }

    // Transaction expired 60 seconds ago!
    producer.commitTransaction(); // FAILS
}
```

**Good Example:**
```java
// GOOD: Timeout accounts for max processing time
Properties props = new Properties();
props.put("transactional.id", "my-transaction-id");

// Max processing time per batch: 3 minutes
// Set timeout to 5 minutes for safety margin
props.put("transaction.timeout.ms", "300000"); // 5 minutes

// Broker must also allow this
// In server.properties: transaction.max.timeout.ms >= 300000

producer.initTransactions();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    producer.beginTransaction();

    try {
        for (ConsumerRecord<String, String> record : records) {
            expensiveProcessing(record);
            ProducerRecord<String, String> outputRecord = transform(record);
            producer.send(outputRecord);
        }

        producer.sendOffsetsToTransaction(getOffsets(records), consumerGroupId);
        producer.commitTransaction(); // Succeeds within timeout
    } catch (Exception e) {
        producer.abortTransaction();
    }
}
```

**Detection Hints:**
- Broker logs: "Transaction has timed out"
- Producer logs: `ProducerFencedException` or `InvalidTxnStateException`
- Processing completes but results not committed
- `transaction.timeout.ms` < average batch processing time

---

### 21. Missing Transaction ID for EOS

**Pattern Name:** Transactional Producer Without Transaction ID

**Description:** Enabling idempotence without setting `transactional.id` provides only producer-level deduplication, not full exactly-once semantics.

**Bug Impact:**
- Cannot do atomic reads-process-writes
- Producer restart breaks deduplication (new PID assigned)
- Consume-transform-produce patterns not exactly-once
- False understanding of guarantee level

**Bad Example:**
```java
// BAD: Idempotent but not transactional
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("enable.idempotence", "true"); // Good start
// Missing: transactional.id

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Problem 1: Producer restart = new PID, deduplication state lost
// Problem 2: Cannot do atomic consume-produce

// Reading from one topic, writing to another
ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
for (ConsumerRecord<String, String> record : records) {
    String transformed = transform(record.value());
    producer.send(new ProducerRecord<>("output-topic", transformed));
}
consumer.commitSync();

// Gap between produce and commit offset = not atomic!
```

**Good Example:**
```java
// GOOD: Full transactional producer
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("enable.idempotence", "true");
props.put("transactional.id", "my-unique-transactional-id"); // Required for EOS!

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.initTransactions(); // Initialize transactional producer

Properties consumerProps = new Properties();
consumerProps.put("isolation.level", "read_committed"); // Only read committed

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    producer.beginTransaction();

    try {
        for (ConsumerRecord<String, String> record : records) {
            String transformed = transform(record.value());
            producer.send(new ProducerRecord<>("output-topic", transformed));
        }

        // Atomic: commit messages AND offsets together
        producer.sendOffsetsToTransaction(
            getOffsets(records),
            consumer.groupMetadata()
        );

        producer.commitTransaction(); // All or nothing

    } catch (Exception e) {
        producer.abortTransaction(); // Rollback everything
    }
}
```

**Detection Hints:**
- `enable.idempotence=true` without `transactional.id`
- Consume-transform-produce pattern without transactions
- Producer restart causing duplicate detection failures
- Code comments about "exactly once" without transaction API

---

## Summary: Detection Checklist

Use this checklist to scan for anti-patterns in your Kafka codebase:

### Ordering Issues
- [ ] Search for `new ProducerRecord<>(topic, value)` - missing keys
- [ ] Check for multiple topics with related event types
- [ ] Look for `--alter --partitions` commands in scripts
- [ ] Verify `enable.idempotence=true` on all producers

### Deduplication Issues
- [ ] Confirm `enable.idempotence=true` on all producers
- [ ] Check for custom Set/Map-based deduplication logic
- [ ] Search for `enable.auto.commit=true`
- [ ] Verify manual commit after processing, not before

### Partitioning Issues
- [ ] Identify low-cardinality partition keys (country, status, etc.)
- [ ] Check for `RoundRobinPartitioner` on ordered data
- [ ] Look for topics with >50 partitions but low traffic
- [ ] Monitor partition size distribution for skew

### Throughput Issues
- [ ] Search for `batch.size=0` or very small values
- [ ] Check for `linger.ms=0` on high-throughput producers
- [ ] Verify `compression.type` is set (not "none")
- [ ] Look for `.get()` called immediately after `.send()`

### Broker Issues
- [ ] Check `KAFKA_HEAP_OPTS` - should be <8GB typically
- [ ] Verify `num.network.threads` and `num.io.threads` scaled
- [ ] Check partition distribution balance across brokers
- [ ] Confirm `replication-factor >= 3` for production topics

### Exactly-Once Issues
- [ ] Search for database/API calls in consumer loops
- [ ] Verify `transactional.id` set when using transactions
- [ ] Check `transaction.timeout.ms` vs. processing time
- [ ] Confirm idempotent consumer pattern for external systems

---

## References and Further Reading

### Primary Sources
- [Should you put several event types in the same Kafka topic? — Martin Kleppmann's blog](https://martin.kleppmann.com/2018/01/18/event-types-in-kafka-topic.html)
- [Kafka Keys, Partitions and Message Ordering](https://www.lydtechconsulting.com/blog/kafka-message-keys)
- [Exactly-once Semantics is Possible: Here's How Apache Kafka Does it](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [Achieving Exactly-Once Semantics in Kafka: Producer & Consumer Idempotency](https://medium.com/@anil.goyal0057/achieving-exactly-once-semantics-in-kafka-producer-consumer-idempotency-abad50cba95c)

### Anti-Pattern Collections
- [Apache Kafka® Anti-Patterns and How To Avoid Them - Instaclustr](https://www.instaclustr.com/blog/apache-kafka-anti-patterns/)
- [Kafka Anti-Patterns: Common Pitfalls and How to Avoid Them](https://medium.com/@shailendrasinghpatil/kafka-anti-patterns-common-pitfalls-and-how-to-avoid-them-833cdcf2df89)
- [Top 10 Kafka Anti-Patterns That Are Killing Your Microservices Performance](https://medium.com/@gaddamnaveen192/top-10-kafka-anti-patterns-that-are-killing-your-microservices-performance-5a6f71d58141)
- [Apache Kafka Patterns and Anti-Patterns - DZone Refcards](https://dzone.com/refcardz/apache-kafka-patterns-and-anti-patterns)

### Performance and Optimization
- [Optimizing Kafka producers](https://strimzi.io/blog/2020/10/15/producer-tuning/)
- [How to optimize a Kafka producer for throughput](https://developer.confluent.io/confluent-tutorials/optimize-producer-throughput/kafka/)
- [Apache Kafka Guide #32 Producer linger.ms and batch.size settings](https://medium.com/apache-kafka-from-zero-to-hero/apache-kafka-guide-32-producer-linger-ms-and-batch-size-settings-b19b0050a2c8)
- [Kafka performance tuning strategies & tips](https://www.redpanda.com/guides/kafka-performance-kafka-performance-tuning)

### Partitioning and Scaling
- [Apache Kafka Partition Key: A Comprehensive Guide](https://www.confluent.io/learn/kafka-partition-key/)
- [Handling Hot Partitions in Kafka](https://medium.com/@natesh.somanna/handling-hot-partitions-in-kafka-c7b41b36c929)
- [Kafka Partitioning : Key Performance Considerations](https://medium.com/@27.rahul.k/kafka-partitioning-key-performance-considerations-94e5e980bb6a)

### Operational Issues
- [Common Kafka Performance Issues and How to Fix Them](https://www.meshiq.com/blog/common-kafka-performance-issues-and-how-to-fix-them/)
- [Fixing Consumer Lag and Broker Performance Bottlenecks in Apache Kafka](https://www.mindfulchase.com/explore/troubleshooting-tips/fixing-consumer-lag-and-broker-performance-bottlenecks-in-apache-kafka.html)
- [Kafka Design: Page Cache & Performance](https://github.com/AutoMQ/automq/wiki/Kafka-Design:-Page-Cache-&-Performance)

### Exactly-Once Semantics
- [Extending Kafka's Exactly-Once Semantics to External Systems](https://medium.com/@raviatadobe/extending-kafkas-exactly-once-semantics-to-external-systems-c395267935bd)
- [Idempotent Processing with Kafka](https://nejckorasa.github.io/posts/idempotent-kafka-procesing/)
- [What does Kafka's exactly-once processing really mean?](https://softwaremill.com/what-kafka-exactly-once-really-means/)

---

*Last Updated: 2025-12-11*
*This knowledge base is used by AI systems to detect anti-patterns in code analysis.*
