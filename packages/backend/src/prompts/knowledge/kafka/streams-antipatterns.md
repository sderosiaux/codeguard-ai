# Kafka Streams Anti-Patterns

This document catalogs common anti-patterns, bugs, and performance issues in Apache Kafka Streams applications, along with detection hints and remediation strategies.

---

## 1. Uncontrolled Repartitioning (Network Cost Explosion)

### Description
Repartitioning occurs when changing message keys in Kafka Streams, creating internal repartition topics. Excessive or unnecessary repartitioning causes:
- Network bandwidth explosion from data shuffling
- Cluster overload with 3x topic proliferation (original + repartition + changelog)
- Hot partitions from skewed key distribution
- Increased latency and resource consumption

### Bad Code Example
```java
// Anti-pattern: Unnecessary repartitioning with poor key selection
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Order> orders = builder.stream("orders");

// Problem 1: Rekeying by customer ID creates skewed distribution
// (some customers have many orders, others have few)
KStream<String, Order> byCustomer = orders
    .selectKey((key, order) -> order.getCustomerId());

// Problem 2: Another repartition happens here for the aggregate
KTable<String, Long> customerOrderCounts = byCustomer
    .groupByKey()  // Triggers repartition!
    .count();

// Problem 3: Yet another repartition for joining
KStream<String, Order> enriched = byCustomer
    .selectKey((key, order) -> order.getProductId())  // Another repartition!
    .join(productTable,
        (order, product) -> order.enrichWithProduct(product));
```

### Good Code Example
```java
// Best practice: Minimize repartitions and ensure uniform key distribution
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Order> orders = builder.stream("orders");

// Option 1: Co-partition upstream topics to avoid repartitions
// Ensure orders topic is already partitioned by productId in the producer

// Option 2: Combine operations to reduce repartition count
KStream<String, Order> enriched = orders
    .selectKey((key, order) -> order.getProductId())  // Single repartition
    .join(productTable,
        (order, product) -> order.enrichWithProduct(product));

// Option 3: Add key randomization for hot keys
KStream<String, Order> byCustomer = orders
    .selectKey((key, order) -> {
        String customerId = order.getCustomerId();
        // Distribute hot keys across multiple partitions
        if (isHotKey(customerId)) {
            return customerId + "-" + (order.hashCode() % 10);
        }
        return customerId;
    });
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-task-metrics,thread-id=*:records-sent-total` - High and growing
- Network bandwidth usage spikes on Kafka brokers
- High partition count on internal topics (check for `-repartition` suffix)

**Logs:**
```
WARN Created repartition topic <app-id>-KSTREAM-AGGREGATE-STATE-STORE-0000000001-repartition with X partitions
```

**Commands:**
```bash
# Check for repartition topics
kafka-topics --list --bootstrap-server localhost:9092 | grep repartition

# Monitor partition distribution
kafka-consumer-groups --describe --group <app-id> --bootstrap-server localhost:9092
```

---

## 2. State Store Size Creeping (RocksDB Unbounded Growth)

### Description
RocksDB state stores grow unbounded when:
- Not using windowed aggregations for infinite streams
- Missing TTL or compaction configuration
- Too many state stores per instance (>30)
- Not configuring shared block cache
- Using default glibc instead of jemalloc allocator

### Bad Code Example
```java
// Anti-pattern: Unbounded state store without cleanup
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Problem 1: No windowing - state grows forever
KTable<String, List<Event>> allEvents = events
    .groupByKey()
    .aggregate(
        ArrayList::new,
        (key, event, list) -> {
            list.add(event);  // Keeps growing!
            return list;
        },
        Materialized.as("events-store")  // No retention policy
    );

// Problem 2: No cache configuration
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
// Missing: cache.max.bytes.buffering
// Missing: rocksdb.config.setter

// Problem 3: Running 50+ state stores on single instance
// (repeated pattern across many aggregations without scaling)
```

