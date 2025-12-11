# Kafka Topic and Partition Anti-Patterns

This document covers common anti-patterns related to Kafka topic and partition configuration, including detection methods and remediation strategies.

---

## 1. Over-Partitioning (Too Many Partitions)

### Description
Creating topics with excessive partitions leads to performance degradation, rebalancing issues, and increased resource overhead. While KRaft mode allows thousands of partitions, throughput still drops significantly beyond 1,000 topics. Historical benchmarks show optimal partition counts between the number of cores (typically 10s) and 100, with more than 100 partitions causing significant throughput reduction.

### Bad Configuration Example

```yaml
# Kafka topic with excessive partitions for low-throughput workload
kafka-topics.sh --create \
  --topic user-events \
  --partitions 500 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# Application with low message volume
# Only 10 messages/second but 500 partitions
# Results in mostly empty partitions
```

```java
// Creating topic with too many partitions programmatically
Properties props = new Properties();
NewTopic topic = new NewTopic("user-events", 500, (short) 3);
adminClient.createTopics(Collections.singleton(topic));
// Most partitions will remain empty with low traffic
```

### Good Configuration Example

```yaml
# Right-sized partition count based on parallelism needs
kafka-topics.sh --create \
  --topic user-events \
  --partitions 12 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# Partition count considers:
# - Number of consumer instances (12 max consumers)
# - Expected throughput (moderate volume)
# - Number of broker cores (4 brokers × 3 cores = 12)
```

```java
// Calculate partition count based on requirements
int maxConsumers = 12;
int brokerCores = 12; // 4 brokers × 3 cores
int targetThroughputMBps = 100;
int partitionThroughputMBps = 10;

// Use minimum of consumer parallelism and throughput needs
int partitions = Math.max(
    maxConsumers,
    targetThroughputMBps / partitionThroughputMBps
);

NewTopic topic = new NewTopic("user-events", partitions, (short) 3);
```

### Detection Hints

**Configuration Checks:**
- Topics with > 100 partitions should be reviewed for actual usage
- Ratio of messages per partition < 1000/day indicates over-partitioning
- Check `kafka-topics.sh --describe` for partition count vs utilization

**Metrics to Monitor:**
- `kafka.server:type=ReplicaManager,name=PartitionCount` - Total partitions per broker
- `kafka.server:type=ReplicaManager,name=LeaderCount` - Leader partitions per broker
- `kafka.controller:type=KafkaController,name=ActiveControllerCount` - Controller election time
- Consumer rebalance duration (increases with partition count)
- File descriptor usage (each partition requires multiple file handles)

**Log Indicators:**
```
[WARN] Too many open files
[WARN] Consumer group rebalance took 45s (should be < 10s)
[ERROR] java.io.IOException: Too many open files
```

---

## 2. Under-Partitioning (Insufficient Parallelism)

### Description
Topics with too few partitions create bottlenecks by limiting parallel processing, leading to consumer under-utilization, broker overload, message backlogs, and sluggish throughput. The broker hosting under-partitioned topics may experience CPU and disk I/O bottlenecks.

### Bad Configuration Example

```yaml
# High-throughput topic with only 1 partition
kafka-topics.sh --create \
  --topic payment-transactions \
  --partitions 1 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# Problem: 1 million events/day but only 1 partition
# Only 1 consumer can read, creating a bottleneck
```

```java
// Consumer group with 20 consumers but only 1 partition
Properties props = new Properties();
props.put("group.id", "payment-processors");
// 20 consumer instances created, but only 1 can work!
// 19 consumers sit idle

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Collections.singletonList("payment-transactions"));
// Only 1 of 20 consumers processes all messages
```

### Good Configuration Example

```yaml
# Partition count matches consumer parallelism and throughput
kafka-topics.sh --create \
  --topic payment-transactions \
  --partitions 20 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

# 20 partitions allows:
# - 20 consumers to work in parallel
# - Load distributed across brokers
# - Room for growth
```

```java
// Right-sized consumer group matching partition count
int partitionCount = 20; // Matches topic partitions
int consumerCount = 20;  // Can fully utilize all partitions

// Calculate partitions based on throughput
long messagesPerDay = 1_000_000;
long messagesPerSecond = messagesPerDay / 86400; // ~12 msgs/sec
int partitionsNeeded = (int) Math.ceil(messagesPerSecond / 100.0); // 100 msg/sec per partition

// Start conservative, can increase later
NewTopic topic = new NewTopic("payment-transactions",
    Math.max(partitionsNeeded, consumerCount), (short) 3);
```

### Detection Hints

**Configuration Checks:**
- Partition count < number of consumer instances (idle consumers)
- Single partition for high-volume topics (> 10K messages/day)
- Consumer lag consistently growing despite available consumer capacity

**Metrics to Monitor:**
- `kafka.consumer:type=consumer-fetch-manager-metrics,partition=*` - Check if partitions are maxed out
- `kafka.server:type=BrokerTopicMetrics,name=MessagesInPerSec` - Messages per partition rate
- Consumer lag (`records-lag-max`) - Growing lag with idle consumers indicates under-partitioning
- CPU utilization on brokers - Single broker at 100% while others idle
- `kafka.server:type=Request,name=TotalTimeMs,request=Produce` - High produce latency

