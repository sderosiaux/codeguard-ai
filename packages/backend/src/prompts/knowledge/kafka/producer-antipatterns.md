# Kafka Producer Anti-Patterns

This document catalogs common anti-patterns in Kafka producer implementations, providing detection strategies and remediation guidance.

---

## 1. Unsafe Acknowledgment Configuration (acks=0 or acks=1)

### Description
Using `acks=0` (fire-and-forget) or `acks=1` (leader-only acknowledgment) without understanding data loss risks. These settings prioritize throughput/latency over durability and can result in silent data loss during broker failures.

### Risks
- **acks=0**: Producer doesn't wait for any acknowledgment. If the broker goes offline or an exception occurs, messages are lost without notification.
- **acks=1**: Only the leader acknowledges. If the leader fails before followers replicate, messages are lost.
- **acks=all/-1**: Waits for all in-sync replicas, providing the strongest durability guarantee.

### Bad Code Example (Java)
```java
// ANTI-PATTERN: Fire-and-forget without acknowledgment
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.ACKS_CONFIG, "0"); // ❌ No acknowledgment - data loss risk!

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
producer.send(new ProducerRecord<>("orders", "order-123", orderData));
// No error handling, message may be lost silently
```

### Bad Code Example (Python)
```python
# ANTI-PATTERN: Leader-only ack without understanding risks
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    acks=1  # ❌ Only leader acks - data loss if leader fails!
)

# Fire and forget - no error handling
producer.send('orders', key=b'order-123', value=order_data)
```

### Good Code Example (Java)
```java
// CORRECT: Full acknowledgment with proper configuration
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.ACKS_CONFIG, "all"); // ✅ Wait for all ISR
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE); // ✅ Retry on failure
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true); // ✅ Prevent duplicates

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Async send with callback for error handling
producer.send(new ProducerRecord<>("orders", "order-123", orderData),
    (metadata, exception) -> {
        if (exception != null) {
            log.error("Failed to send message", exception);
            // Handle error appropriately (retry, DLQ, alert)
        } else {
            log.info("Message sent to partition {} with offset {}",
                metadata.partition(), metadata.offset());
        }
    });
```

### Good Code Example (Python)
```python
# CORRECT: Full acknowledgment with error handling
from kafka import KafkaProducer
from kafka.errors import KafkaError
import logging

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    acks='all',  # ✅ Wait for all ISR
    retries=5,
    enable_idempotence=True  # ✅ Prevent duplicates on retry
)

try:
    future = producer.send('orders', key=b'order-123', value=order_data)
    record_metadata = future.get(timeout=10)  # Wait for result
    logging.info(f"Sent to partition {record_metadata.partition} at offset {record_metadata.offset}")
except KafkaError as e:
    logging.error(f"Failed to send message: {e}")
    # Handle error appropriately
finally:
    producer.flush()
```

### Detection Hints
```bash
# Search for unsafe acks configuration
grep -r "acks.*=.*[\"']0[\"']" .
grep -r "acks.*=.*[\"']1[\"']" .
grep -r "ACKS_CONFIG.*0" .

# Check for missing error handling
grep -r "producer\.send" . | grep -v "callback\|get()\|future"

# Look for fire-and-forget pattern
rg "producer\.send\([^)]+\);?\s*$" --type java
```

### Broker Configuration
Ensure proper replication and ISR settings:
```properties
# On broker - ensure proper replication
min.insync.replicas=2  # At least 2 replicas must ack
default.replication.factor=3  # Create topics with 3 replicas
```

---

## 2. Missing Idempotence Configuration

### Description
Not enabling idempotent producers (`enable.idempotence=false`) allows duplicate messages when retries occur due to network issues or timeouts. Without idempotence, retries can cause the same message to be written multiple times.

### Risks
- Duplicate messages on network failures or broker timeouts
- At-least-once delivery semantics instead of exactly-once
- Downstream systems must handle deduplication logic
- Data inconsistencies in aggregations and analytics

### How Idempotence Works
When enabled, each producer gets a unique Producer ID (PID) and each message gets a monotonically increasing sequence number. Brokers track PID + sequence number per partition and reject duplicates.

### Bad Code Example (Java)
```java
// ANTI-PATTERN: Retries without idempotence = potential duplicates
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.RETRIES_CONFIG, 10); // ❌ Retries without idempotence!
props.put(ProducerConfig.ACKS_CONFIG, "all");
// enable.idempotence not set = defaults to true in Kafka 3.0+, but explicit is better

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

### Bad Code Example (Python)
```python
# ANTI-PATTERN: Retries without idempotence enabled
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    retries=5,  # ❌ Retries enabled
    acks='all',
    # enable_idempotence not set = False by default
)