### Good Code Example
```java
// Best practice: Windowed aggregations with retention and cache tuning
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Use windowing for time-bounded state
TimeWindowedKStream<String, Event> windowed = events
    .groupByKey()
    .windowedBy(TimeWindows
        .ofSizeWithNoGrace(Duration.ofHours(24))  // 24-hour window
        .advanceBy(Duration.ofHours(1)));         // 1-hour hop

KTable<Windowed<String>, Long> counts = windowed
    .count(Materialized
        .<String, Long, WindowStore<Bytes, byte[]>>as("windowed-counts")
        .withRetention(Duration.ofDays(7))  // Explicit retention
        .withCachingEnabled()
        .withLoggingEnabled(new HashMap<>()));

// Configure RocksDB properly
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
props.put(StreamsConfig.CACHE_MAX_BYTES_BUFFERING_CONFIG, 10 * 1024 * 1024); // 10 MB
props.put(StreamsConfig.ROCKSDB_CONFIG_SETTER_CLASS_CONFIG, CustomRocksDBConfig.class);

// Custom RocksDB configuration with shared cache
public class CustomRocksDBConfig implements RocksDBConfigSetter {
    private static org.rocksdb.Cache cache = new org.rocksdb.LRUCache(100 * 1024 * 1024); // 100 MB shared
    private static org.rocksdb.WriteBufferManager writeBufferManager =
        new org.rocksdb.WriteBufferManager(50 * 1024 * 1024, cache); // 50 MB shared

    @Override
    public void setConfig(String storeName, Options options, Map<String, Object> configs) {
        BlockBasedTableConfig tableConfig = new BlockBasedTableConfig();
        tableConfig.setBlockCache(cache);
        tableConfig.setCacheIndexAndFilterBlocks(true);

        options.setTableFormatConfig(tableConfig);
        options.setWriteBufferManager(writeBufferManager);
        options.setMaxWriteBufferNumber(3);
        options.setLevel0FileNumCompactionTrigger(4);

        // Enable statistics for monitoring
        options.setStatistics(new Statistics());
    }

    @Override
    public void close(String storeName, Options options) {
        // Don't close shared resources
    }
}
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-state-metrics,thread-id=*,task-id=*,<store-type>-state-id=*:size-all-mem-tables` - Growing
- Disk usage for state directories growing continuously
- Memory usage exceeding configured limits
- `rocksdb.block.cache.usage` and `rocksdb.memtable.total.size` - Monitor ratios

**Logs:**
```
ERROR Task [0_0] Commit failed java.lang.OutOfMemoryError: Java heap space
WARN State store events-store has size 15GB (exceeds recommended 10GB per store)
```

**Commands:**
```bash
# Check state store sizes
du -sh /tmp/kafka-streams/<app-id>/*/rocksdb/

# Monitor RocksDB stats (requires metrics enabled)
jconsole # Connect and check kafka.streams:type=stream-state-metrics
```

**Best Practices:**
- Keep state stores under 30 per instance
- Reserve at least 25% of available memory for RocksDB
- Use jemalloc instead of glibc on Linux
- Configure global block cache for memory bounding
- Scale horizontally rather than adding more stores per instance

---

## 3. Joins Without Proper Windows

### Description
Stream-stream joins without time windows cause:
- Unbounded state growth (storing all historical records)
- Memory exhaustion
- Incorrect join semantics (joining unrelated events)
- Missing late arrivals without grace periods

### Bad Code Example
```java
// Anti-pattern: Stream-stream join without windowing
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Order> orders = builder.stream("orders");
KStream<String, Payment> payments = builder.stream("payments");

// Problem: This syntax is not even valid - stream-stream joins REQUIRE windows!
// But attempting to use KTable unnecessarily also causes issues:
KTable<String, Order> orderTable = orders.groupByKey()
    .reduce((oldValue, newValue) -> newValue);  // Keeps all orders forever!

KTable<String, Payment> paymentTable = payments.groupByKey()
    .reduce((oldValue, newValue) -> newValue);  // Keeps all payments forever!

KTable<String, String> joined = orderTable.join(paymentTable,
    (order, payment) -> order.toString() + payment.toString());
// State grows unbounded with all historical orders and payments

// Problem 2: Grace period implicitly zero
KStream<String, OrderPayment> joined = orders.join(payments,
    (order, payment) -> new OrderPayment(order, payment),
    JoinWindows.of(Duration.ofMinutes(5)),  // No grace period!
    StreamJoined.with(Serdes.String(), orderSerde, paymentSerde));
// Late records are dropped silently
```