**Log Indicators:**
```
[WARN] Consumer lag growing: current lag = 500000 messages
[WARN] Broker disk I/O at 95% utilization
[INFO] 15 of 20 consumers idle (not assigned partitions)
```

---

## 3. Message Too Large (Exceeds max.message.bytes)

### Description
Producing messages larger than configured limits causes `RecordTooLargeException` or `MessageSizeTooLargeException`. Default Kafka message size limit is 1 MB. The issue requires coordinating settings across broker, topic, producer, and consumer configurations.

### Bad Configuration Example

```properties
# Broker config - default 1MB limit
message.max.bytes=1048576

# Producer tries to send 2MB message
max.request.size=2097152  # 2MB

# Consumer not configured for large messages
fetch.max.bytes=52428800  # 50MB (default)
max.partition.fetch.bytes=1048576  # 1MB (default)
```

```java
// Producer sends message exceeding broker limit
Properties props = new Properties();
props.put("max.request.size", 2097152); // 2MB
KafkaProducer<String, byte[]> producer = new KafkaProducer<>(props);

byte[] largePayload = new byte[2 * 1024 * 1024]; // 2MB message
ProducerRecord<String, byte[]> record =
    new ProducerRecord<>("events", "key", largePayload);

producer.send(record);
// ERROR: org.apache.kafka.common.errors.RecordTooLargeException:
// The message is 2097152 bytes when serialized which is larger than
// the maximum request size you have configured with the max.request.size configuration.
```

### Good Configuration Example

```properties
# Coordinated configuration across all components

# Broker-level (server.properties)
message.max.bytes=5242880  # 5MB
replica.fetch.max.bytes=5242880  # Must be >= message.max.bytes

# Topic-level configuration
kafka-topics.sh --alter \
  --topic large-events \
  --config max.message.bytes=5242880 \
  --bootstrap-server localhost:9092

# Producer configuration
max.request.size=5242880  # 5MB

# Consumer configuration
fetch.max.bytes=52428800  # 50MB (must be larger than single message)
max.partition.fetch.bytes=5242880  # 5MB (must be >= max.message.bytes)
```

```java
// Properly configured producer with error handling
Properties producerProps = new Properties();
producerProps.put("bootstrap.servers", "localhost:9092");
producerProps.put("max.request.size", 5242880); // 5MB
producerProps.put("compression.type", "lz4"); // Compress large messages

KafkaProducer<String, byte[]> producer = new KafkaProducer<>(producerProps);

byte[] payload = new byte[4 * 1024 * 1024]; // 4MB
ProducerRecord<String, byte[]> record = new ProducerRecord<>("large-events", payload);

// Better approach: Check size before sending
if (payload.length > 5 * 1024 * 1024) {
    // Store in object storage (S3, GCS) and send reference
    String s3Key = uploadToS3(payload);
    record = new ProducerRecord<>("large-events", s3Key.getBytes());
}

producer.send(record, (metadata, exception) -> {
    if (exception != null) {
        if (exception instanceof RecordTooLargeException) {
            log.error("Message too large: {} bytes", payload.length);
            // Handle: chunk, compress, or use reference pattern
        }
    }
});

// Consumer configuration
Properties consumerProps = new Properties();
consumerProps.put("fetch.max.bytes", 52428800); // 50MB
consumerProps.put("max.partition.fetch.bytes", 5242880); // 5MB
```

### Detection Hints

**Configuration Checks:**
- Verify `message.max.bytes` (broker) >= `max.message.bytes` (topic)
- Verify `replica.fetch.max.bytes` >= `message.max.bytes`
- Producer `max.request.size` should be <= broker limits
- Consumer `max.partition.fetch.bytes` should be >= topic limit

**Metrics to Monitor:**
- `kafka.server:type=BrokerTopicMetrics,name=FailedProduceRequestsPerSec`
- `kafka.producer:type=producer-metrics,client-id=*,attribute=record-size-max`
- `kafka.producer:type=producer-metrics,client-id=*,attribute=record-error-rate`

**Log Indicators:**
```
[ERROR] org.apache.kafka.common.errors.RecordTooLargeException
[ERROR] Broker: Message size too large
[WARN] The message is 2097152 bytes when serialized which is larger than max.request.size
```

**Best Practice:**
```java
// Avoid large messages entirely - use reference pattern
public class MessageReference {
    String storageUrl;  // S3/GCS URL
    String checksum;
    long size;
}
// Send reference in Kafka, store actual data in object storage
```

---

## 4. Compacted Topics Misconfigured

### Description
Log compacted topics require specific configuration. Common issues include incorrect `cleanup.policy` values, combined policy notation errors (must use brackets for command-line: `cleanup.policy=[compact,delete]`), compaction not starting after policy changes, and broker vs topic-level configuration conflicts.

### Bad Configuration Example

```properties
# Topic created without proper compaction settings
kafka-topics.sh --create \
  --topic user-state \
  --partitions 10 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092
# Missing: cleanup.policy=compact

# Broker default is delete
log.cleanup.policy=delete
# Topic inherits delete policy - old keys are lost!
```