# Each retry may create duplicate messages
producer.send('payments', value=payment_data)
```

### Bad Code Example (Kotlin)
```kotlin
// ANTI-PATTERN: Missing idempotence in Spring Kafka
@Configuration
class KafkaProducerConfig {
    @Bean
    fun producerFactory(): ProducerFactory<String, String> {
        val configProps = mapOf(
            ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to "localhost:9092",
            ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.RETRIES_CONFIG to 5,
            ProducerConfig.ACKS_CONFIG to "all"
            // ❌ Missing enable.idempotence = true
        )
        return DefaultKafkaProducerFactory(configProps)
    }
}
```

### Good Code Example (Java)
```java
// CORRECT: Explicit idempotence with proper configuration
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);

// ✅ Explicit idempotence configuration
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all"); // Required for idempotence
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE); // Can retry safely
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5); // ≤5 for idempotence

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Now retries won't create duplicates
producer.send(new ProducerRecord<>("payments", "txn-456", paymentData),
    (metadata, exception) -> {
        if (exception != null) {
            log.error("Send failed but will retry automatically", exception);
        }
    });
```

### Good Code Example (Python)
```python
# CORRECT: Idempotence explicitly enabled
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    enable_idempotence=True,  # ✅ Prevent duplicates
    acks='all',  # Automatically set when idempotence is enabled
    retries=5,  # Safe to retry - no duplicates
    max_in_flight_requests_per_connection=5
)

# Safe to retry - broker deduplicates automatically
future = producer.send('payments', value=payment_data)
try:
    record_metadata = future.get(timeout=10)
    print(f"Message sent without duplicates: offset {record_metadata.offset}")
except Exception as e:
    print(f"Error: {e}")
```

### Good Code Example (Kotlin)
```kotlin
// CORRECT: Spring Kafka with idempotence
@Configuration
class KafkaProducerConfig {
    @Bean
    fun producerFactory(): ProducerFactory<String, String> {
        val configProps = mapOf(
            ProducerConfig.BOOTSTRAP_SERVERS_CONFIG to "localhost:9092",
            ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG to StringSerializer::class.java,
            ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG to true, // ✅ Idempotence enabled
            ProducerConfig.ACKS_CONFIG to "all",
            ProducerConfig.RETRIES_CONFIG to Int.MAX_VALUE,
            ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION to 5
        )
        return DefaultKafkaProducerFactory(configProps)
    }

    @Bean
    fun kafkaTemplate(): KafkaTemplate<String, String> {
        return KafkaTemplate(producerFactory())
    }
}
```

### Detection Hints
```bash
# Search for missing idempotence configuration
grep -r "KafkaProducer" . | xargs grep -L "enable.idempotence\|enable_idempotence\|ENABLE_IDEMPOTENCE"

# Check for retries without idempotence
grep -r "retries" . | xargs grep -L "idempotence"

# Python: Check for retries without enable_idempotence
rg "retries\s*=" --type py | xargs rg -L "enable_idempotence"

# Java: Look for producer configs missing idempotence
rg "ProducerConfig\." --type java | rg -L "ENABLE_IDEMPOTENCE_CONFIG"
```

---

## 3. Misconfigured Batching (linger.ms and batch.size)

### Description
Improper configuration of `linger.ms` (how long to wait before sending) and `batch.size` (maximum batch size) can severely impact throughput and latency. Setting `linger.ms=0` sends messages immediately, preventing batching and reducing throughput.

### Risks
- **linger.ms=0**: No batching, each message sent immediately, high RPC overhead, poor throughput
- **batch.size too small**: Batches fill quickly but contain few messages, inefficient network usage
- **batch.size too large**: Messages wait unnecessarily, increased latency, wasted memory allocation
- **linger.ms too high**: Unnecessary delays even when batch is ready

### Performance Impact
- Default linger.ms changed from 0 to 5ms in Kafka 4.0 for better efficiency
- Proper batching can improve throughput by 5-10x with minimal latency increase
- Typical recommendation: linger.ms=5-20ms, batch.size=100KB-200KB for high throughput

### Bad Code Example (Java)
```java
// ANTI-PATTERN: No batching - sends immediately
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.LINGER_MS_CONFIG, 0); // ❌ No batching!
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 16384); // Default, but linger=0 prevents batching

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Each send triggers immediate network request - very inefficient
for (int i = 0; i < 10000; i++) {
    producer.send(new ProducerRecord<>("events", "key-" + i, "data-" + i));
}
```

### Bad Code Example (Python)
```python
# ANTI-PATTERN: Batch size too small with no linger
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    linger_ms=0,  # ❌ No waiting for batch to fill
    batch_size=1024  # ❌ Too small - only 1KB batches
)