### Good Code Example
```java
// Best practice: Windowed joins with grace periods and retention
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Order> orders = builder.stream("orders");
KStream<String, Payment> payments = builder.stream("payments");

// Windowed join with grace period for late arrivals
KStream<String, OrderPayment> joined = orders.join(payments,
    (order, payment) -> new OrderPayment(order, payment),
    JoinWindows.ofTimeDifferenceWithNoGrace(Duration.ofMinutes(5))
        .after(Duration.ofMinutes(2))
        .before(Duration.ofMinutes(3))
        .grace(Duration.ofMinutes(1)),  // Allow 1-minute late arrivals
    StreamJoined.with(
        Serdes.String(),
        orderSerde,
        paymentSerde)
    .withStoreName("order-payment-join")
    .withRetention(Duration.ofMinutes(10)));  // Cleanup old state

// Handle non-joining records (left/outer joins)
KStream<String, OrderPayment> leftJoined = orders.leftJoin(payments,
    (order, payment) -> new OrderPayment(order, Optional.ofNullable(payment)),
    JoinWindows.ofTimeDifferenceAndGrace(Duration.ofMinutes(5), Duration.ofMinutes(1)),
    StreamJoined.with(Serdes.String(), orderSerde, paymentSerde));

// Log non-matching orders for monitoring
leftJoined
    .filter((key, value) -> !value.hasPayment())
    .to("unmatched-orders");
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-state-metrics,thread-id=*,task-id=*:size-all-mem-tables` - Growing on join state stores
- `kafka.streams:type=stream-task-metrics,thread-id=*,task-id=*:dropped-records-total` - Late records dropped

**Logs:**
```
WARN Skipping record due to expired window. key=[orderKey] topic=[orders] partition=[0] offset=[12345]
INFO Join state store 'order-payment-join-store-left' size: 5.2GB
```

**Configuration Check:**
```java
// Verify co-partitioning
if (orders.getNumPartitions() != payments.getNumPartitions()) {
    throw new RuntimeException("Topics must be co-partitioned for joins!");
}
```

---

## 4. Window Too Long (Memory Exhaustion)

### Description
Overly long windows in session or time-based aggregations cause:
- Excessive memory usage storing window state
- Slow processing and high CPU for window maintenance
- Unexpected aggregation results (joining unrelated events)
- RocksDB compaction storms

### Bad Code Example
```java
// Anti-pattern: Excessively long windows
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Problem 1: 30-day tumbling window creates huge state
KTable<Windowed<String>, Long> counts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofDays(30)))  // Too long!
    .count();

// Problem 2: Session window with very long inactivity gap
KTable<Windowed<String>, Long> sessions = events
    .groupByKey()
    .windowedBy(SessionWindows.ofInactivityGapWithNoGrace(Duration.ofHours(24)))  // Massive sessions!
    .count();

// Problem 3: Sliding window with long duration and small advance
KTable<Windowed<String>, Long> sliding = events
    .groupByKey()
    .windowedBy(SlidingWindows.ofTimeDifferenceWithNoGrace(Duration.ofDays(7))
        .advanceBy(Duration.ofMinutes(1)))  // Creates 10,080 windows per week!
    .count();
```

### Good Code Example
```java
// Best practice: Right-sized windows based on business requirements
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Use appropriate window sizes for the use case
KTable<Windowed<String>, Long> hourlyCounts = events
    .groupByKey()
    .windowedBy(TimeWindows
        .ofSizeWithNoGrace(Duration.ofHours(1))  // Reasonable 1-hour window
        .advanceBy(Duration.ofHours(1)))
    .count(Materialized
        .<String, Long, WindowStore<Bytes, byte[]>>as("hourly-counts")
        .withRetention(Duration.ofDays(7))  // Keep only 7 days
        .withCachingEnabled());

// Session windows with reasonable inactivity gap
KTable<Windowed<String>, Long> sessions = events
    .groupByKey()
    .windowedBy(SessionWindows
        .ofInactivityGapAndGrace(
            Duration.ofMinutes(30),  // 30-min inactivity
            Duration.ofMinutes(5)))  // 5-min grace
    .count(Materialized
        .<String, Long, SessionStore<Bytes, byte[]>>as("sessions")
        .withRetention(Duration.ofHours(24))
        .withCachingEnabled());

// For long-term aggregations, use two-stage approach
KTable<Windowed<String>, Long> hourlyCounts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofHours(1)))
    .count();

// Materialize hourly counts to changelog topic
hourlyCounts.toStream()
    .map((key, value) -> KeyValue.pair(key.key(), new HourlyCount(key.window(), value)))
    .to("hourly-counts-changelog");

// Second-stage aggregation for longer periods (from hourly counts)
KStream<String, HourlyCount> hourlies = builder.stream("hourly-counts-changelog");
KTable<Windowed<String>, Long> monthlyCounts = hourlies
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofDays(30)))
    .aggregate(
        () -> 0L,
        (key, hourly, agg) -> agg + hourly.count(),
        Materialized.with(Serdes.String(), Serdes.Long()));
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-state-metrics:num-open-iterators` - High values indicate window iteration overhead
- `kafka.streams:type=stream-state-metrics:memtable-flush-time-avg` - High latency
- `kafka.streams:type=stream-task-metrics:process-latency-avg` - Increasing

