# Kafka Connect Anti-Patterns

This document catalogs common anti-patterns, misconfigurations, and performance pitfalls when using Kafka Connect. Each anti-pattern includes detection hints, bad/good configuration examples, and mitigation strategies.

## Table of Contents

1. [Single Task JDBC Bottleneck](#1-single-task-jdbc-bottleneck)
2. [Missing Error Tolerance and Dead Letter Queue](#2-missing-error-tolerance-and-dead-letter-queue)
3. [SMT Overuse for Complex Transformations](#3-smt-overuse-for-complex-transformations)
4. [Offset Storage Misconfiguration](#4-offset-storage-misconfiguration)
5. [Connector Task Imbalance](#5-connector-task-imbalance)
6. [Converter Serialization Mistakes](#6-converter-serialization-mistakes)
7. [Inadequate Batch and Buffer Configuration](#7-inadequate-batch-and-buffer-configuration)
8. [No DLQ Monitoring and Processing Strategy](#8-no-dlq-monitoring-and-processing-strategy)

---

## 1. Single Task JDBC Bottleneck

### Description
The JDBC Source Connector architecture fundamentally limits parallelism: **one task per table maximum**, regardless of `tasks.max` configuration. This creates a throughput bottleneck for high-volume data sources, as a single task cannot saturate available network and processing capacity.

Even setting `tasks.max=10` will only run one task per table. In query mode, the connector supports running only one task total, making it unsuitable for high-throughput scenarios requiring parallel data extraction.

### Bad Configuration

```json
{
  "name": "jdbc-source-high-volume",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/mydb",
    "table.whitelist": "orders",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "tasks.max": "6",
    "batch.max.rows": "100",
    "poll.interval.ms": "5000"
  }
}
```

**Problems:**
- `tasks.max=6` is misleading - only 1 task will run
- Small `batch.max.rows=100` limits throughput
- Default producer batch size (16384 bytes) underutilized

### Good Configuration

```json
{
  "name": "jdbc-source-optimized",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/mydb",
    "table.whitelist": "orders",
    "mode": "incrementing",
    "incrementing.column.name": "id",
    "tasks.max": "1",
    "batch.max.rows": "10000",
    "poll.interval.ms": "1000",
    "producer.override.batch.size": "100000",
    "producer.override.linger.ms": "100",
    "producer.override.compression.type": "snappy"
  }
}
```

**Improvements:**
- Honest `tasks.max=1` reflecting reality
- Increased `batch.max.rows=10000` for higher throughput
- Producer batch size ~2x the batch.max.rows
- Compression and batching optimizations

### Alternative Solutions

For true parallelism when reading from a single large table:

1. **Multiple connectors with partitioned queries**: Create separate connectors with `query` mode and partition logic (e.g., WHERE id % 4 = 0, WHERE id % 4 = 1, etc.)
2. **Use Apache Spark or Sqoop**: These tools support parallel JDBC reads
3. **Change Data Capture (CDC)**: Use Debezium instead of JDBC polling for real-time streaming

### Detection Hints

```
# Check connector status - look for single task despite high tasks.max
curl -s http://localhost:8083/connectors/jdbc-source/status | jq '.tasks | length'

# Monitor lag and throughput
# If throughput plateaus despite increasing tasks.max, you've hit the single-task limit

# Check worker thread utilization - single task means CPU underutilization
```

**Code Patterns to Flag:**
- JDBC connectors with `tasks.max > 1` expecting parallel table reads
- High-volume JDBC sources without producer.override configurations
- JDBC `batch.max.rows` < 1000 for large tables

---

## 2. Missing Error Tolerance and Dead Letter Queue

### Description
Without error handling configuration, Kafka Connect fails fast on any error, stopping the entire connector. For sink connectors processing millions of records, a single malformed message causes total pipeline failure. **Source connectors do not support DLQ** - only sink connectors have this capability.

Common causes of failures:
- Schema evolution mismatches
- Data type conversion errors
- Constraint violations in target systems
- Transient network issues

### Bad Configuration

```json
{
  "name": "jdbc-sink-brittle",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/warehouse",
    "topics": "orders,customers,products",
    "auto.create": "true",
    "insert.mode": "insert"
  }
}
```

**Problems:**
- No error tolerance - first error stops connector
- No retry logic
- No DLQ for failed records
- No error logging

### Good Configuration

```json
{
  "name": "jdbc-sink-resilient",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/warehouse",
    "topics": "orders,customers,products",
    "auto.create": "true",
    "insert.mode": "insert",

    "errors.tolerance": "all",
    "errors.log.enable": "true",
    "errors.log.include.messages": "true",

    "errors.retry.timeout": "600000",
    "errors.retry.delay.max.ms": "30000",

    "errors.deadletterqueue.topic.name": "dlq-jdbc-sink",
    "errors.deadletterqueue.topic.replication.factor": "3",
    "errors.deadletterqueue.context.headers.enable": "true"
  }
}
```

**Improvements:**
- `errors.tolerance=all` allows connector to continue despite errors
- Retry up to 10 minutes with exponential backoff (max 30 seconds between retries)
- DLQ captures failed records with context headers (exception, topic, partition, offset)
- Error logging for debugging
- Proper DLQ replication for durability

### DLQ Processing Strategy

**Critical:** Never enable DLQ without a processing plan. Options:

1. **Automated Replay After Fix**
```bash
# Consumer reads DLQ, fixes data, republishes to original topic
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic dlq-jdbc-sink \
  --from-beginning \
  --property print.headers=true
```

2. **Manual Review Dashboard**
- Build UI to display failed records
- Allow operators to manually correct and retry
- Track resolution metrics

3. **Alert-Based Intervention**
```json
# Monitoring alert when DLQ size > threshold
{
  "alert": "DLQ threshold exceeded",
  "query": "kafka.topic.messages{topic:dlq-jdbc-sink} > 1000",
  "action": "page oncall engineer"
}
```

### Detection Hints

```bash
# Check for connectors without error handling
curl -s http://localhost:8083/connectors/jdbc-sink/config | \
  jq 'select(.["errors.tolerance"] == null)'

# Monitor connector failures
curl -s http://localhost:8083/connectors/jdbc-sink/status | \
  jq '.tasks[] | select(.state == "FAILED")'
```

**Code Patterns to Flag:**
- Sink connectors without `errors.tolerance` configuration
- Production connectors without DLQ topic
- No monitoring on DLQ topic size
- DLQ without documented processing procedure

---

## 3. SMT Overuse for Complex Transformations

### Description
Single Message Transforms (SMTs) are lightweight, stateless transformations applied to individual records. They are **not** a stream processing framework. Using SMTs for complex logic causes performance degradation and maintenance nightmares.

**SMTs Cannot:**
- Join streams or lookup external data sources
- Perform aggregations or windowed operations
- Split one message into multiple messages
- Maintain state across messages
- Access other Kafka topics

**When SMT becomes an anti-pattern:**
- More than 3-4 chained transforms
- External API calls or database lookups
- Complex conditional logic across multiple fields
- Performance-critical transformations

### Bad Configuration

```json
{
  "name": "over-engineered-smt",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "topics": "user-events",
    "transforms": "addMetadata,lookupUser,enrichLocation,calculateScore,filterInactive,maskPII,routeByRegion",

    "transforms.lookupUser.type": "com.example.DatabaseLookupSMT",
    "transforms.lookupUser.jdbc.url": "jdbc:mysql://userdb:3306/users",
    "transforms.lookupUser.cache.ttl": "300",

    "transforms.enrichLocation.type": "com.example.GeoIPLookupSMT",
    "transforms.enrichLocation.api.url": "https://api.geoip.com",
    "transforms.enrichLocation.timeout": "1000",

    "transforms.calculateScore.type": "com.example.ComplexAggregationSMT",
    "transforms.calculateScore.window.size": "3600000"
  }
}
```

**Problems:**
- Database lookup in transform blocks connector thread
- External API calls add latency and failure points
- Aggregation logic doesn't belong in SMT
- Chain of 7 transforms is unreadable and slow
- Each message pays cumulative transformation cost

### Good Configuration

**Option 1: Use Stream Processing (Preferred)**

```java
// Kafka Streams application
StreamsBuilder builder = new StreamsBuilder();
KStream<String, UserEvent> events = builder.stream("user-events");

KTable<String, User> users = builder.table("users-table");
KTable<String, GeoData> geoData = builder.table("geo-data");

events
  .selectKey((k, v) -> v.getUserId())
  .join(users, (event, user) -> enrichWithUser(event, user))
  .join(geoData, (event, geo) -> enrichWithLocation(event, geo))
  .filter((k, v) -> v.isActive())
  .mapValues(v -> maskPII(v))
  .to("enriched-user-events");
```

**Option 2: Minimal SMT for Simple Tasks**

```json
{
  "name": "simple-smt",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "topics": "user-events",
    "transforms": "addTimestamp,maskEmail",

    "transforms.addTimestamp.type": "org.apache.kafka.connect.transforms.InsertField$Value",
    "transforms.addTimestamp.timestamp.field": "processingTime",

    "transforms.maskEmail.type": "org.apache.kafka.connect.transforms.MaskField$Value",
    "transforms.maskEmail.fields": "email",
    "transforms.maskEmail.replacement": "***REDACTED***"
  }
}
```

### Appropriate SMT Use Cases

✅ **Good SMT Uses:**
- Adding metadata fields (timestamp, source, version)
- Simple field renaming or removal
- Routing messages based on field value
- Basic string manipulation (uppercase, trim)
- Flattening nested structures
- Masking PII fields

❌ **Bad SMT Uses:**
- Database lookups or external API calls
- Aggregations, joins, or windowed operations
- Complex business logic with multiple conditionals
- Stateful transformations requiring memory
- Operations that need access to multiple messages
- CPU-intensive operations (complex regex, encryption)

### Detection Hints

```bash
# Count SMT chains per connector
curl -s http://localhost:8083/connectors/my-connector/config | \
  jq '[.transforms | split(",") | length]'

# Look for custom SMTs with suspicious names
jq '.transforms[].type | select(contains("Lookup") or contains("Enrich") or contains("Aggregate"))'
```

**Code Patterns to Flag:**
- More than 4 transforms in `transforms` chain
- Custom SMT classes with JDBC/HTTP clients
- SMT configuration with `cache`, `api.url`, `jdbc.url` properties
- Comments like "TODO: move to Kafka Streams" in SMT code
- SMTs with `Thread.sleep()` or blocking I/O

---

## 4. Offset Storage Misconfiguration

### Description
Kafka Connect stores source connector offsets in an internal topic (`offset.storage.topic`). Misconfigurations lead to data loss, duplication, or connector startup failures. The offset topic requires specific settings that differ from regular Kafka topics.

**Critical Requirements:**
- Must use `cleanup.policy=compact` (not delete)
- Replication factor ≥3 for production
- Cannot be shared between Connect clusters
- Partition count should support cluster scale (25-50 partitions recommended)

### Bad Configuration

**Worker Configuration (`connect-distributed.properties`):**

```properties
# WRONG: Using default topic settings
offset.storage.topic=connect-offsets
offset.storage.replication.factor=1
offset.storage.partitions=1

# WRONG: Sharing topics between clusters
group.id=connect-cluster
config.storage.topic=connect-configs
status.storage.topic=connect-status
```

**Problems:**
- Single replica = data loss on broker failure
- Single partition = bottleneck for large clusters
- Auto-created topics may get wrong cleanup.policy
- Shared topics between clusters cause conflicts
- No explicit cleanup policy enforcement

### Good Configuration

**Worker Configuration:**

```properties
# Unique group ID per Connect cluster
group.id=connect-cluster-prod-1

# Offset storage with proper settings
offset.storage.topic=connect-cluster-prod-1-offsets
offset.storage.replication.factor=3
offset.storage.partitions=25
offset.storage.cleanup.policy=compact

# Config storage
config.storage.topic=connect-cluster-prod-1-configs
config.storage.replication.factor=3

# Status storage
status.storage.topic=connect-cluster-prod-1-status
status.storage.replication.factor=3
status.storage.partitions=10

# Prevent auto-topic creation issues
auto.create.topics.enable=false
```

**Pre-create Topics with Correct Settings:**

```bash
# Create offset storage topic
kafka-topics --bootstrap-server localhost:9092 --create \
  --topic connect-cluster-prod-1-offsets \
  --partitions 25 \
  --replication-factor 3 \
  --config cleanup.policy=compact \
  --config min.insync.replicas=2 \
  --config unclean.leader.election.enable=false

# Create config storage topic
kafka-topics --bootstrap-server localhost:9092 --create \
  --topic connect-cluster-prod-1-configs \
  --partitions 1 \
  --replication-factor 3 \
  --config cleanup.policy=compact

# Create status storage topic
kafka-topics --bootstrap-server localhost:9092 --create \
  --topic connect-cluster-prod-1-status \
  --partitions 10 \
  --replication-factor 3 \
  --config cleanup.policy=compact
```

### Offset Management Anti-Patterns

**1. Modifying Offsets with Running Cluster**

```bash
# WRONG: Editing offsets while workers are running
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic connect-offsets \
  --from-beginning
# Manually editing and producing back... while cluster is up
```

**Correct Approach:**

```bash
# 1. Stop ALL Connect workers in cluster
systemctl stop kafka-connect

# 2. Reset connector offsets using REST API (Connect 3.6+)
curl -X DELETE http://localhost:8083/connectors/jdbc-source/offsets

# 3. Or manually edit offset topic
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic connect-offsets --from-beginning --property print.key=true

# 4. Restart workers
systemctl start kafka-connect
```

**2. Connector Name Changes Without Offset Migration**

```bash
# WRONG: Renaming connector loses offset history
curl -X PUT http://localhost:8083/connectors/jdbc-source-old/config \
  -H "Content-Type: application/json" \
  -d '{"name": "jdbc-source-new", ...}'
```

**Correct: Keep same name or migrate offsets:**

```bash
# If rename is necessary, use same offset storage topic
# AND keep connector name in offset keys consistent
# Better: just keep the original connector name
```

### Detection Hints

```bash
# Check offset topic configuration
kafka-topics --bootstrap-server localhost:9092 \
  --describe --topic connect-offsets

# Should show:
# cleanup.policy=compact
# replication.factor >= 3

# Check for shared topics (same topic name in multiple clusters)
# This requires infrastructure-level monitoring

# Check offset topic health
kafka-consumer-groups --bootstrap-server localhost:9092 --list | \
  grep connect

# Verify no replication issues
kafka-topics --bootstrap-server localhost:9092 \
  --describe --under-replicated-partitions
```

**Code Patterns to Flag:**
- `offset.storage.replication.factor=1` in production
- `offset.storage.partitions=1` in clusters with >10 connectors
- Missing explicit `cleanup.policy=compact` configuration
- Identical `group.id` or topic names across multiple clusters
- Comments about "offset issues" or "reprocessing all data"

---

## 5. Connector Task Imbalance

### Description
Kafka Connect distributes connector tasks across workers using round-robin assignment. However, this naive strategy doesn't account for actual workload, leading to resource imbalance where some workers are overloaded while others sit idle.

**Causes of Imbalance:**
- Different connectors have vastly different throughput
- Some tasks process high-volume topics, others low-volume
- Worker joins/leaves trigger rebalance but don't optimize distribution
- `tasks.max` settings don't match actual parallelism opportunities

### Bad Configuration

**Cluster Setup:**

```json
// 3 workers, but connectors create uneven load
// Worker 1: Heavy JDBC connector (100K msgs/sec) + 2 small connectors
// Worker 2: S3 sink (1K msgs/sec)
// Worker 3: Elasticsearch sink (50K msgs/sec)

{
  "connectors": [
    {
      "name": "jdbc-heavy",
      "config": {
        "tasks.max": "4"  // All 4 tasks might land on same worker
      }
    },
    {
      "name": "s3-light",
      "config": {
        "tasks.max": "1"
      }
    },
    {
      "name": "elastic-medium",
      "config": {
        "tasks.max": "2"
      }
    }
  ]
}
```

**Problems:**
- No task distribution guarantees
- Round-robin doesn't consider task weight
- Worker CPU/memory imbalance
- Some workers become bottlenecks

### Good Configuration

**Explicit Task Distribution Strategy:**

```json
// Distribute based on workload understanding

// Cluster: 6 workers

{
  "connectors": [
    {
      "name": "jdbc-heavy-1",
      "config": {
        "tasks.max": "6",  // Spread across all 6 workers
        "table.whitelist": "large_table_1"
      }
    },
    {
      "name": "jdbc-heavy-2",
      "config": {
        "tasks.max": "6",
        "table.whitelist": "large_table_2"
      }
    },
    {
      "name": "s3-light",
      "config": {
        "tasks.max": "2",  // Low volume, fewer tasks
        "topics": "low-volume-topic"
      }
    },
    {
      "name": "elastic-medium",
      "config": {
        "tasks.max": "4",
        "topics.regex": "events-.*"
      }
    }
  ]
}
```

**Configuration Guidelines:**
- Total tasks ≈ 2-4x number of workers for good distribution
- High-volume connectors: `tasks.max` = number of workers
- Low-volume connectors: `tasks.max` = 1 or 2
- Monitor and adjust based on actual CPU/memory usage

### Advanced: Incremental Cooperative Rebalancing

```properties
# Worker configuration
# Reduces rebalance impact by incrementally moving tasks
connect.protocol=compatible
scheduled.rebalance.max.delay.ms=300000  # 5 minutes tolerance

# Allows transient worker failures without immediate rebalance
```

### Monitoring and Detection

**Metrics to Track:**

```bash
# Worker-level CPU/memory utilization
# Should be relatively balanced across workers

# Per-worker task counts
curl -s http://worker1:8083/connectors | jq '. | length'
curl -s http://worker2:8083/connectors | jq '. | length'
curl -s http://worker3:8083/connectors | jq '. | length'

# Task lag by worker
# High lag on some workers indicates imbalance
```

**Prometheus Queries:**

```promql
# Task count per worker
sum by (worker_id) (kafka_connect_connector_task_status)

# CPU usage per worker (should be similar)
avg by (instance) (rate(process_cpu_seconds_total[5m]))

# Tasks in FAILED state per worker
sum by (worker_id) (kafka_connect_connector_task_status{state="FAILED"})
```

### Rebalancing Best Practices

1. **Add Workers During Low Traffic**
```bash
# Planned scaling - add workers during off-peak hours
# Rebalance causes brief task interruption
```

2. **Graceful Worker Shutdown**
```bash
# Use SIGTERM, not SIGKILL
# Allows orderly task handoff
systemctl stop kafka-connect  # Sends SIGTERM
```

3. **Monitor Rebalance Duration**
```promql
# Rebalance should complete in seconds, not minutes
kafka_connect_rebalance_duration_seconds
```

### Detection Hints

**Code Patterns to Flag:**
- All connectors using same `tasks.max` value (copy-paste config)
- `tasks.max > number_of_workers * 4` (over-provisioning tasks)
- No monitoring of per-worker resource usage
- Worker additions without rebalance monitoring
- Cluster with <2 tasks per worker (under-utilized)

---

## 6. Converter Serialization Mistakes

### Description
Kafka Connect uses **converters** to serialize data between Kafka's byte format and Connect's internal representation. Misconfiguring converters causes serialization errors, data corruption, or pipeline failures. The three main converters are:

1. **JsonConverter** - JSON with embedded schema
2. **AvroConverter** - Avro binary with Schema Registry
3. **StringConverter** - Raw strings, no schema

**Most Common Mistakes:**
- Wrong converter for data format in topic
- Missing Schema Registry URL for Avro
- Incorrect key vs. value converter configuration
- Missing converter property prefixes

### Bad Configuration

```json
{
  "name": "sink-converter-mismatch",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "topics": "users",

    // WRONG: Trying to use JsonConverter for Avro-encoded data
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",

    // WRONG: Missing required property prefix
    "schema.registry.url": "http://localhost:8081",

    // WRONG: Key and value need separate converters
    "converter": "io.confluent.connect.avro.AvroConverter"
  }
}
```

**Problems:**
- `value.converter` expects JSON but topic contains Avro bytes → deserialization error
- `schema.registry.url` missing required prefix `value.converter.` → property ignored
- `converter` is not valid; must specify `key.converter` and `value.converter` separately

### Good Configuration

**Scenario 1: Avro with Schema Registry**

```json
{
  "name": "sink-avro-correct",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "topics": "users",

    "key.converter": "io.confluent.connect.avro.AvroConverter",
    "key.converter.schema.registry.url": "http://localhost:8081",
    "key.converter.auto.register.schemas": "false",

    "value.converter": "io.confluent.connect.avro.AvroConverter",
    "value.converter.schema.registry.url": "http://localhost:8081",
    "value.converter.auto.register.schemas": "false",
    "value.converter.use.latest.version": "true"
  }
}
```

**Scenario 2: JSON with Schema**

```json
{
  "name": "sink-json-with-schema",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "topics": "events",

    "key.converter": "org.apache.kafka.connect.storage.StringConverter",

    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "true"
  }
}
```

**Scenario 3: JSON without Schema (Plain JSON)**

```json
{
  "name": "sink-json-schemaless",
  "config": {
    "connector.class": "io.confluent.connect.s3.S3SinkConnector",
    "topics": "logs",

    "key.converter": "org.apache.kafka.connect.storage.StringConverter",

    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false"
  }
}
```

### Worker-Level vs. Connector-Level Configuration

**Worker Configuration (`connect-distributed.properties`):**

```properties
# DEFAULT converters for all connectors
key.converter=io.confluent.connect.avro.AvroConverter
key.converter.schema.registry.url=http://localhost:8081

value.converter=io.confluent.connect.avro.AvroConverter
value.converter.schema.registry.url=http://localhost:8081

# Internal converters (for Connect's internal topics)
internal.key.converter=org.apache.kafka.connect.json.JsonConverter
internal.value.converter=org.apache.kafka.connect.json.JsonConverter
internal.key.converter.schemas.enable=false
internal.value.converter.schemas.enable=false
```

**Connector-Level Overrides:**

```json
// Override worker defaults for specific connector
{
  "name": "special-connector",
  "config": {
    // This connector reads plain JSON, not Avro
    "value.converter": "org.apache.kafka.connect.json.JsonConverter",
    "value.converter.schemas.enable": "false"
    // Overrides worker's default AvroConverter
  }
}
```

### Common Converter Patterns

| Data Format | Key Converter | Value Converter | Schema Registry Required? |
|-------------|---------------|-----------------|---------------------------|
| Avro binary | AvroConverter | AvroConverter | Yes |
| JSON with schema | StringConverter | JsonConverter (schemas.enable=true) | No |
| Plain JSON | StringConverter | JsonConverter (schemas.enable=false) | No |
| String keys, Avro values | StringConverter | AvroConverter | Yes (for values) |
| Protobuf | ProtobufConverter | ProtobufConverter | Yes |
| Raw bytes | ByteArrayConverter | ByteArrayConverter | No |

### Detection Hints

```bash
# Check for serialization errors in logs
grep "SerializationException\|Failed to deserialize" connect.log

# Verify Schema Registry connectivity
curl http://localhost:8081/subjects

# Test converter configuration
curl -s http://localhost:8083/connectors/my-connector/config | \
  jq '.["value.converter"], .["value.converter.schema.registry.url"]'

# Look for connectors using worker defaults (no converter override)
curl -s http://localhost:8083/connectors/my-connector/config | \
  jq 'select(.["value.converter"] == null)'
```

**Code Patterns to Flag:**
- Connector config with `schema.registry.url` missing converter prefix
- `converter` property (should be `key.converter` and `value.converter`)
- AvroConverter without Schema Registry URL
- JsonConverter with `schemas.enable=true` but no schema in data
- Using same converter for keys and values when they have different formats
- Worker defaults not set (relying on Connect's defaults)

---

## 7. Inadequate Batch and Buffer Configuration

### Description
Kafka Connect's default batch and buffer sizes are conservative, optimized for correctness over performance. For high-throughput scenarios, these defaults become bottlenecks. Proper tuning of batch sizes, buffer memory, and flush intervals can increase throughput by 10-50x.

**Key Configuration Areas:**
1. Connector batch size (`batch.max.rows`, `batch.size`)
2. Producer buffering (`producer.override.*`)
3. Consumer fetch settings (`consumer.override.*`)
4. Flush and commit intervals

### Bad Configuration

```json
{
  "name": "high-volume-undertuned",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/warehouse",
    "table.whitelist": "transactions",
    "mode": "incrementing",
    "incrementing.column.name": "id",

    // USING ALL DEFAULTS - SLOW!
    // batch.max.rows defaults to 100
    // poll.interval.ms defaults to 5000
    // producer defaults: batch.size=16384, linger.ms=0
  }
}
```

**Performance Impact:**
- Fetches only 100 rows every 5 seconds = 20 rows/sec
- Producer sends immediately (linger.ms=0) = many small batches
- Default producer batch.size (16KB) fills quickly, forcing frequent sends
- Network roundtrips dominate processing time

### Good Configuration

**High-Throughput JDBC Source:**

```json
{
  "name": "high-volume-optimized",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSourceConnector",
    "connection.url": "jdbc:postgresql://localhost:5432/warehouse",
    "table.whitelist": "transactions",
    "mode": "incrementing",
    "incrementing.column.name": "id",

    // Connector-level batching
    "batch.max.rows": "10000",
    "poll.interval.ms": "1000",

    // Producer optimizations
    "producer.override.batch.size": "262144",        // 256KB (16x default)
    "producer.override.linger.ms": "100",            // Wait 100ms to batch
    "producer.override.buffer.memory": "67108864",   // 64MB total buffer
    "producer.override.compression.type": "snappy",  // Fast compression
    "producer.override.max.in.flight.requests.per.connection": "5",
    "producer.override.acks": "1",                   // Balance durability/speed

    // Connection pooling
    "connection.pool.size": "10"
  }
}
```

**High-Throughput Sink Connector:**

```json
{
  "name": "elasticsearch-sink-optimized",
  "config": {
    "connector.class": "io.confluent.connect.elasticsearch.ElasticsearchSinkConnector",
    "topics": "search-index-updates",
    "connection.url": "http://elasticsearch:9200",

    // Sink-specific batching
    "batch.size": "5000",
    "max.buffered.records": "20000",
    "flush.timeout.ms": "30000",
    "max.in.flight.requests": "5",

    // Consumer optimizations
    "consumer.override.fetch.min.bytes": "1048576",       // 1MB minimum fetch
    "consumer.override.fetch.max.wait.ms": "500",         // Wait up to 500ms
    "consumer.override.max.partition.fetch.bytes": "10485760",  // 10MB per partition
    "consumer.override.max.poll.records": "5000",

    // Connection pooling
    "connection.compression": "true",
    "connection.timeout.ms": "30000",
    "read.timeout.ms": "30000"
  }
}
```

### Configuration Guidelines by Throughput

**Low Throughput (<1K msgs/sec):**
```properties
batch.max.rows=500
producer.override.batch.size=16384  # Default OK
producer.override.linger.ms=10
```

**Medium Throughput (1K-100K msgs/sec):**
```properties
batch.max.rows=5000
producer.override.batch.size=131072  # 128KB
producer.override.linger.ms=50
producer.override.buffer.memory=33554432  # 32MB
```

**High Throughput (>100K msgs/sec):**
```properties
batch.max.rows=10000
producer.override.batch.size=524288  # 512KB
producer.override.linger.ms=100
producer.override.buffer.memory=134217728  # 128MB
producer.override.compression.type=lz4
```

### Memory Considerations

**Total Producer Memory Per Connector:**
```
memory_per_connector = producer.override.buffer.memory * tasks.max
```

**Example:**
- 64MB buffer.memory
- 8 tasks
- = 512MB total producer memory

**Worker JVM Heap Sizing:**
```bash
# Minimum heap size formula
# (number_of_connectors * tasks.max * buffer.memory) + 2GB overhead

# Example: 10 connectors, 4 tasks each, 64MB buffer
# (10 * 4 * 64MB) + 2GB = 4.5GB minimum heap

export KAFKA_HEAP_OPTS="-Xmx6G -Xms6G"
```

### Detection Hints

```bash
# Check for default configurations (likely undertuned)
curl -s http://localhost:8083/connectors/jdbc-source/config | \
  jq 'select(.["producer.override.batch.size"] == null)'

# Monitor producer metrics
curl -s http://localhost:8083/metrics | \
  grep "producer-metrics" | \
  jq '.["batch-size-avg"], .["requests-in-flight"]'

# Check for small batch warnings in logs
grep "Batch size.*too small" connect.log

# Identify throughput bottlenecks
# If CPU is low but throughput is low, likely batching issue
```

**Code Patterns to Flag:**
- Production connectors without `producer.override.*` configurations
- `batch.max.rows` < 1000 for high-volume sources
- `linger.ms=0` (immediate sends) in high-throughput scenarios
- Default `buffer.memory` (32MB) with many high-volume tasks
- No compression enabled for large messages
- `batch.size` less than average message size * batch.max.rows

---

## 8. No DLQ Monitoring and Processing Strategy

### Description
Enabling Dead Letter Queue (DLQ) without monitoring and processing is worse than failing fast. Messages silently accumulate in the DLQ, creating a hidden data integrity issue. **DLQs must have:**

1. Monitoring and alerting
2. Documented processing procedure
3. Automated or manual remediation workflow
4. Regular audits

**Common Failure Pattern:**
1. Enable DLQ to "handle errors gracefully"
2. Errors occur, messages sent to DLQ
3. No one notices DLQ is growing
4. Months later: "Where did 10 million records go?"

### Bad Configuration

```json
{
  "name": "dlq-fire-and-forget",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "topics": "orders",

    // DLQ enabled but...
    "errors.tolerance": "all",
    "errors.deadletterqueue.topic.name": "dlq-orders",

    // NO monitoring configured
    // NO processing plan
    // NO retention policy
    // Silent data loss!
  }
}
```

### Good Configuration

**1. DLQ with Context Headers:**

```json
{
  "name": "dlq-observable",
  "config": {
    "connector.class": "io.confluent.connect.jdbc.JdbcSinkConnector",
    "topics": "orders",

    "errors.tolerance": "all",
    "errors.deadletterqueue.topic.name": "dlq-orders",
    "errors.deadletterqueue.topic.replication.factor": "3",

    // Include diagnostic context
    "errors.deadletterqueue.context.headers.enable": "true",

    // Log errors for debugging
    "errors.log.enable": "true",
    "errors.log.include.messages": "true",

    // Retry before DLQ
    "errors.retry.timeout": "300000",  // 5 minutes
    "errors.retry.delay.max.ms": "30000"
  }
}
```

**2. DLQ Topic Configuration:**

```bash
# Create DLQ topic with appropriate retention
kafka-topics --bootstrap-server localhost:9092 --create \
  --topic dlq-orders \
  --partitions 10 \
  --replication-factor 3 \
  --config retention.ms=2592000000 \    # 30 days
  --config max.message.bytes=10485760    # 10MB (large messages)

# Separate DLQ per connector for isolation
# dlq-jdbc-sink-orders
# dlq-elasticsearch-events
# dlq-s3-logs
```

**3. Monitoring Configuration:**

```yaml
# Prometheus alerting rules
groups:
  - name: kafka_connect_dlq
    rules:
      # Alert when DLQ has messages
      - alert: DLQMessagesPresent
        expr: sum(kafka_topic_partition_current_offset{topic=~"dlq-.*"}) > 0
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "DLQ topic {{ $labels.topic }} has messages"
          description: "DLQ contains {{ $value }} messages - investigate failures"

      # Alert on DLQ growth rate
      - alert: DLQGrowthHigh
        expr: rate(kafka_topic_partition_current_offset{topic=~"dlq-.*"}[5m]) > 10
        labels:
          severity: critical
        annotations:
          summary: "DLQ topic {{ $labels.topic }} growing rapidly"
          description: "{{ $value }} messages/sec to DLQ - connector may be failing"

      # Alert when DLQ is large
      - alert: DLQSizeLarge
        expr: sum(kafka_topic_partition_current_offset{topic=~"dlq-.*"}) > 100000
        labels:
          severity: critical
        annotations:
          summary: "DLQ topic {{ $labels.topic }} has >100K messages"
          description: "DLQ has accumulated {{ $value }} messages - urgent remediation needed"
```

**4. DLQ Processing Application:**

```python
#!/usr/bin/env python3
# dlq_processor.py - Example DLQ remediation service

from kafka import KafkaConsumer, KafkaProducer
import json
import logging

class DLQProcessor:
    def __init__(self):
        self.consumer = KafkaConsumer(
            'dlq-orders',
            bootstrap_servers='localhost:9092',
            value_deserializer=lambda m: json.loads(m.decode('utf-8')),
            enable_auto_commit=False
        )
        self.producer = KafkaProducer(
            bootstrap_servers='localhost:9092',
            value_serializer=lambda v: json.dumps(v).encode('utf-8')
        )

    def process_dlq(self):
        for message in self.consumer:
            try:
                # Extract context from headers
                headers = dict(message.headers)
                exception = headers.get('__connect.errors.exception.message')
                original_topic = headers.get('__connect.errors.topic')

                logging.info(f"Processing DLQ message from {original_topic}")
                logging.error(f"Original error: {exception}")

                # Attempt remediation
                fixed_value = self.fix_data(message.value, exception)

                # Republish to original topic
                self.producer.send(original_topic, value=fixed_value)

                # Commit offset after successful processing
                self.consumer.commit()

            except Exception as e:
                logging.error(f"Failed to process DLQ message: {e}")
                # Don't commit - will retry

    def fix_data(self, data, exception):
        """Apply fixes based on error type"""
        if "Schema" in exception:
            # Handle schema evolution issues
            data = self.migrate_schema(data)
        elif "Constraint" in exception:
            # Handle constraint violations
            data = self.fix_constraints(data)

        return data

if __name__ == "__main__":
    processor = DLQProcessor()
    processor.process_dlq()
```

**5. Manual Review Dashboard:**

```javascript
// React component for DLQ management UI
import React, { useState, useEffect } from 'react';

function DLQMonitor() {
  const [dlqMessages, setDlqMessages] = useState([]);

  useEffect(() => {
    // Fetch DLQ messages
    fetch('/api/dlq/messages')
      .then(r => r.json())
      .then(setDlqMessages);
  }, []);

  const retryMessage = async (messageId) => {
    await fetch(`/api/dlq/retry/${messageId}`, { method: 'POST' });
    // Refresh list
  };

  const discardMessage = async (messageId) => {
    await fetch(`/api/dlq/discard/${messageId}`, { method: 'DELETE' });
    // Refresh list
  };

  return (
    <div>
      <h2>Dead Letter Queue Monitor</h2>
      <p>Total messages: {dlqMessages.length}</p>

      {dlqMessages.map(msg => (
        <div key={msg.id} className="dlq-message">
          <h4>Topic: {msg.originalTopic}</h4>
          <p>Error: {msg.exception}</p>
          <pre>{JSON.stringify(msg.value, null, 2)}</pre>

          <button onClick={() => retryMessage(msg.id)}>Retry</button>
          <button onClick={() => discardMessage(msg.id)}>Discard</button>
        </div>
      ))}
    </div>
  );
}
```

### DLQ Strategy Decision Tree

```
Should you enable DLQ?
│
├─ Can connector tolerate data loss?
│  ├─ Yes → DLQ optional, consider `errors.tolerance=none` (fail fast)
│  └─ No → Continue
│
├─ Do you have monitoring in place?
│  ├─ No → Set up monitoring FIRST, then enable DLQ
│  └─ Yes → Continue
│
├─ Do you have a processing plan?
│  ├─ No → Document process FIRST, then enable DLQ
│  └─ Yes → Continue
│
├─ Can errors be automatically remediated?
│  ├─ Yes → Build automated processor, enable DLQ
│  └─ No → Build manual review UI, enable DLQ
│
└─ Enable DLQ with full observability
```

### Detection Hints

```bash
# Find connectors with DLQ but no monitoring
curl -s http://localhost:8083/connectors | jq -r '.[]' | while read connector; do
  config=$(curl -s http://localhost:8083/connectors/$connector/config)
  dlq=$(echo $config | jq -r '.["errors.deadletterqueue.topic.name"]')

  if [ "$dlq" != "null" ]; then
    echo "Connector $connector has DLQ: $dlq"

    # Check if DLQ topic has messages
    kafka-run-class kafka.tools.GetOffsetShell \
      --broker-list localhost:9092 \
      --topic $dlq | awk '{sum+=$3} END {print "Messages in DLQ:", sum}'
  fi
done

# Check DLQ message age
kafka-console-consumer --bootstrap-server localhost:9092 \
  --topic dlq-orders \
  --from-beginning \
  --max-messages 1 \
  --property print.timestamp=true

# List all DLQ topics
kafka-topics --bootstrap-server localhost:9092 --list | grep ^dlq-
```

**Code Patterns to Flag:**
- DLQ enabled (`errors.deadletterqueue.topic.name` set) with:
  - No monitoring/alerting configured
  - No documented processing procedure
  - No retention policy on DLQ topic
  - `errors.deadletterqueue.context.headers.enable=false` (no diagnostic info)
- Comments like "TODO: handle DLQ" or "DLQ not monitored yet"
- DLQ topics with millions of messages and no recent consumer activity
- Production clusters with DLQ but no runbooks mentioning DLQ response

---

## Summary Table

| Anti-Pattern | Impact | Detection | Quick Fix |
|-------------|--------|-----------|-----------|
| **Single Task JDBC** | 10-100x throughput loss | `tasks.max > 1` with single task running | Use multiple connectors with partitioned queries or switch to CDC |
| **No Error Handling** | Complete pipeline failure on first error | Missing `errors.tolerance` | Add error tolerance + DLQ configuration |
| **SMT Overuse** | High latency, connector blocking | >4 SMTs or custom SMTs with I/O | Move to Kafka Streams/ksqlDB |
| **Offset Misconfiguration** | Data loss or duplication | `cleanup.policy=delete` on offset topic | Recreate topics with `cleanup.policy=compact` |
| **Task Imbalance** | Worker resource waste | Uneven CPU/memory across workers | Adjust `tasks.max` based on workload |
| **Converter Mistakes** | Serialization errors, pipeline failure | SerializationException in logs | Match converter to actual data format |
| **Poor Batching** | 10-50x throughput loss | Default batch configs in high-throughput | Tune batch sizes and producer settings |
| **Unmonitored DLQ** | Silent data loss | DLQ with messages, no alerts | Add monitoring + processing workflow |

---

## References

- [Performance Tuning Kafka JDBC Source Connector](https://factor-bytes.com/2024/05/11/performance-tuning-kafka-jdbc-source-connector/)
- [Kafka Connect: How to Increase Throughput on Source Connectors](https://www.confluent.io/blog/how-to-increase-throughput-on-kafka-connect-source-connectors/)
- [Kafka Connect Deep Dive – Error Handling and Dead Letter Queues](https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/)
- [Kafka Connect 101 - Errors and Dead Letter Queues](https://developer.confluent.io/courses/kafka-connect/error-handling-and-dead-letter-queues/)
- [Single Message Transforms - The Swiss Army Knife of Kafka Connect](https://www.morling.dev/blog/single-message-transforms-swiss-army-knife-of-kafka-connect/)
- [Kafka Connect Deep Dive – Converters and Serialization Explained](https://www.confluent.io/blog/kafka-connect-deep-dive-converters-serialization-explained/)
- [Understanding Kafka Connect Clusters, Scaling, and Task Management](https://axual.com/blog/kafka-connect-clusters-structure-scaling-and-task-management)

---

*Last Updated: 2025-12-11*