# Poor throughput due to many small batches
for i in range(10000):
    producer.send('events', value=f'data-{i}'.encode())
```

### Good Code Example (Java)
```java
// CORRECT: Optimized batching configuration
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);

// ✅ Balanced batching for high throughput
props.put(ProducerConfig.LINGER_MS_CONFIG, 5); // Wait 5ms for more messages
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 100000); // 100KB batches
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "snappy"); // Compress for efficiency
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, 33554432); // 32MB buffer

// For ultra-high throughput scenarios
// props.put(ProducerConfig.LINGER_MS_CONFIG, 10);
// props.put(ProducerConfig.BATCH_SIZE_CONFIG, 200000); // 200KB

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Efficient batching - multiple messages per network request
for (int i = 0; i < 10000; i++) {
    producer.send(new ProducerRecord<>("events", "key-" + i, "data-" + i));
}
producer.flush(); // Ensure all batches sent
```

### Good Code Example (Python)
```python
# CORRECT: Optimized batching for throughput
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    linger_ms=5,  # ✅ Wait 5ms to batch more messages
    batch_size=100000,  # ✅ 100KB batches
    compression_type='snappy',  # ✅ Compress batches
    buffer_memory=33554432  # 32MB buffer
)

# Efficient batching - much better throughput
for i in range(10000):
    producer.send('events', value=f'data-{i}'.encode())

producer.flush()  # Ensure all batches sent
```

### Configuration Guidelines
```properties
# Low-latency use case (real-time alerts, user notifications)
linger.ms=0-1
batch.size=16384  # 16KB

# Balanced use case (most applications)
linger.ms=5-10
batch.size=32768-65536  # 32-64KB

# High-throughput use case (logs, analytics, bulk data)
linger.ms=10-20
batch.size=100000-200000  # 100-200KB
compression.type=snappy  # or lz4, zstd
```

### Detection Hints
```bash
# Find configurations with linger.ms=0
grep -r "linger\.ms.*=.*0\|linger_ms.*=.*0\|LINGER_MS_CONFIG.*0" .

# Find small batch sizes (< 32KB)
grep -r "batch\.size.*=.*[0-9]\{4,5\}\|batch_size.*=.*[0-9]\{4,5\}" .

# Check for missing compression
grep -r "KafkaProducer\|ProducerConfig" . | xargs grep -L "compression"

# Monitor batch metrics (run on producer host)
kafka-run-class kafka.tools.JmxTool \
  --object-name kafka.producer:type=producer-metrics,client-id=* \
  --attributes batch-size-avg,records-per-request-avg,record-queue-time-avg
```

---

## 4. Poor Partitioning Strategy

### Description
Ineffective partition key selection or partitioning logic leads to unbalanced partitions, hotspots, and poor scalability. Common issues include null/random keys, low-cardinality keys, and skewed key distributions.

### Risks
- **Hot partitions**: A few partitions receive disproportionate traffic
- **Unbalanced load**: Some brokers overloaded while others idle
- **Consumer lag**: Consumers processing hot partitions can't keep up
- **Reduced parallelism**: Empty partitions mean wasted consumer capacity
- **Cascading failures**: Overloaded brokers impact entire cluster

### Common Causes
- Null keys (round-robin, but no ordering guarantees)
- Low-cardinality keys (e.g., only 5 user types for 100 partitions)
- Skewed distributions (e.g., 80% of users have status="active")
- Poor key selection (e.g., timestamp as key)

### Bad Code Example (Java)
```java
// ANTI-PATTERN #1: Null key = no ordering, random partitioning
producer.send(new ProducerRecord<>("orders", null, orderData)); // ❌ Null key

// ANTI-PATTERN #2: Low cardinality key
String region = order.getRegion(); // Only 3 regions: "US", "EU", "APAC"
producer.send(new ProducerRecord<>("orders", region, orderData)); // ❌ Only 3 unique keys!

// ANTI-PATTERN #3: Skewed key distribution
String userType = user.getType(); // "premium" (5%), "standard" (95%)
producer.send(new ProducerRecord<>("events", userType, eventData)); // ❌ Hot partition!