**Logs:**
```
WARN Window store 'counts-store' has 50000+ active windows per key
INFO RocksDB compaction took 45000ms for store 'session-store'
ERROR OutOfMemoryError in window maintenance for store 'sliding-window-store'
```

**Monitoring:**
```bash
# Check window state size
ls -lh /tmp/kafka-streams/<app-id>/*/rocksdb/<store-name>/

# Monitor RocksDB write amplification
# (many compactions indicate too many windows)
```

---

## 5. Punctuation Too Frequent (CPU Spike)

### Description
Scheduling punctuation callbacks too frequently causes:
- High CPU usage from callback invocations
- Processing delays and increased latency
- Irregular punctuation timing (jitter)
- Stream-time punctuation blocking when no records arrive

### Bad Code Example
```java
// Anti-pattern: Over-frequent punctuation with heavy operations
public class ProblematicProcessor implements Processor<String, Event> {
    private ProcessorContext context;
    private KeyValueStore<String, Aggregate> store;

    @Override
    public void init(ProcessorContext context) {
        this.context = context;
        this.store = context.getStateStore("aggregates");

        // Problem 1: Punctuation every 100ms is way too frequent
        context.schedule(
            Duration.ofMillis(100),
            PunctuationType.WALL_CLOCK_TIME,
            timestamp -> {
                // Problem 2: Heavy computation in punctuator
                KeyValueIterator<String, Aggregate> iter = store.all();
                while (iter.hasNext()) {
                    KeyValue<String, Aggregate> entry = iter.next();

                    // Expensive operations: database calls, HTTP requests
                    if (shouldFlush(entry.value)) {
                        sendToExternalSystem(entry.value);  // Blocking I/O!
                        store.delete(entry.key);
                    }
                }
                iter.close();

                // Problem 3: Forwarding many records in punctuator
                store.all().forEachRemaining(entry -> {
                    context.forward(entry.key, entry.value);
                });
            });
    }

    @Override
    public void process(String key, Event value) {
        Aggregate agg = store.get(key);
        store.put(key, updateAggregate(agg, value));
    }
}
```

### Good Code Example
```java
// Best practice: Reasonable punctuation intervals with lightweight operations
public class OptimizedProcessor implements Processor<String, Event> {
    private ProcessorContext context;
    private KeyValueStore<String, Aggregate> store;
    private final Queue<String> keysToFlush = new ConcurrentLinkedQueue<>();

    @Override
    public void init(ProcessorContext context) {
        this.context = context;
        this.store = context.getStateStore("aggregates");

        // Reasonable 10-second interval for batch operations
        context.schedule(
            Duration.ofSeconds(10),
            PunctuationType.WALL_CLOCK_TIME,
            this::punctuate);
    }

    private void punctuate(long timestamp) {
        // Lightweight operation: process queued keys only
        int processed = 0;
        int batchLimit = 100;  // Limit work per punctuation

        while (!keysToFlush.isEmpty() && processed < batchLimit) {
            String key = keysToFlush.poll();
            Aggregate agg = store.get(key);

            if (agg != null && shouldFlush(agg, timestamp)) {
                // Forward to output topic instead of blocking I/O
                context.forward(key, agg);
                store.delete(key);
            }
            processed++;
        }

        // Log if we're falling behind
        if (!keysToFlush.isEmpty()) {
            System.out.println("Punctuator backlog: " + keysToFlush.size() + " keys");
        }
    }

    @Override
    public void process(String key, Event value) {
        Aggregate agg = store.get(key);
        Aggregate updated = updateAggregate(agg, value);
        store.put(key, updated);

        // Queue key for later flush check
        if (updated.shouldScheduleFlush()) {
            keysToFlush.offer(key);
        }
    }

    // Alternative: Use STREAM_TIME for data-driven punctuation
    private void initWithStreamTime(ProcessorContext context) {
        this.context = context;
        this.store = context.getStateStore("aggregates");

        // Stream-time advances with data, better for event-time semantics
        context.schedule(
            Duration.ofMinutes(1),
            PunctuationType.STREAM_TIME,  // Advances with record timestamps
            timestamp -> {
                // Emit windowed aggregates when window closes
                long windowEnd = timestamp - Duration.ofMinutes(5).toMillis();
                store.all().forEachRemaining(entry -> {
                    if (entry.value.getTimestamp() < windowEnd) {
                        context.forward(entry.key, entry.value);
                        store.delete(entry.key);
                    }
                });
            });
    }
}

// For heavy operations, use separate thread pool
public class AsynchronousProcessor implements Processor<String, Event> {
    private final ExecutorService executor = Executors.newFixedThreadPool(2);

    @Override
    public void init(ProcessorContext context) {
        this.context = context;

        context.schedule(
            Duration.ofSeconds(30),
            PunctuationType.WALL_CLOCK_TIME,
            timestamp -> {
                // Submit heavy work to background thread
                executor.submit(() -> {
                    performExpensiveOperation();
                });
            });
    }

    @Override
    public void close() {
        executor.shutdown();
        try {
            executor.awaitTermination(30, TimeUnit.SECONDS);
        } catch (InterruptedException e) {
            executor.shutdownNow();
        }
    }
}
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-thread-metrics,thread-id=*:commit-latency-avg` - High values
- `kafka.streams:type=stream-thread-metrics:poll-latency-avg` - Increasing (punctuator blocking polls)
- CPU usage spikes at punctuation intervals
- `kafka.streams:type=stream-task-metrics:punctuate-latency-avg` - High values