```java
// Producer sends state updates but compaction not enabled
Properties props = new Properties();
KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Sending user state updates with same key
producer.send(new ProducerRecord<>("user-state", "user123", "status=active"));
Thread.sleep(1000);
producer.send(new ProducerRecord<>("user-state", "user123", "status=inactive"));
// Both messages retained because cleanup.policy=delete
// Eventually BOTH messages deleted after retention period
// State tracking breaks!
```

```properties
# Invalid combined policy - missing brackets
cleanup.policy=compact,delete  # WRONG for command-line!

# Compaction delays - segments never close
segment.bytes=1073741824  # 1GB - too large for low-volume topic
segment.ms=604800000      # 7 days - too long
# Result: Active segment never rolls, compaction never runs
```

### Good Configuration Example

```properties
# Proper compacted topic configuration
kafka-topics.sh --create \
  --topic user-state \
  --partitions 10 \
  --replication-factor 3 \
  --config cleanup.policy=compact \
  --config min.cleanable.dirty.ratio=0.5 \
  --config segment.ms=3600000 \
  --config segment.bytes=104857600 \
  --config delete.retention.ms=86400000 \
  --bootstrap-server localhost:9092

# Combined policy - correct syntax
kafka-topics.sh --create \
  --topic user-state-with-ttl \
  --config "cleanup.policy=[compact,delete]" \
  --config retention.ms=604800000 \
  --bootstrap-server localhost:9092
```

```properties
# Optimized compaction settings for low-volume topics
cleanup.policy=compact
min.cleanable.dirty.ratio=0.5  # Compact when 50% is old data
segment.ms=3600000             # Roll segment every 1 hour
segment.bytes=104857600        # 100MB segments (smaller = more frequent compaction)
delete.retention.ms=86400000   # Keep tombstones for 24 hours
max.compaction.lag.ms=86400000 # Force compaction within 24 hours
min.compaction.lag.ms=0        # Allow immediate compaction

# Broker-level settings
log.cleaner.enable=true
log.cleaner.threads=2
log.cleaner.dedupe.buffer.size=134217728  # 128MB
```

```java
// Proper usage of compacted topic with explicit key
Properties props = new Properties();
KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// State updates with same key - only latest kept after compaction
producer.send(new ProducerRecord<>("user-state", "user123",
    "{\"status\":\"active\",\"updated\":\"2025-12-11T10:00:00Z\"}"));

// Later update with same key
producer.send(new ProducerRecord<>("user-state", "user123",
    "{\"status\":\"inactive\",\"updated\":\"2025-12-11T12:00:00Z\"}"));

// After compaction: only second message retained
// Guarantees latest state always available

// Delete state (tombstone)
producer.send(new ProducerRecord<>("user-state", "user123", null));
// null value = tombstone, key deleted after delete.retention.ms
```

### Detection Hints

**Configuration Checks:**
```bash
# Verify cleanup policy
kafka-topics.sh --describe --topic user-state --bootstrap-server localhost:9092
# Look for: cleanup.policy=compact

# Check broker configuration
kafka-configs.sh --describe --broker 0 --bootstrap-server localhost:9092 | grep cleanup.policy

# Verify compaction settings
kafka-topics.sh --describe --topic user-state --bootstrap-server localhost:9092 --config
# Check: segment.ms, segment.bytes, min.cleanable.dirty.ratio
```

**Metrics to Monitor:**
- `kafka.log:type=LogCleanerManager,name=max-dirty-percent` - Should be < min.cleanable.dirty.ratio
- `kafka.log:type=LogCleaner,name=cleaner-recopy-percent` - Compaction efficiency
- `kafka.log:type=LogCleaner,name=max-compaction-delay-secs` - Time since last compaction
- `kafka.log:type=Log,name=LogStartOffset,topic=*,partition=*` - Advancing offset indicates compaction working
- `kafka.server:type=BrokerTopicMetrics,name=TotalProduceRequestsPerSec` vs log size growth

**Log Indicators:**
```
[WARN] Topic user-state has cleanup.policy=delete but expected compact
[ERROR] InvalidCleanupPolicyException: Invalid cleanup policy: compacted
[WARN] Log compaction not running - active segment has not rolled in 7 days
[INFO] Deleted log segment for user-state-3 with base offset 10000 (expected to be compacted)
```

**Troubleshooting:**
```bash
# If compaction not working after policy change
# Stop broker and delete checkpoint file
rm /var/lib/kafka/cleaner-offset-checkpoint

# Check log cleaner status
kafka-run-class.sh kafka.admin.LogDirsCommand \
  --describe --bootstrap-server localhost:9092 --broker-list 0
```

---

## 5. Message Ordering Broken by Wrong Partition Key

### Description
Kafka guarantees message order only within a partition. Using null keys, inconsistent keys, or changing key schemas causes messages that should be ordered to land in different partitions. Since Kafka 2.4+, null keys use sticky partitioner (fills one partition batch before switching), but still provide no ordering guarantees.

### Bad Configuration Example