// ANTI-PATTERN #4: Timestamp as key
String timestamp = String.valueOf(System.currentTimeMillis());
producer.send(new ProducerRecord<>("logs", timestamp, logData)); // ❌ All keys unique = no ordering
```

### Bad Code Example (Python)
```python
# ANTI-PATTERN: Random UUID as key
import uuid

# Every message has unique key = no ordering benefit
key = str(uuid.uuid4())  # ❌ Completely random
producer.send('orders', key=key.encode(), value=order_data)

# ANTI-PATTERN: Low cardinality with skew
status = user.get('status')  # 90% are 'active', 10% 'inactive'
producer.send('user-events', key=status.encode(), value=event_data)  # ❌ Hot partition
```

### Good Code Example (Java)
```java
// CORRECT: High-cardinality key with good distribution
// Use user_id or customer_id as partition key
String userId = order.getUserId(); // ✅ High cardinality, good distribution
producer.send(new ProducerRecord<>("orders", userId, orderData));

// CORRECT: Composite key for better distribution
String compositeKey = order.getUserId() + "-" + order.getRegion(); // ✅ Finer granularity
producer.send(new ProducerRecord<>("orders", compositeKey, orderData));

// CORRECT: Hash key components to increase cardinality
String hashKey = DigestUtils.md5Hex(
    order.getRegion() + "-" + order.getStoreId() + "-" + order.getUserId()
); // ✅ Well-distributed hash
producer.send(new ProducerRecord<>("orders", hashKey, orderData));

// CORRECT: Custom partitioner for specific requirements
public class BalancedPartitioner implements Partitioner {
    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        List<PartitionInfo> partitions = cluster.partitionsForTopic(topic);
        int numPartitions = partitions.size();

        if (key == null) {
            // Random for null keys
            return ThreadLocalRandom.current().nextInt(numPartitions);
        }

        // Use consistent hashing for non-null keys
        return Math.abs(key.hashCode()) % numPartitions;
    }

    @Override
    public void close() {}

    @Override
    public void configure(Map<String, ?> configs) {}
}

// Configure custom partitioner
props.put(ProducerConfig.PARTITIONER_CLASS_CONFIG, BalancedPartitioner.class);
```

### Good Code Example (Python)
```python
# CORRECT: Use entity ID with high cardinality
user_id = order['user_id']  # ✅ High cardinality, consistent routing
producer.send('orders', key=user_id.encode(), value=order_data)

# CORRECT: Composite key for better distribution
composite_key = f"{order['user_id']}-{order['store_id']}"  # ✅ Finer granularity
producer.send('orders', key=composite_key.encode(), value=order_data)

# CORRECT: Hash skewed keys for better distribution
import hashlib

def get_balanced_key(skewed_key, entity_id):
    """Combine skewed key with high-cardinality field"""
    combined = f"{skewed_key}-{entity_id}"
    return hashlib.md5(combined.encode()).hexdigest()

status = user['status']  # Skewed: 90% 'active'
user_id = user['id']     # High cardinality
balanced_key = get_balanced_key(status, user_id)  # ✅ Well distributed
producer.send('user-events', key=balanced_key.encode(), value=event_data)

# CORRECT: Custom partitioner
from kafka.partitioner.default import DefaultPartitioner

class BalancedPartitioner:
    def __call__(self, key, all_partitions, available_partitions):
        """Custom partitioning logic"""
        if key is None:
            # Random for null keys
            import random
            return random.choice(available_partitions)

        # Consistent hashing for non-null keys
        return hash(key) % len(all_partitions)

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    partitioner=BalancedPartitioner()  # ✅ Custom partitioner
)
```

### Partition Strategy Guidelines
```
Key Selection Best Practices:
1. High Cardinality: At least 20x more unique keys than partitions
2. Uniform Distribution: Keys should be evenly spread (no 80/20 splits)
3. Stable Keys: Use immutable identifiers (user_id, order_id, session_id)
4. Avoid Timestamps: Too unique, prevents ordering by entity
5. Monitor Skew: Track partition sizes and message rates

Recommended Keys by Use Case:
- User events: user_id or session_id
- Orders: customer_id or order_id
- IoT: device_id or sensor_id
- Logs: service_name + instance_id
- Financial: account_id or transaction_id
```

### Detection Hints
```bash
# Find null keys (Java)
grep -r "new ProducerRecord.*null" --include="*.java"