**Logs:**
```
WARN Punctuator took 5000ms to execute, blocking stream processing
INFO Stream thread [thread-1] punctuate interval 100ms, actual 450ms (high jitter)
WARN Stream-time punctuation not triggered for 10 minutes (no records)
```

**Configuration Tuning:**
```java
Properties props = new Properties();
// Reduce max.poll.records to improve punctuation timing precision
props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 100);
```

---

## 6. Missing Changelog Topic Configuration

### Description
Not properly configuring changelog topics for state stores causes:
- Slow state restoration on failures/rebalances
- Excessive storage costs with default infinite retention
- Reprocessing entire topics during recovery
- Missing cleanup for old state

### Bad Code Example
```java
// Anti-pattern: State store without changelog configuration
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Problem 1: No explicit changelog configuration
KTable<String, Long> counts = events
    .groupByKey()
    .count(Materialized.as("counts-store"));  // Uses defaults!

// Problem 2: Disabling changelog (loses fault tolerance)
KTable<String, Long> volatileCounts = events
    .groupByKey()
    .count(Materialized
        .<String, Long, KeyValueStore<Bytes, byte[]>>as("volatile-store")
        .withLoggingDisabled());  // No fault tolerance!

// Problem 3: No retention on windowed changelog
KTable<Windowed<String>, Long> windowedCounts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count();  // Changelog grows forever

// Problem 4: No compaction for non-windowed state
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
// Missing: topology-specific changelog configs
```

### Good Code Example
```java
// Best practice: Explicit changelog configuration with retention and compaction
StreamsBuilder builder = new StreamsBuilder();
KStream<String, Event> events = builder.stream("events");

// Configure changelog with compaction and retention
Map<String, String> changelogConfig = new HashMap<>();
changelogConfig.put("cleanup.policy", "compact,delete");
changelogConfig.put("retention.ms", String.valueOf(Duration.ofDays(7).toMillis()));
changelogConfig.put("segment.ms", String.valueOf(Duration.ofHours(1).toMillis()));
changelogConfig.put("min.compaction.lag.ms", String.valueOf(Duration.ofHours(1).toMillis()));
changelogConfig.put("delete.retention.ms", String.valueOf(Duration.ofHours(24).toMillis()));

KTable<String, Long> counts = events
    .groupByKey()
    .count(Materialized
        .<String, Long, KeyValueStore<Bytes, byte[]>>as("counts-store")
        .withLoggingEnabled(changelogConfig)
        .withCachingEnabled()
        .withRetention(Duration.ofDays(7)));

// Windowed state with matching changelog retention
Map<String, String> windowedChangelogConfig = new HashMap<>();
windowedChangelogConfig.put("cleanup.policy", "compact,delete");
windowedChangelogConfig.put("retention.ms", String.valueOf(Duration.ofDays(1).toMillis()));
windowedChangelogConfig.put("segment.ms", String.valueOf(Duration.ofHours(1).toMillis()));

KTable<Windowed<String>, Long> windowedCounts = events
    .groupByKey()
    .windowedBy(TimeWindows.ofSizeWithNoGrace(Duration.ofMinutes(5)))
    .count(Materialized
        .<String, Long, WindowStore<Bytes, byte[]>>as("windowed-store")
        .withLoggingEnabled(windowedChangelogConfig)
        .withRetention(Duration.ofDays(1))  // Match changelog retention
        .withCachingEnabled());

// Application-level changelog defaults
Properties props = new Properties();
props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");

// Set default changelog configs (applied to all changelogs)
props.put(StreamsConfig.topicPrefix("min.insync.replicas"), "2");
props.put(StreamsConfig.topicPrefix("replication.factor"), "3");

// Configure standby replicas for faster recovery
props.put(StreamsConfig.NUM_STANDBY_REPLICAS_CONFIG, 1);

// Optimize restoration
props.put(StreamsConfig.BUFFERED_RECORDS_PER_PARTITION_CONFIG, 1000);

KafkaStreams streams = new KafkaStreams(builder.build(), props);

// Monitor restoration progress
streams.setGlobalStateRestoreListener(new StateRestoreListener() {
    @Override
    public void onRestoreStart(TopicPartition topicPartition, String storeName,
                               long startingOffset, long endingOffset) {
        long totalRecords = endingOffset - startingOffset;
        System.out.println("Restoring " + storeName + ": " + totalRecords + " records");
    }

    @Override
    public void onBatchRestored(TopicPartition topicPartition, String storeName,
                                long batchEndOffset, long numRestored) {
        System.out.println("Restored batch for " + storeName + ": " + numRestored + " records");
    }

    @Override
    public void onRestoreEnd(TopicPartition topicPartition, String storeName, long totalRestored) {
        System.out.println("Completed restoring " + storeName + ": " + totalRestored + " records");
    }
});
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-task-metrics,thread-id=*:restoration-latency-avg` - High during rebalances
- Changelog topic sizes continuously growing
- `kafka.streams:type=stream-task-metrics:restore-remaining-records` - Large numbers during startup