```java
// Anti-pattern 1: Null keys - no ordering guarantee
KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// User events with null key - random partition assignment
producer.send(new ProducerRecord<>("user-events", null, "user123: login"));
producer.send(new ProducerRecord<>("user-events", null, "user123: purchase"));
producer.send(new ProducerRecord<>("user-events", null, "user123: logout"));
// These may go to different partitions - ORDER LOST!

// Anti-pattern 2: Inconsistent key format
producer.send(new ProducerRecord<>("user-events", "user123", "login"));
producer.send(new ProducerRecord<>("user-events", "USER123", "purchase"));  // Different case!
producer.send(new ProducerRecord<>("user-events", "123", "logout"));        // Different format!
// Same user, different keys = different partitions = NO ORDER

// Anti-pattern 3: Wrong partition key choice
// Key by timestamp instead of user ID
String timestamp = String.valueOf(System.currentTimeMillis());
producer.send(new ProducerRecord<>("user-events", timestamp,
    "{\"user\":\"user123\",\"action\":\"login\"}"));
// Every message has unique key = random distribution = NO ORDER PER USER
```

```java
// Anti-pattern 4: Changing partition count breaks ordering
// Initial setup: 10 partitions
// Key "user123" maps to partition 5 (hash("user123") % 10 = 5)

// Later: scale up to 20 partitions
kafka-topics.sh --alter --topic user-events --partitions 20

// Now "user123" maps to partition 13 (hash("user123") % 20 = 13)
// New messages go to partition 13, old messages in partition 5
// ORDER BROKEN when consuming from beginning!
```

### Good Configuration Example

```java
// Correct: Consistent partition key based on ordering requirement
KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// All events for same user go to same partition
String userId = "user123";
producer.send(new ProducerRecord<>("user-events", userId, "login"));
producer.send(new ProducerRecord<>("user-events", userId, "purchase"));
producer.send(new ProducerRecord<>("user-events", userId, "logout"));
// All go to same partition (e.g., partition 5) - ORDER PRESERVED

// Best practice: Normalize keys
String normalizedKey = userId.toLowerCase().trim();
producer.send(new ProducerRecord<>("user-events", normalizedKey, event));
```

```java
// Idempotent producer for exactly-once ordering
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("enable.idempotence", true);  // Guarantees ordering per partition
props.put("max.in.flight.requests.per.connection", 5);
props.put("retries", Integer.MAX_VALUE);
props.put("acks", "all");

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Send with consistent key
String orderId = "order-12345";
producer.send(new ProducerRecord<>("orders", orderId, "created"));
producer.send(new ProducerRecord<>("orders", orderId, "paid"));
producer.send(new ProducerRecord<>("orders", orderId, "shipped"));
// Idempotence ensures exact order even with retries
```

```java
// Single partition for strict total ordering (use sparingly)
kafka-topics.sh --create \
  --topic critical-audit-log \
  --partitions 1 \
  --replication-factor 3 \
  --bootstrap-server localhost:9092

// All messages in exact order, but limited throughput
KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.send(new ProducerRecord<>("critical-audit-log", "key", "event1"));
producer.send(new ProducerRecord<>("critical-audit-log", "key", "event2"));
// TOTAL ORDER guaranteed, but only 1 consumer can read
```

```java
// Consumer-side ordering guarantee with single consumer per partition
Properties consumerProps = new Properties();
consumerProps.put("group.id", "user-event-processor");
consumerProps.put("enable.auto.commit", false);
consumerProps.put("max.poll.records", 100);

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);
consumer.subscribe(Collections.singletonList("user-events"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    // Process records by partition to maintain order
    for (TopicPartition partition : records.partitions()) {
        List<ConsumerRecord<String, String>> partitionRecords =
            records.records(partition);

        for (ConsumerRecord<String, String> record : partitionRecords) {
            // Process in order for this partition
            processEvent(record.key(), record.value());
        }

        // Commit after processing partition to maintain order
        consumer.commitSync(Collections.singletonMap(partition,
            new OffsetAndMetadata(partitionRecords.get(partitionRecords.size() - 1).offset() + 1)));
    }
}
```

### Detection Hints

**Configuration Checks:**
```bash
# Check if partition count changed (ordering might be broken)
kafka-topics.sh --describe --topic user-events --bootstrap-server localhost:9092
# Compare with historical records of partition count

# Analyze key distribution
kafka-console-consumer.sh --bootstrap-server localhost:9092 \
  --topic user-events --from-beginning --property print.key=true \
  --property print.partition=true | grep "^Partition"
# Look for same keys appearing in different partitions
```

**Metrics to Monitor:**
- `kafka.producer:type=producer-metrics,client-id=*,attribute=record-queue-time-avg` - High values suggest ordering issues
- `kafka.producer:type=producer-topic-metrics,client-id=*,topic=*,attribute=record-send-rate` - Null key rate
- Custom metric: Track null key percentage in producer
- Custom metric: Track unique partitions per key over time

**Code Review Checks:**
```java
// Add validation in producer
public void send(String key, String value) {
    if (key == null) {
        log.error("Null partition key detected for value: {}", value);
        throw new IllegalArgumentException("Partition key required for ordering");
    }
    if (key.trim().isEmpty()) {
        log.error("Empty partition key detected");
        throw new IllegalArgumentException("Partition key cannot be empty");
    }
    producer.send(new ProducerRecord<>(TOPIC, key, value));
}
```

**Log Indicators:**
```
[WARN] Message sent with null key to topic 'user-events'
[ERROR] Out-of-order processing detected: received logout before login for user123
[WARN] Same key 'user123' observed in multiple partitions (5, 13) - possible partition count change
```