# Find potential low-cardinality keys
grep -r "getRegion()\|getCountry()\|getStatus()\|getType()" --include="*.java" | grep "ProducerRecord"

# Monitor partition distribution (run on broker)
kafka-topics --bootstrap-server localhost:9092 \
  --describe --topic orders

# Check partition lag distribution
kafka-consumer-groups --bootstrap-server localhost:9092 \
  --describe --group my-consumer-group

# Analyze key distribution (requires messages)
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic orders --from-beginning --property print.key=true \
  | cut -d$'\t' -f1 | sort | uniq -c | sort -rn | head -20
```

---

## 5. Synchronous Send Blocking Throughput

### Description
Using synchronous send by calling `.get()` on the Future immediately blocks the producer thread until the broker acknowledges. This "wait for each message" pattern destroys throughput, reducing it by 10-100x compared to async sends.

### Risks
- **Catastrophic throughput reduction**: 10-100x slower than async
- **Poor resource utilization**: Producer thread idle while waiting
- **Increased latency**: Each message waits for full round-trip
- **No batching benefits**: Messages sent individually, no batch efficiency
- **Scalability issues**: Cannot handle high message volumes

### When Synchronous Send Might Be Acceptable
- Critical financial transactions requiring immediate confirmation
- Ordered processing where next message depends on previous success
- Low-volume admin operations or configuration updates
- Testing and development environments

### Bad Code Example (Java)
```java
// ANTI-PATTERN: Blocking on every send
KafkaProducer<String, String> producer = new KafkaProducer<>(props);

for (Order order : orders) {
    try {
        // ❌ Blocking call - waits for each message!
        RecordMetadata metadata = producer.send(
            new ProducerRecord<>("orders", order.getId(), order.toJson())
        ).get(); // BLOCKS HERE - throughput killer!

        System.out.println("Sent to partition " + metadata.partition());
    } catch (InterruptedException | ExecutionException e) {
        e.printStackTrace();
    }
}

// Result: If broker roundtrip is 5ms, max throughput = 200 msg/sec
// Async could easily achieve 10,000-50,000 msg/sec
```

### Bad Code Example (Python)
```python
# ANTI-PATTERN: Waiting for each message
from kafka import KafkaProducer

producer = KafkaProducer(bootstrap_servers='localhost:9092')

for order in orders:
    future = producer.send('orders', key=order['id'].encode(), value=order_data)
    try:
        # ❌ Blocking call - destroys throughput!
        record_metadata = future.get(timeout=10)
        print(f"Sent to offset {record_metadata.offset}")
    except Exception as e:
        print(f"Failed: {e}")

# Result: Throughput limited by network latency
```

### Good Code Example (Java)
```java
// CORRECT: Async send with callback
KafkaProducer<String, String> producer = new KafkaProducer<>(props);
AtomicInteger successCount = new AtomicInteger(0);
AtomicInteger errorCount = new AtomicInteger(0);

// ✅ Send all messages without blocking
for (Order order : orders) {
    producer.send(
        new ProducerRecord<>("orders", order.getId(), order.toJson()),
        (metadata, exception) -> {
            if (exception != null) {
                errorCount.incrementAndGet();
                log.error("Failed to send order {}: {}", order.getId(), exception.getMessage());
                // Handle error: retry, DLQ, alert, etc.
            } else {
                successCount.incrementAndGet();
                if (successCount.get() % 1000 == 0) {
                    log.info("Sent {} messages successfully", successCount.get());
                }
            }
        }
    );
}

// Only block at the end to ensure all messages sent
producer.flush();
log.info("Completed: {} success, {} errors", successCount.get(), errorCount.get());

// Result: Can easily achieve 10,000+ msg/sec with proper batching
```

### Good Code Example (Python)
```python
# CORRECT: Async send without blocking
from kafka import KafkaProducer
from kafka.errors import KafkaError
import logging

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    linger_ms=5,  # Batch for efficiency
    batch_size=100000
)

success_count = 0
error_count = 0
futures = []

# ✅ Send all messages asynchronously
for order in orders:
    future = producer.send('orders', key=order['id'].encode(), value=order_data)

    # Optionally add callback
    def on_send_success(record_metadata):
        nonlocal success_count
        success_count += 1
        if success_count % 1000 == 0:
            logging.info(f"Sent {success_count} messages")

    def on_send_error(excp):
        nonlocal error_count
        error_count += 1
        logging.error(f"Failed to send message: {excp}")

    future.add_callback(on_send_success)
    future.add_errback(on_send_error)
    futures.append(future)