**Logs:**
```
INFO stream-thread [thread-1] Restoring state store counts-store from changelog
  my-app-counts-store-changelog: 50000000 records remaining
WARN Changelog topic my-app-counts-store-changelog has size 500GB with no retention
INFO State restoration took 45 minutes for store counts-store
```

**Commands:**
```bash
# Check changelog topic configurations
kafka-configs --describe --entity-type topics \
  --entity-name my-app-counts-store-changelog \
  --bootstrap-server localhost:9092

# Verify changelog topic size and retention
kafka-log-dirs --describe --bootstrap-server localhost:9092 \
  --topic-list my-app-counts-store-changelog

# Monitor restoration during startup
kafka-streams-application-reset --application-id my-app \
  --bootstrap-servers localhost:9092 \
  --dry-run
```

---

## 7. Improper Serdes Configuration

### Description
Incorrect serialization/deserialization configuration causes:
- Runtime ClassCastException errors
- SerializationException with "Unknown Magic Byte"
- Schema version mismatches
- Performance degradation from inefficient serialization
- Lost type information with generic serdes

### Bad Code Example
```java
// Anti-pattern: Missing or incorrect serdes configuration
public class ProblematicStreamsApp {
    public static void main(String[] args) {
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        // Problem 1: No default serdes configured!

        StreamsBuilder builder = new StreamsBuilder();

        // Problem 2: Assuming default serdes work for custom types
        KStream<String, Order> orders = builder.stream("orders");  // Will fail at runtime!

        // Problem 3: Mismatched serdes after transformation
        KStream<String, String> processed = orders
            .mapValues(order -> order.getCustomerId());  // Returns String

        KTable<String, Long> counts = processed
            .groupByKey()
            .count();  // Expected Long serde, but what's configured?

        // Problem 4: Using properties-based generic serdes
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG,
            Serdes.ListSerde.class);  // Can't specify inner type in properties!

        // Problem 5: Schema version mismatch
        // Producer uses schema v2, consumer expects v1
        orders.foreach((key, order) -> {
            // Missing field access throws NPE
            String newField = order.getV2OnlyField();  // Fails!
        });
    }
}
```