**Testing Ordering:**
```java
// Test to verify ordering
@Test
public void testMessageOrderingWithSameKey() {
    String key = "user123";
    List<String> sentMessages = Arrays.asList("event1", "event2", "event3");

    // Send all with same key
    for (String msg : sentMessages) {
        producer.send(new ProducerRecord<>("test-topic", key, msg)).get();
    }

    // Consume and verify order
    List<String> receivedMessages = new ArrayList<>();
    consumer.subscribe(Collections.singletonList("test-topic"));
    // ... consume messages ...

    assertEquals(sentMessages, receivedMessages, "Message order must be preserved");
}
```

---

## 6. Retention Settings Too Aggressive or Too Lax

### Description
Incorrect `retention.ms` (time-based) or `retention.bytes` (size-based) settings cause either premature data loss or unbounded disk growth. Both settings can be active simultaneously - data is deleted when either limit is reached. Common misconfigurations include conflicting time settings, setting bytes to 0 instead of -1 for unlimited, and inconsistent broker vs topic-level settings.

### Bad Configuration Example

```properties
# Anti-pattern 1: Too aggressive - data deleted before consumers can read
retention.ms=3600000  # 1 hour
retention.bytes=104857600  # 100MB per partition

# Problem: Consumer lag > 1 hour loses data
# Batch jobs running daily lose all data!
```

```properties
# Anti-pattern 2: No retention limits - unbounded growth
retention.ms=-1  # Never delete by time
retention.bytes=-1  # Never delete by size
# Disk fills up, broker crashes!
```

```properties
# Anti-pattern 3: Conflicting settings
retention.ms=604800000  # 7 days
retention.hours=720     # 30 days (720 hours)
# Which one wins? Confusing and error-prone!
```

```properties
# Anti-pattern 4: Wrong value for unlimited
retention.bytes=0  # WRONG! Should be -1
# 0 means "delete immediately" not "no limit"
```

```java
// Anti-pattern 5: Mismatch between producer rate and retention
Properties topicConfig = new Properties();
topicConfig.put("retention.ms", "3600000"); // 1 hour
topicConfig.put("retention.bytes", "104857600"); // 100MB per partition

// But producing 1GB per hour per partition!
// Data deleted before processing, consumers can't keep up
for (int i = 0; i < 1_000_000; i++) {
    byte[] largeMessage = new byte[1024]; // 1KB each
    producer.send(new ProducerRecord<>("events", largeMessage));
}
// 1 million × 1KB = 1GB, but retention.bytes = 100MB
// 900MB deleted immediately after production!
```

### Good Configuration Example

```properties
# Balanced retention based on SLA and storage capacity
retention.ms=604800000  # 7 days
retention.bytes=107374182400  # 100GB per partition
segment.bytes=1073741824  # 1GB segments
segment.ms=86400000  # Roll segment daily

# Reasoning:
# - 7 days allows weekend downtime for consumers
# - 100GB per partition supports expected volume
# - Daily segment rolling for manageable file sizes
# - Deletion happens when EITHER limit reached
```

```properties
# Time-series data with short retention
kafka-topics.sh --create \
  --topic metrics \
  --partitions 50 \
  --replication-factor 3 \
  --config retention.ms=86400000 \
  --config retention.bytes=10737418240 \
  --config segment.ms=3600000 \
  --bootstrap-server localhost:9092

# 1 day retention for high-volume metrics
# Hourly segments for frequent cleanup
```

```properties
# Audit log with long retention
kafka-topics.sh --create \
  --topic audit-log \
  --partitions 10 \
  --replication-factor 3 \
  --config retention.ms=31536000000 \
  --config retention.bytes=-1 \
  --config segment.bytes=1073741824 \
  --config compression.type=lz4 \
  --bootstrap-server localhost:9092

# 1 year retention (365 days)
# No size limit (unlimited)
# Compression to reduce storage
```

```java
// Calculate retention based on SLA and volume
public class RetentionCalculator {
    public static RetentionConfig calculate(
            long messagesPerDay,
            int avgMessageSizeBytes,
            int partitions,
            int consumerMaxLagHours,
            double storageBufferFactor) {

        // Time retention: 2x max consumer lag
        long retentionMs = consumerMaxLagHours * 2 * 3600 * 1000L;

        // Size retention: expected volume + buffer
        long messagesPerPartition = messagesPerDay / partitions;
        long bytesPerDay = messagesPerPartition * avgMessageSizeBytes;
        long retentionDays = retentionMs / (86400 * 1000L);
        long retentionBytes = (long)(bytesPerDay * retentionDays * storageBufferFactor);

        return new RetentionConfig(retentionMs, retentionBytes);
    }
}

// Example usage
RetentionConfig config = RetentionCalculator.calculate(
    10_000_000,  // 10M messages/day
    1024,        // 1KB average message
    50,          // 50 partitions
    24,          // Max 24 hour consumer lag
    1.5          // 50% storage buffer
);

// retention.ms = 172800000 (48 hours)
// retention.bytes = 6442450944 (~6GB per partition)
```