# Only block at the end to ensure completion
producer.flush()
logging.info(f"Completed: {success_count} success, {error_count} errors")

# Result: High throughput with proper batching
```

### Good Code Example (Java - Advanced Pattern)
```java
// CORRECT: Async with bounded queue for backpressure
public class AsyncProducerService {
    private final KafkaProducer<String, String> producer;
    private final ExecutorService callbackExecutor;
    private final Semaphore inflightLimit;

    public AsyncProducerService(KafkaProducer<String, String> producer, int maxInFlight) {
        this.producer = producer;
        this.callbackExecutor = Executors.newFixedThreadPool(4);
        this.inflightLimit = new Semaphore(maxInFlight); // Limit concurrent sends
    }

    public CompletableFuture<RecordMetadata> sendAsync(String topic, String key, String value) {
        CompletableFuture<RecordMetadata> future = new CompletableFuture<>();

        try {
            // ✅ Backpressure: wait if too many in-flight
            inflightLimit.acquire();

            producer.send(new ProducerRecord<>(topic, key, value), (metadata, exception) -> {
                inflightLimit.release(); // Release permit

                callbackExecutor.submit(() -> {
                    if (exception != null) {
                        future.completeExceptionally(exception);
                        handleError(key, exception);
                    } else {
                        future.complete(metadata);
                    }
                });
            });
        } catch (InterruptedException e) {
            inflightLimit.release();
            future.completeExceptionally(e);
            Thread.currentThread().interrupt();
        }

        return future;
    }

    private void handleError(String key, Exception exception) {
        log.error("Failed to send message with key {}: {}", key, exception.getMessage());
        // Error handling logic: retry, DLQ, metrics, alerts
    }

    public void shutdown() {
        producer.flush();
        producer.close();
        callbackExecutor.shutdown();
    }
}

// Usage
AsyncProducerService service = new AsyncProducerService(producer, 1000);

// ✅ High throughput with controlled backpressure
for (Order order : orders) {
    service.sendAsync("orders", order.getId(), order.toJson())
        .thenAccept(metadata -> log.debug("Sent to offset {}", metadata.offset()))
        .exceptionally(ex -> {
            log.error("Send failed", ex);
            return null;
        });
}

service.shutdown();
```

### Detection Hints
```bash
# Find synchronous send patterns (Java)
grep -r "producer\.send.*\.get()" --include="*.java"
grep -r "Future<RecordMetadata>.*\.get()" --include="*.java"

# Python: Find blocking get() calls
grep -r "future\.get(" --include="*.py"
grep -r "producer\.send.*\.get(" --include="*.py"

# Look for sends in loops without callbacks
rg "for.*\{[\s\S]*?producer\.send\([^)]+\);" --type java | grep -v "callback\|Callback"

# Check for missing async patterns
grep -r "producer\.send" --include="*.java" | grep -v "Callback\|CompletableFuture\|async"
```

### Performance Comparison
```
Scenario: Send 10,000 messages, 5ms broker latency

Synchronous (blocking .get()):
- Time: 10,000 × 5ms = 50 seconds
- Throughput: 200 msg/sec
- CPU: Low utilization (waiting)

Asynchronous (with batching):
- Time: ~2-3 seconds (batching + parallel)
- Throughput: 3,000-5,000 msg/sec
- CPU: Higher utilization (productive work)

Throughput improvement: 15-25x faster!
```

---

## 6. Retries Without Idempotence (Ordering Issues)

### Description
Enabling retries without proper configuration can cause out-of-order delivery when `max.in.flight.requests.per.connection > 1`. If idempotence is not enabled, messages can be reordered during retries.

### Risks
- **Out-of-order delivery**: Message 2 arrives before Message 1 after retry
- **Data consistency issues**: Updates applied in wrong order
- **Difficult debugging**: Race conditions and non-deterministic behavior
- **Duplicate messages**: Same message written multiple times without deduplication

### How It Happens
1. Producer sends Message 1 (fails, will retry)
2. Producer sends Message 2 (succeeds immediately)
3. Producer retries Message 1 (succeeds)
4. Result: Message 2 arrives before Message 1 (wrong order!)

### Bad Code Example (Java)
```java
// ANTI-PATTERN: Retries without idempotence + high in-flight requests
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, 10); // ❌ Retries enabled
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5); // ❌ Can reorder!
// enable.idempotence not set = false in older Kafka versions

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Order matters for these updates!
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:active"));
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:premium"));
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:suspended"));