### Good Code Example
```java
// Best practice: Explicit serdes configuration with proper types
public class ProperStreamsApp {
    public static void main(String[] args) {
        // Configure default serdes for basic types
        Properties props = new Properties();
        props.put(StreamsConfig.APPLICATION_ID_CONFIG, "my-app");
        props.put(StreamsConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(StreamsConfig.DEFAULT_KEY_SERDE_CLASS_CONFIG, Serdes.String().getClass());
        props.put(StreamsConfig.DEFAULT_VALUE_SERDE_CLASS_CONFIG, Serdes.String().getClass());

        // Schema Registry configuration for Avro
        props.put("schema.registry.url", "http://localhost:8081");

        StreamsBuilder builder = new StreamsBuilder();

        // Explicit serdes for custom types using Avro/Protobuf
        SpecificAvroSerde<Order> orderSerde = new SpecificAvroSerde<>();
        Map<String, String> serdeConfig = new HashMap<>();
        serdeConfig.put("schema.registry.url", "http://localhost:8081");
        orderSerde.configure(serdeConfig, false);  // false = value serde

        SpecificAvroSerde<Customer> customerSerde = new SpecificAvroSerde<>();
        customerSerde.configure(serdeConfig, false);

        // Explicitly specify serdes in stream operation
        KStream<String, Order> orders = builder.stream(
            "orders",
            Consumed.with(Serdes.String(), orderSerde));

        // Specify serdes after type transformations
        KStream<String, Customer> customers = orders
            .mapValues(
                order -> lookupCustomer(order.getCustomerId()),
                Materialized.with(Serdes.String(), customerSerde));  // Explicit!

        // For aggregations, specify all serdes
        KTable<String, Long> orderCounts = orders
            .groupBy(
                (key, order) -> order.getCustomerId(),
                Grouped.with(Serdes.String(), orderSerde))
            .count(Materialized.as("order-counts-store")
                .withKeySerde(Serdes.String())
                .withValueSerde(Serdes.Long()));

        // For complex types, use proper generic serdes
        Serde<List<String>> listSerde = Serdes.ListSerde(
            ArrayList.class,
            Serdes.String());

        KTable<String, List<String>> customerOrders = orders
            .groupBy((key, order) -> order.getCustomerId())
            .aggregate(
                ArrayList::new,
                (key, order, list) -> {
                    list.add(order.getId());
                    return list;
                },
                Materialized.<String, List<String>, KeyValueStore<Bytes, byte[]>>as("customer-orders")
                    .withKeySerde(Serdes.String())
                    .withValueSerde(listSerde));

        // Schema version handling with compatibility checks
        KStream<String, Order> validatedOrders = orders
            .filter((key, order) -> {
                try {
                    // Validate schema version and required fields
                    return order.getSchema().getVersion() >= 2
                        && order.hasRequiredFields();
                } catch (Exception e) {
                    System.err.println("Invalid order schema: " + e.getMessage());
                    return false;
                }
            });

        // Dead letter queue for deserialization errors
        KStream<String, Order> ordersWithErrorHandling = builder.stream(
            "orders",
            Consumed.with(Serdes.String(), orderSerde)
                .withOffsetResetPolicy(Topology.AutoOffsetReset.EARLIEST));

        ordersWithErrorHandling
            .foreach((key, order) -> {
                try {
                    processOrder(order);
                } catch (Exception e) {
                    // Send to DLQ
                    sendToDeadLetterQueue(key, order, e);
                }
            });

        KafkaStreams streams = new KafkaStreams(builder.build(), props);

        // Set exception handler for deserialization errors
        streams.setGlobalStateRestoreListener(new LoggingStateRestoreListener());

        streams.start();
    }

    // Custom JSON serde example
    public static class JsonSerde<T> implements Serde<T> {
        private final ObjectMapper mapper = new ObjectMapper();
        private final Class<T> type;

        public JsonSerde(Class<T> type) {
            this.type = type;
        }

        @Override
        public Serializer<T> serializer() {
            return (topic, data) -> {
                try {
                    return mapper.writeValueAsBytes(data);
                } catch (JsonProcessingException e) {
                    throw new SerializationException("Error serializing JSON", e);
                }
            };
        }

        @Override
        public Deserializer<T> deserializer() {
            return (topic, data) -> {
                try {
                    return mapper.readValue(data, type);
                } catch (IOException e) {
                    throw new SerializationException("Error deserializing JSON", e);
                }
            };
        }
    }
}

// Configure deserialization exception handler globally
public class CustomDeserializationExceptionHandler
    implements DeserializationExceptionHandler {

    @Override
    public DeserializationHandlerResponse handle(
        ProcessorContext context,
        ConsumerRecord<byte[], byte[]> record,
        Exception exception) {

        System.err.println("Deserialization error for record: " +
            record.topic() + "-" + record.partition() + "-" + record.offset());
        System.err.println("Error: " + exception.getMessage());

        // Log to monitoring system
        logToMonitoring(record, exception);

        // Send to DLQ
        sendToDeadLetterQueue(record);

        // Continue processing (skip bad record)
        return DeserializationHandlerResponse.CONTINUE;
    }
}

// Use in configuration
Properties props = new Properties();
props.put(StreamsConfig.DEFAULT_DESERIALIZATION_EXCEPTION_HANDLER_CLASS_CONFIG,
    CustomDeserializationExceptionHandler.class);
```