```properties
# Tiered storage for long retention with lower cost
kafka-topics.sh --create \
  --topic long-term-events \
  --config retention.ms=2592000000 \
  --config retention.bytes=-1 \
  --config local.retention.ms=604800000 \
  --config local.retention.bytes=107374182400 \
  --config remote.storage.enable=true \
  --bootstrap-server localhost:9092

# Total retention: 30 days
# Local (hot) retention: 7 days
# Older data moved to remote storage (S3, etc.)
```

### Detection Hints

**Configuration Checks:**
```bash
# Check retention settings
kafka-topics.sh --describe --topic events --bootstrap-server localhost:9092
# Look for: retention.ms, retention.bytes

# Check for conflicting settings
kafka-configs.sh --describe --entity-type topics --entity-name events \
  --bootstrap-server localhost:9092 | grep retention

# Warning if both retention.hours and retention.ms set
# retention.ms takes precedence
```

**Metrics to Monitor:**
- `kafka.log:type=Log,name=Size,topic=*,partition=*` - Current partition size
- `kafka.log:type=Log,name=LogEndOffset,topic=*,partition=*` - Messages in partition
- `kafka.log:type=Log,name=LogStartOffset,topic=*,partition=*` - Oldest message offset
- `kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec` - Inbound data rate
- Disk usage: `df -h /var/lib/kafka` - Should never reach 100%
- Consumer lag vs retention period - Lag should be << retention time

**Alerts to Set:**
```yaml
# Alert if consumer lag approaching retention limit
- alert: ConsumerLagNearRetention
  expr: |
    kafka_consumer_lag_seconds > (kafka_topic_retention_ms / 1000) * 0.8
  annotations:
    summary: "Consumer lag approaching retention limit"

# Alert if disk usage high (retention.bytes may be too lax)
- alert: KafkaDiskUsageHigh
  expr: disk_usage_percent > 80
  annotations:
    summary: "Kafka disk usage above 80%"

# Alert if data deleted too quickly (retention too aggressive)
- alert: HighLogDeletionRate
  expr: rate(kafka_log_log_segments_deleted[5m]) > 10
  annotations:
    summary: "High rate of log segment deletion"
```

**Log Indicators:**
```
[WARN] Deleted log segment for topic events-5 due to retention time 604800000ms
[ERROR] No space left on device (retention.bytes too high or unlimited)
[WARN] Consumer lag 3600s exceeds retention window 3600s - data loss!
[INFO] Log retention configuration: retention.ms=604800000, retention.bytes=107374182400
```

**Validation Script:**
```bash
#!/bin/bash
# Validate retention configuration

TOPIC=$1
CONSUMER_LAG_MAX_HOURS=24

# Get retention settings
RETENTION_MS=$(kafka-configs.sh --describe --entity-type topics \
  --entity-name $TOPIC --bootstrap-server localhost:9092 | \
  grep retention.ms | awk -F= '{print $2}')

RETENTION_HOURS=$((RETENTION_MS / 3600000))

if [ $RETENTION_HOURS -lt $((CONSUMER_LAG_MAX_HOURS * 2)) ]; then
  echo "ERROR: Retention too aggressive! Retention ${RETENTION_HOURS}h < 2x consumer lag ${CONSUMER_LAG_MAX_HOURS}h"
  exit 1
fi

echo "OK: Retention ${RETENTION_HOURS}h provides sufficient buffer"
```

---

## 7. log.segment.bytes Impact on Compaction and Performance

### Description
The `log.segment.bytes` (default 1GB) and `segment.ms` (default 7 days) settings control when Kafka rolls to a new segment file. Segments that are too small cause excessive file creation, increasing open file descriptors, file system overhead, and CPU/IO load during compaction. Segments that are too large delay compaction (only closed segments are compacted), increase memory usage, and reduce retention granularity.

### Bad Configuration Example

```properties
# Anti-pattern 1: Segments too small - excessive file creation
log.segment.bytes=1048576  # 1MB (way too small!)
segment.ms=60000           # 1 minute

# Problems:
# - New segment every 1MB or 1 minute
# - 1000x more files than default
# - File descriptor exhaustion
# - Constant compaction overhead
# - High CPU usage for segment management
```

```properties
# Anti-pattern 2: Segments too large - delayed compaction
log.segment.bytes=10737418240  # 10GB (too large!)
segment.ms=2592000000          # 30 days

# For low-volume compacted topic (10MB/day):
# - Takes 1000 days to fill 10GB segment
# - Active segment never rolls
# - Compaction never runs
# - Duplicate keys accumulate forever
# - Disk space wasted on old data
```

```properties
# Anti-pattern 3: Segment settings don't match topic throughput
# High-volume topic (1TB/day)
log.segment.bytes=104857600  # 100MB
# Creates 10,000 segments per day!
# File system can't handle it

# Low-volume compacted topic (1MB/day)
log.segment.bytes=1073741824  # 1GB
segment.ms=604800000          # 7 days
# Segment never fills, compaction never runs
```

```java
// Anti-pattern 4: Not considering compaction requirements
kafka-topics.sh --create \
  --topic user-profiles \
  --config cleanup.policy=compact \
  --config segment.bytes=1073741824 \
  --config segment.ms=604800000 \
  --bootstrap-server localhost:9092

// Producing 10MB/day to user-profiles
// Segment takes 100 days to fill (1GB / 10MB)
// Compaction runs once every 100 days or 7 days
// Old profile versions accumulate for months!
```