// ❌ If middle message fails and retries, order can be: active -> suspended -> premium
// User should be suspended but shows as premium!
```

### Bad Code Example (Python)
```java
# ANTI-PATTERN: Retries without idempotence
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    acks='all',
    retries=5,  # ❌ Retries without idempotence
    max_in_flight_requests_per_connection=5  # ❌ Can reorder
    # enable_idempotence not set = False
)

# Ordered updates to account balance
producer.send('account-updates', key=b'acct-456', value=b'balance:1000')
producer.send('account-updates', key=b'acct-456', value=b'balance:1200')
producer.send('account-updates', key=b'acct-456', value=b'balance:800')

# ❌ Retry can cause wrong order, final balance could be incorrect
```

### Good Code Example (Java)
```java
// CORRECT: Idempotence ensures ordering even with retries
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);

// ✅ Idempotence preserves order with retries
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all"); // Required for idempotence
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5); // ≤5 maintains order

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Order guaranteed even with retries
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:active"));
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:premium"));
producer.send(new ProducerRecord<>("user-profile", "user-123", "status:suspended"));

// ✅ Final state: suspended (correct order maintained)
```

### Good Code Example (Java - Strict Ordering)
```java
// CORRECT: Guaranteed ordering with max.in.flight=1 (if idempotence not available)
Properties props = new Properties();
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);

// ✅ Alternative: max.in.flight=1 guarantees order (but lower throughput)
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 1);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);

// Order guaranteed, but throughput reduced
// Better to use idempotence with max.in.flight=5
```

### Good Code Example (Python)
```python
# CORRECT: Idempotence with retries
from kafka import KafkaProducer

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    enable_idempotence=True,  # ✅ Prevents duplicates and reordering
    acks='all',
    retries=5,
    max_in_flight_requests_per_connection=5  # ✅ Safe with idempotence
)

# Order guaranteed with same key
producer.send('account-updates', key=b'acct-456', value=b'balance:1000')
producer.send('account-updates', key=b'acct-456', value=b'balance:1200')
producer.send('account-updates', key=b'acct-456', value=b'balance:800')

producer.flush()
# ✅ Final balance: 800 (correct order maintained)
```

### Configuration Matrix
```
Configuration Combinations:

❌ BAD: retries > 0, max.in.flight > 1, idempotence=false
   Result: Possible reordering on retry

⚠️  OK: retries > 0, max.in.flight = 1, idempotence=false
   Result: Order guaranteed, but lower throughput

✅ GOOD: retries > 0, max.in.flight ≤ 5, idempotence=true
   Result: Order guaranteed, duplicates prevented, good throughput

✅ BEST: retries=MAX, max.in.flight=5, idempotence=true, acks=all
   Result: Exactly-once semantics with optimal throughput
```

### Detection Hints
```bash
# Find configurations with retries but no idempotence
grep -r "retries" --include="*.java" --include="*.properties" | xargs grep -L "idempotence"

# Check for high in-flight without idempotence
grep -r "MAX_IN_FLIGHT.*[5-9]\|in_flight.*[5-9]" . | xargs grep -L "idempotence"

# Look for retry config without proper ordering protection
rg "RETRIES_CONFIG|retries\s*=" --type java --type py | rg -v "idempotence|IDEMPOTENCE"

# Verify producer configurations
grep -A 20 "ProducerConfig\|KafkaProducer" . | grep -E "retries|in.flight|idempotence"
```

---

## Summary: Recommended Production Configuration

### Java - Production-Ready Producer
```java
Properties props = new Properties();

// Connection
props.put(ProducerConfig.BOOTSTRAP_SERVERS_CONFIG, "broker1:9092,broker2:9092,broker3:9092");
props.put(ProducerConfig.CLIENT_ID_CONFIG, "order-service-producer-1");

// Serialization
props.put(ProducerConfig.KEY_SERIALIZER_CLASS_CONFIG, StringSerializer.class);
props.put(ProducerConfig.VALUE_SERIALIZER_CLASS_CONFIG, StringSerializer.class);

// Reliability & Durability
props.put(ProducerConfig.ENABLE_IDEMPOTENCE_CONFIG, true);
props.put(ProducerConfig.ACKS_CONFIG, "all");
props.put(ProducerConfig.RETRIES_CONFIG, Integer.MAX_VALUE);
props.put(ProducerConfig.MAX_IN_FLIGHT_REQUESTS_PER_CONNECTION, 5);