### Detection Hints
**Metrics:**
- `kafka.streams:type=stream-metrics:deserialization-error-total` - Increasing
- `kafka.streams:type=stream-task-metrics:dropped-records-total` - Non-zero values

**Logs:**
```
ERROR Failed to deserialize value for record at offset 12345
  org.apache.kafka.common.errors.SerializationException:
  Unknown magic byte: 42

ERROR Exception caught during Deserialization, taskId: 0_0
  java.lang.ClassCastException:
  class java.lang.String cannot be cast to class Order

WARN Schema version mismatch: expected v2, got v1 for record key=order123

ERROR Error deserializing key/value for partition orders-0 at offset 5000.
  If needed, please seek past the record to continue consumption.
```

**Testing:**
```java
// Test serde compatibility
@Test
public void testSerdeRoundTrip() {
    Order order = new Order("id", "customer", 100.0);
    SpecificAvroSerde<Order> serde = new SpecificAvroSerde<>();

    byte[] serialized = serde.serializer().serialize("topic", order);
    Order deserialized = serde.deserializer().deserialize("topic", serialized);

    assertEquals(order, deserialized);
}
```

---

## Additional Best Practices

### General Monitoring and Observability

1. **Enable JMX Metrics:**
```java
Properties props = new Properties();
props.put(StreamsConfig.METRICS_RECORDING_LEVEL_CONFIG, "DEBUG");
```

2. **Key Metrics to Monitor:**
- `commit-latency-avg` - State store commit time
- `poll-latency-avg` - Consumer poll time
- `process-latency-avg` - Record processing time
- `dropped-records-total` - Data loss indicator
- `error-rate` - Processing errors
- `lag` - Consumer lag per partition

3. **Logging Configuration:**
```properties
log4j.logger.org.apache.kafka.streams=INFO
log4j.logger.org.apache.kafka.streams.processor=DEBUG
log4j.logger.org.rocksdb=WARN
```

### Capacity Planning

- **CPU**: Reserve 20-30% headroom for rebalances and catchup
- **Memory**: Reserve 25%+ for RocksDB off-heap usage
- **Disk**: 3x state store size for RocksDB compaction
- **Network**: 2x throughput for repartitioning scenarios
- **State Stores**: Keep under 30 per instance

### Testing Strategies

1. **Topology Testing:**
```java
TopologyTestDriver testDriver = new TopologyTestDriver(topology, config);
TestInputTopic<String, Order> inputTopic = testDriver.createInputTopic(
    "orders", stringSerde.serializer(), orderSerde.serializer());
TestOutputTopic<String, Long> outputTopic = testDriver.createOutputTopic(
    "counts", stringSerde.deserializer(), longSerde.deserializer());
```

2. **Load Testing**: Test with:
   - High throughput (10x normal)
   - Skewed key distribution
   - Late/out-of-order records
   - Network partitions and rebalances

3. **Failure Scenarios**:
   - Kill instances during processing
   - Corrupt state stores
   - Schema version changes
   - Broker failures

---

## Summary Checklist

When reviewing Kafka Streams code, check for:

- [ ] Minimize repartitions (co-partition input topics)
- [ ] Use windowed aggregations for time-bounded state
- [ ] Configure RocksDB with shared cache and jemalloc
- [ ] Limit state stores to <30 per instance
- [ ] Use appropriate window sizes (not too long)
- [ ] Set grace periods for joins to handle late data
- [ ] Configure changelog topics with retention and compaction
- [ ] Explicitly specify serdes for all operations
- [ ] Schedule punctuation at reasonable intervals (≥10s)
- [ ] Keep punctuator operations lightweight
- [ ] Monitor key metrics (lag, latency, errors)
- [ ] Test with realistic load and failure scenarios
- [ ] Implement dead letter queues for error handling
- [ ] Set up proper logging and observability

---

## References and Resources

This knowledge file was compiled from research on Kafka Streams best practices, common issues, and performance optimization techniques. Key areas covered include:

- Repartitioning optimization and co-partitioning strategies
- RocksDB state store memory management and configuration
- Join patterns and windowing strategies
- Punctuation scheduling and performance considerations
- Changelog topic configuration for fault tolerance
- Serialization/deserialization best practices
- Monitoring and capacity planning guidelines

For production deployments, always:
1. Test thoroughly with realistic workloads
2. Monitor key metrics continuously
3. Set up proper alerting
4. Plan for failure scenarios
5. Document topology decisions and configurations