### Good Configuration Example

```properties
# Right-sized segments for standard high-volume topic
log.segment.bytes=1073741824  # 1GB (default)
segment.ms=604800000          # 7 days (default)

# Fills 1GB within 7 days for typical workload
# Balanced file count and management overhead
```

```properties
# Optimized for high-throughput topic (1TB/day)
kafka-topics.sh --create \
  --topic clickstream \
  --partitions 100 \
  --config segment.bytes=2147483648 \
  --config segment.ms=86400000 \
  --config retention.ms=259200000 \
  --bootstrap-server localhost:9092

# 2GB segments
# Roll daily (even if not full)
# 3-day retention
# Manages ~150 segments per partition (1TB/day ÷ 100 partitions = 10GB/day/partition)
# 10GB/day × 3 days = 30GB per partition = 15 segments
```

```properties
# Optimized for low-volume compacted topic
kafka-topics.sh --create \
  --topic user-state \
  --partitions 10 \
  --config cleanup.policy=compact \
  --config segment.bytes=104857600 \
  --config segment.ms=3600000 \
  --config min.cleanable.dirty.ratio=0.5 \
  --config delete.retention.ms=86400000 \
  --bootstrap-server localhost:9092

# 100MB segments (10x smaller than default)
# Roll every 1 hour
# For 10MB/day topic:
#   - Segment fills in 10 days OR rolls in 1 hour (whichever first)
#   - Compaction runs every 1 hour
#   - Removes duplicate keys quickly
```

```properties
# Balanced configuration for medium-volume topic
kafka-topics.sh --create \
  --topic orders \
  --partitions 50 \
  --config segment.bytes=536870912 \
  --config segment.ms=43200000 \
  --config retention.ms=604800000 \
  --config compression.type=lz4 \
  --bootstrap-server localhost:9092

# 512MB segments
# Roll every 12 hours
# 7-day retention
# Compression reduces effective segment size
# ~28 segments per partition (7 days × 2 rolls/day)
```

```java
// Calculate optimal segment size based on throughput
public class SegmentSizeCalculator {

    public static long calculateSegmentBytes(
            long bytesPerDay,
            int partitions,
            int targetSegmentsPerDay) {

        long bytesPerPartitionPerDay = bytesPerDay / partitions;
        long segmentBytes = bytesPerPartitionPerDay / targetSegmentsPerDay;

        // Clamp to reasonable range: 100MB - 2GB
        long minSegmentBytes = 100 * 1024 * 1024L;
        long maxSegmentBytes = 2 * 1024 * 1024 * 1024L;

        return Math.max(minSegmentBytes, Math.min(maxSegmentBytes, segmentBytes));
    }

    public static long calculateSegmentMs(
            long bytesPerDay,
            int partitions,
            long segmentBytes) {

        long bytesPerPartitionPerDay = bytesPerDay / partitions;
        long daysToFillSegment = segmentBytes / bytesPerPartitionPerDay;
        long msToFillSegment = daysToFillSegment * 86400 * 1000L;

        // Segment time should be 1/4 of fill time to ensure rolling
        // Clamp to 1 hour - 7 days
        long segmentMs = msToFillSegment / 4;
        return Math.max(3600000L, Math.min(604800000L, segmentMs));
    }
}

// Example: 100GB/day, 50 partitions, want 2 rolls/day
long segmentBytes = SegmentSizeCalculator.calculateSegmentBytes(
    100L * 1024 * 1024 * 1024,  // 100GB/day
    50,                         // 50 partitions
    2                          // 2 segments/day
);
// Returns: 1073741824 (1GB)

long segmentMs = SegmentSizeCalculator.calculateSegmentMs(
    100L * 1024 * 1024 * 1024,
    50,
    segmentBytes
);
// Returns: 10800000 (3 hours)
```

```properties
# Compaction-optimized configuration with forced rolling
cleanup.policy=compact
segment.bytes=104857600           # 100MB
segment.ms=3600000                # 1 hour (force roll)
min.cleanable.dirty.ratio=0.5     # Compact when 50% old
max.compaction.lag.ms=86400000    # Force compaction within 24h
min.compaction.lag.ms=0           # Allow immediate compaction

# Broker-level compaction tuning
log.cleaner.threads=4
log.cleaner.io.max.bytes.per.second=104857600  # 100MB/s
log.cleaner.dedupe.buffer.size=134217728       # 128MB
```

### Detection Hints

**Configuration Checks:**
```bash
# Check segment configuration
kafka-topics.sh --describe --topic orders --bootstrap-server localhost:9092
# Look for: segment.bytes, segment.ms

# Check actual segment files
ls -lh /var/lib/kafka/orders-0/*.log | wc -l  # Count segments
ls -lh /var/lib/kafka/orders-0/ | grep ".log"  # List segment sizes

# Calculate average segment size
du -sh /var/lib/kafka/orders-0/*.log | awk '{sum+=$1} END {print sum/NR}'
```

**Metrics to Monitor:**
- `kafka.log:type=Log,name=NumLogSegments,topic=*,partition=*` - Segment count per partition
  - Too high (> 100): segments too small
  - Too low (< 5) with compaction: segments too large