// Performance & Throughput
props.put(ProducerConfig.LINGER_MS_CONFIG, 5);
props.put(ProducerConfig.BATCH_SIZE_CONFIG, 100000);
props.put(ProducerConfig.COMPRESSION_TYPE_CONFIG, "snappy");
props.put(ProducerConfig.BUFFER_MEMORY_CONFIG, 33554432);

// Timeouts
props.put(ProducerConfig.REQUEST_TIMEOUT_MS_CONFIG, 30000);
props.put(ProducerConfig.DELIVERY_TIMEOUT_MS_CONFIG, 120000);

KafkaProducer<String, String> producer = new KafkaProducer<>(props);
```

### Python - Production-Ready Producer
```python
from kafka import KafkaProducer

producer = KafkaProducer(
    # Connection
    bootstrap_servers=['broker1:9092', 'broker2:9092', 'broker3:9092'],
    client_id='order-service-producer-1',

    # Serialization
    key_serializer=str.encode,
    value_serializer=str.encode,

    # Reliability & Durability
    enable_idempotence=True,
    acks='all',
    retries=5,
    max_in_flight_requests_per_connection=5,

    # Performance & Throughput
    linger_ms=5,
    batch_size=100000,
    compression_type='snappy',
    buffer_memory=33554432,

    # Timeouts
    request_timeout_ms=30000,
)
```

### Key Takeaways

1. **Always enable idempotence** in production to prevent duplicates
2. **Use acks=all** for critical data to prevent data loss
3. **Configure proper batching** (linger.ms=5-20ms, batch.size=100KB+) for throughput
4. **Choose partition keys wisely** with high cardinality and uniform distribution
5. **Use async send with callbacks** instead of blocking .get()
6. **Enable retries** with idempotence to handle transient failures
7. **Monitor producer metrics** regularly for performance and errors

---

## Detection Script

```bash
#!/bin/bash
# kafka-producer-antipattern-scanner.sh
# Scans codebase for Kafka producer anti-patterns

echo "=== Kafka Producer Anti-Pattern Scanner ==="
echo ""

echo "1. Checking for unsafe acks configuration..."
grep -rn "acks.*=.*[\"']0[\"']\|acks.*=.*[\"']1[\"']" . --include="*.java" --include="*.py" --include="*.properties" 2>/dev/null

echo ""
echo "2. Checking for missing idempotence..."
grep -rn "KafkaProducer\|ProducerConfig" . --include="*.java" --include="*.py" | grep -v "idempotence" 2>/dev/null | head -20

echo ""
echo "3. Checking for synchronous send (blocking .get())..."
grep -rn "producer\.send.*\.get()" . --include="*.java" --include="*.py" 2>/dev/null

echo ""
echo "4. Checking for linger.ms=0 (no batching)..."
grep -rn "linger\.ms.*=.*0\|linger_ms.*=.*0" . --include="*.java" --include="*.py" --include="*.properties" 2>/dev/null

echo ""
echo "5. Checking for null partition keys..."
grep -rn "new ProducerRecord.*null" . --include="*.java" 2>/dev/null
grep -rn "producer\.send.*key=None" . --include="*.py" 2>/dev/null

echo ""
echo "6. Checking for retries without idempotence..."
grep -rn "retries" . --include="*.java" --include="*.py" --include="*.properties" | xargs grep -L "idempotence" 2>/dev/null | head -20

echo ""
echo "=== Scan complete ==="
```

---

## References

- [Kafka Producer Acknowledgments (acks)](https://activewizards.com/blog/kafka-producer-and-consumer-best-practices)
- [Understanding Kafka Producer Retries](https://reintech.io/blog/kafka-producer-retries-message-delivery-semantics)
- [Idempotent Producer Documentation](https://cwiki.apache.org/confluence/display/KAFKA/Idempotent+Producer)
- [Kafka Producer Performance Tuning](https://strimzi.io/blog/2020/10/15/producer-tuning/)
- [Synchronous vs Asynchronous Publishing](https://medium.com/naukri-engineering/publishing-to-kafka-synchronous-vs-asynchronous-bf49c4e1af25)
- [Kafka Partition Strategy](https://www.confluent.io/learn/kafka-partition-strategy/)
- [Handling Hot Partitions](https://medium.com/@natesh.somanna/handling-hot-partitions-in-kafka-c7b41b36c929)
- [Apache Kafka Anti-Patterns](https://www.instaclustr.com/blog/apache-kafka-anti-patterns/)