- `kafka.log:type=Log,name=Size,topic=*,partition=*` - Total partition size
- `kafka.server:type=BrokerTopicMetrics,name=BytesInPerSec` - Throughput
- `kafka.log:type=LogCleaner,name=cleaner-recopy-percent` - Compaction efficiency
- `kafka.log:type=LogCleanerManager,name=max-dirty-percent` - Dirty log ratio
- System metrics:
  - Open file descriptors: `lsof | grep kafka | wc -l`
  - CPU usage during compaction
  - Disk I/O during segment rolling

**Alerts:**
```yaml
# Too many segments
- alert: TooManySegments
  expr: kafka_log_num_log_segments > 100
  annotations:
    summary: "Partition has {{ $value }} segments (segment.bytes likely too small)"

# Compaction lag too high
- alert: CompactionLagHigh
  expr: kafka_log_cleaner_max_compaction_delay_secs > 86400
  annotations:
    summary: "Compaction hasn't run in {{ $value }} seconds"

# File descriptor usage high
- alert: HighFileDescriptors
  expr: process_open_fds / process_max_fds > 0.8
  annotations:
    summary: "File descriptors at {{ $value }}% (too many segments)"
```

**Log Indicators:**
```
[WARN] Too many open files (current: 65000, max: 65536)
[INFO] Created log segment 00000000000012345678.log for orders-5
[WARN] Rolled log segment for orders-5 after 1 minute (segment.ms: 60000)
[ERROR] java.io.IOException: Too many open files
[INFO] Log cleaner thread 0 cleaned 50 segments in 300s
[WARN] Topic user-state partition 0: active segment 00000000000000000000.log is 30 days old
```

**Analysis Script:**
```bash
#!/bin/bash
# Analyze segment health

TOPIC=$1
DATA_DIR="/var/lib/kafka"

for partition_dir in $DATA_DIR/$TOPIC-*; do
    partition=$(basename $partition_dir)
    segment_count=$(ls $partition_dir/*.log 2>/dev/null | wc -l)
    avg_segment_size=$(du -b $partition_dir/*.log 2>/dev/null | awk '{sum+=$1; count++} END {print sum/count}')
    oldest_segment=$(ls -lt $partition_dir/*.log | tail -1 | awk '{print $6, $7, $8}')

    echo "Partition: $partition"
    echo "  Segments: $segment_count"
    echo "  Avg size: $(($avg_segment_size / 1024 / 1024)) MB"
    echo "  Oldest: $oldest_segment"

    # Warnings
    if [ $segment_count -gt 100 ]; then
        echo "  WARNING: Too many segments (segment.bytes too small)"
    fi

    if [ $segment_count -lt 5 ] && grep -q "cleanup.policy=compact" <(kafka-topics.sh --describe --topic $TOPIC 2>/dev/null); then
        echo "  WARNING: Too few segments for compacted topic (segment.bytes too large)"
    fi

    echo ""
done
```

**Tuning Guidelines:**

| Topic Throughput | Segment Bytes | Segment MS | Expected Segments/Partition/Week |
|------------------|---------------|------------|----------------------------------|
| < 10 MB/day | 100 MB | 1 hour | 7-14 |
| 10-100 MB/day | 100-500 MB | 6-12 hours | 14-28 |
| 100MB-1GB/day | 500 MB - 1 GB | 12-24 hours | 7-14 |
| 1-10 GB/day | 1-2 GB | 24 hours | 7 |
| > 10 GB/day | 2 GB | 12-24 hours | 14-28 |

---

## Summary Table

| Anti-Pattern | Primary Risk | Key Metric | Quick Fix |
|--------------|--------------|------------|-----------|
| Over-Partitioning | Performance degradation, rebalancing delays | `PartitionCount`, rebalance time | Reduce partitions for new topics |
| Under-Partitioning | Throughput bottleneck, broker overload | Consumer lag, CPU per broker | Increase partitions (cannot decrease) |
| Message Too Large | Producer errors, replication failures | `RecordTooLargeException` rate | Coordinate size limits across components |
| Compaction Misconfigured | State loss, disk waste | `cleanup.policy`, dirty ratio | Set `cleanup.policy=compact`, tune `segment.ms` |
| Wrong Partition Key | Ordering violations | Out-of-order events | Use consistent non-null keys |
| Retention Too Aggressive/Lax | Data loss or disk full | Consumer lag vs retention, disk usage | Balance retention with SLA + 2x buffer |
| Segment Size Wrong | File descriptor exhaustion or delayed compaction | `NumLogSegments`, file descriptors | Match segment size to throughput |

---

## Additional Resources

- Confluent Documentation: Topic Configuration Best Practices
- Apache Kafka Documentation: Log Configuration
- Monitoring: JMX metrics for partition health
- Tools: `kafka-topics.sh`, `kafka-consumer-groups.sh`, `kafka-log-dirs.sh`

---

## Version Notes

This document reflects Kafka best practices as of December 2025, covering Kafka 2.4+ with sticky partitioner and KRaft mode (ZooKeeper-less) support. Some behaviors differ in earlier versions:

- **Kafka < 2.4**: Null keys use round-robin instead of sticky partitioning
- **KRaft mode**: Supports higher partition counts (1000s) vs ZooKeeper mode
- **Tiered storage**: Available in recent versions for cost-effective long retention
