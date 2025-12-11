# Kafka Monitoring and Observability Anti-Patterns

This document catalogs common anti-patterns and pitfalls in Kafka monitoring and observability, extracted from industry sources and best practices.

## Table of Contents

1. [Consumer Lag Monitoring Anti-Patterns](#consumer-lag-monitoring-anti-patterns)
2. [Under-Replicated Partitions and ISR Monitoring](#under-replicated-partitions-and-isr-monitoring)
3. [Producer Error and Retry Monitoring](#producer-error-and-retry-monitoring)
4. [End-to-End Latency Monitoring](#end-to-end-latency-monitoring)
5. [Dead Letter Queue (DLQ) Monitoring](#dead-letter-queue-dlq-monitoring)
6. [JMX Metrics Misinterpretation](#jmx-metrics-misinterpretation)
7. [Alert Configuration Anti-Patterns](#alert-configuration-anti-patterns)

---

## Consumer Lag Monitoring Anti-Patterns

### Anti-Pattern 1: No Consumer Lag Monitoring

**Problem Description:**
Operating Kafka without real-time consumer lag monitoring is one of the most critical monitoring gaps. Consumer lag directly measures how "real-time" your data pipeline is, and when consumers fall behind producers, downstream systems receive stale data or miss critical events entirely.

**What Metrics to Watch:**

```yaml
# Key JMX Metrics
kafka.consumer:
  type: consumer-fetch-manager-metrics
  client-id: *
  metrics:
    - records-lag: "Current lag in number of records for a partition"
    - records-lag-max: "Maximum lag across all assigned partitions"
    - records-lag-avg: "Average lag across all assigned partitions"
```

**Alert Threshold Recommendations:**

- **Time-based lag** (preferred): Alert when lag exceeds 2 minutes for real-time workloads
- **Offset-based lag** (requires tuning per topic): No universal threshold - must be established per workload
- **Trend-based alerts**: Alert on "lag keeps increasing" patterns over 5-10 minute windows
- **Burn-down time**: Calculate how long it will take the consumer to catch up at current rates

**Detection Hints:**

```python
# Example detection logic
if records_lag_max > 0 and trend_over_5min(records_lag_max) == "increasing":
    alert("Consumer lag increasing continuously")

if fetch_rate < baseline_fetch_rate * 0.5:
    alert("Consumer spending too much time processing between poll() calls")
```

**Common Pitfalls:**

- Using average lag across partitions (hides hotspots and critical issues)
- Not distinguishing between real-time vs. batch/archival consumers (different lag tolerances)
- Ignoring the relationship between lag and ISR shrinkage (producer blocking)

---

### Anti-Pattern 2: Wrong Lag Metric Type

**Problem Description:**
Monitoring offset-based lag when time-based lag would be more meaningful. With offset lag, you need different thresholds for each consumer group depending on message volume and workload characteristics, making alerting complex and error-prone.

**What Metrics to Watch:**

```yaml
# Time-based lag (recommended)
kafka.consumer.lag:
  type: time-based
  metric: consumer-lag-millis
  description: "Time difference between producer timestamp and consumer position"

# Offset-based lag (traditional)
kafka.consumer.lag:
  type: offset-based
  metric: records-lag-max
  description: "Message count difference between producer offset and consumer position"
```

**Alert Threshold Recommendations:**

- **Time-based**: Single threshold (e.g., 120 seconds) works across multiple consumer groups
- **Offset-based**: Requires per-topic/per-consumer-group configuration
- **Hybrid approach**: Monitor both, alert on time-based, investigate with offset-based

**Detection Hints:**

- If offset lag is 10,000 messages but time lag is 30 seconds → likely acceptable
- If offset lag is 100 messages but time lag is 5 minutes → critical issue (slow processing)

---

## Under-Replicated Partitions and ISR Monitoring

### Anti-Pattern 3: Ignoring Under-Replicated Partitions

**Problem Description:**
Under-replicated partitions occur when the number of in-sync replicas (ISR) is less than the total replica count. This critically undermines Kafka's high-availability guarantees. A growing count indicates network latency or broker strain and raises the risk of data loss during node failure.

**What Metrics to Watch:**

```yaml
# Critical JMX Metrics
kafka.server:
  type: ReplicaManager
  name: UnderReplicatedPartitions
  alert_threshold: "> 0 for more than 2 minutes"
  severity: CRITICAL

kafka.server:
  type: ReplicaFetcherManager
  name: MaxLag
  clientId: Replica
  description: "Maximum lag in messages between follower and leader replicas"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - metric: UnderReplicatedPartitions
    condition: value > 0
    duration: 2 minutes
    severity: CRITICAL
    action: "Investigation required immediately"

  - metric: UnderReplicatedPartitions
    condition: value > 0
    duration: 10 minutes
    severity: EMERGENCY
    action: "Potential data loss risk - page on-call engineer"
```

**Detection Hints:**

```bash
# CLI detection
kafka-topics --describe --under-replicated-partitions --bootstrap-server localhost:9092

# Look for patterns in broker logs
grep "ISR shrink" /var/log/kafka/server.log
grep "replica lag" /var/log/kafka/server.log
```

**Common Causes:**

- Broker unavailability or crashes
- Network latency between brokers
- Broker resource exhaustion (CPU, disk I/O, memory)
- Follower replicas falling behind due to slow replication

---

### Anti-Pattern 4: Not Monitoring ISR Shrinkage Rate

**Problem Description:**
ISR shrinkage events indicate replicas falling out of sync. The expected value for ISR shrink rate is 0 under normal conditions except during broker restarts. Sustained ISR shrinkage without corresponding expansion signals serious replication problems.

**What Metrics to Watch:**

```yaml
kafka.server:
  type: ReplicaManager
  metrics:
    - name: IsrShrinksPerSec
      expected: 0
      alert_on: "> 0 sustained"

    - name: IsrExpandsPerSec
      expected: "Should balance with IsrShrinksPerSec"
      alert_on: "Shrinks without corresponding expands"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "Sustained ISR Shrinkage"
    condition: |
      IsrShrinksPerSec > 0 for 5 minutes AND
      IsrExpandsPerSec == 0
    severity: HIGH
    description: "Replicas falling behind without recovery"

  - name: "ISR Flapping"
    condition: |
      (IsrShrinksPerSec > 1 OR IsrExpandsPerSec > 1) for 10 minutes
    severity: MEDIUM
    description: "Unstable replication - investigate network or broker health"
```

**Detection Hints:**

- Balanced shrinking and expanding = normal scaling operations
- Shrinking without expansion = degrading replication health
- Frequent flapping = network instability or resource contention

**Configuration Tuning:**

```properties
# replica.lag.time.max.ms controls ISR membership
# Default: 30 seconds (10000ms in some versions)

# Too low: Causes frequent ISR shrinkage during normal load spikes
replica.lag.time.max.ms=10000

# Too high: Masks underlying issues like network problems
replica.lag.time.max.ms=60000

# Recommended: Tune based on network latency and load patterns
# High-latency networks: increase to avoid premature ISR removal
# Low-latency networks: keep default or slightly increase
replica.lag.time.max.ms=30000
```

---

### Anti-Pattern 5: Not Alerting on ISR Below min.insync.replicas

**Problem Description:**
When ISR count falls below `min.insync.replicas`, producers configured with `acks=all` will be blocked, causing write failures and application errors. This is often discovered reactively after producer failures rather than proactively through monitoring.

**What Metrics to Watch:**

```yaml
kafka.cluster:
  partition_metrics:
    - isr_count: "Current number of in-sync replicas"
    - min_insync_replicas: "Configured minimum (topic or broker level)"

  alert_conditions:
    - condition: "isr_count < min.insync.replicas"
      impact: "Producer writes will fail with acks=all"
      severity: CRITICAL
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "ISR Below Minimum"
    condition: "isr_count < min.insync.replicas"
    duration: "30 seconds"
    severity: CRITICAL
    description: "Producers with acks=all will be blocked"

  - name: "ISR At Risk"
    condition: "isr_count == min.insync.replicas"
    duration: "2 minutes"
    severity: HIGH
    description: "One more replica failure will block producers"
```

**Detection Hints:**

```bash
# Check topic configuration
kafka-configs --describe --entity-type topics --entity-name <topic-name> --bootstrap-server localhost:9092

# Monitor producer errors
# Look for: "Not enough in-sync replicas" exceptions
```

---

## Producer Error and Retry Monitoring

### Anti-Pattern 6: Not Tracking Producer Errors and Retries

**Problem Description:**
Producer errors and retries are leading indicators of system problems, but many organizations only monitor them reactively when application errors occur. When `record-send-rate` drops but `record-error-rate` stays flat, this indicates saturation (broker CPU, disk I/O, or socket backpressure).

**What Metrics to Watch:**

```yaml
# Global producer metrics
kafka.producer:
  type: producer-metrics
  client-id: "{clientId}"
  metrics:
    - record-error-rate: "Average per-second number of record sends that resulted in errors"
    - record-error-total: "Total number of record send errors"
    - record-retry-rate: "Average per-second number of retried record sends"
    - record-retry-total: "Total number of retried record sends"
    - record-send-rate: "Average per-second number of records sent"

# Per-topic producer metrics
kafka.producer:
  type: producer-topic-metrics
  client-id: "{clientId}"
  topic: "{topic}"
  metrics:
    - record-error-rate: "Per-topic error rate"
    - record-retry-rate: "Per-topic retry rate"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "Producer Error Rate Spike"
    condition: "record-error-rate > baseline * 2"
    duration: "1 minute"
    severity: HIGH
    investigate:
      - "Broker availability"
      - "Serialization errors"
      - "Timeout exceptions (request.timeout.ms)"

  - name: "Producer Retry Rate Elevated"
    condition: "record-retry-rate > 10/sec with flat error rate"
    severity: MEDIUM
    description: "Transient network instability without outright failures"

  - name: "Producer Saturation"
    condition: |
      record-send-rate < baseline * 0.7 AND
      record-error-rate unchanged
    severity: HIGH
    description: "Backpressure from broker-side bottleneck"
```

**Detection Hints:**

```python
# Pattern analysis
if record_send_rate.dropped() and record_error_rate.stable():
    alert("Broker saturation: CPU, disk I/O, or socket backpressure")

if record_retry_rate.increased() and record_error_rate.stable():
    alert("Transient network instability")

if record_error_rate.increasing():
    investigate([
        "Broker unavailability",
        "Serialization failures",
        "Timeout exceptions",
        "Authentication/authorization failures"
    ])
```

**Common Error Types:**

```java
// Monitor for these exception types in application logs
TimeoutException          // Exceeds request.timeout.ms
NotLeaderForPartitionException  // Leader election in progress
NetworkException          // Broker connectivity issues
SerializationException    // Invalid message format
AuthorizationException    // ACL or auth failures
```

---

### Anti-Pattern 7: Ignoring Producer Request Latency

**Problem Description:**
High producer request latency often precedes outright failures but is frequently overlooked until timeouts occur. Request latency includes time in queue, network transmission, broker processing, and replication.

**What Metrics to Watch:**

```yaml
kafka.producer:
  type: producer-metrics
  client-id: "{clientId}"
  latency_metrics:
    - request-latency-avg: "Average request latency in ms"
    - request-latency-max: "Maximum request latency in ms"
    - produce-throttle-time-avg: "Average throttle time imposed by broker"
    - produce-throttle-time-max: "Maximum throttle time imposed by broker"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "Producer Latency P99 High"
    condition: "request-latency-p99 > 500ms"
    duration: "5 minutes"
    severity: HIGH

  - name: "Producer Being Throttled"
    condition: "produce-throttle-time-avg > 100ms"
    severity: MEDIUM
    description: "Broker quota enforcement active"
```

---

## End-to-End Latency Monitoring

### Anti-Pattern 8: Missing End-to-End Latency Tracking

**Problem Description:**
End-to-end latency measures the time from when `KafkaProducer.send()` is called to when the record is consumed via `KafkaConsumer.poll()`. Many organizations monitor producer and consumer metrics separately but lack visibility into the complete pipeline latency.

**What Metrics to Watch:**

```yaml
# Producer side
producer_metrics:
  - record-send-timestamp: "Timestamp when record was sent"
  - request-latency-avg: "Producer request latency"

# Broker side
broker_metrics:
  - RequestQueueTimeMs: "Time requests wait in queue"
  - RequestProcessingTimeMs: "Time broker takes to process requests"
  - LogFlushLatencyMs: "Time to flush logs to disk"

# Consumer side
consumer_metrics:
  - fetch-latency-avg: "Average fetch request latency"
  - consumer-lag-time: "Time lag between producer and consumer"
  - records-lag-max: "Offset lag (can be converted to time lag)"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "End-to-End Latency High"
    condition: "e2e_latency_p99 > 5000ms"
    severity: HIGH
    description: "Total pipeline latency exceeds 5 seconds"

  - name: "Request Queue Time High"
    condition: "RequestQueueTimeMs.p99 > 1000ms"
    severity: HIGH
    description: "Requests waiting too long in broker queue"

  - name: "Log Flush Latency High"
    condition: "LogFlushLatencyMs.p99 > 2000ms"
    severity: CRITICAL
    description: "Disk I/O bottleneck - leading indicator for pipeline backup"
```

**Detection Hints:**

```yaml
# Implement distributed tracing
tracing_strategy:
  - approach: "OpenTelemetry integration"
  - span_creation:
      - producer_span: "Start when send() called"
      - broker_span: "Track broker processing time"
      - consumer_span: "End when poll() returns record"
  - benefits:
      - "Pinpoint latency sources in complex architectures"
      - "Trace messages across microservices"
      - "Identify bottlenecks in multi-stage pipelines"
```

**Common Latency Contributors:**

```yaml
latency_sources:
  replication_lag:
    cause: "Followers lag behind leader due to slow replica fetchers"
    monitoring: "kafka.server:type=ReplicaFetcherManager,name=MaxLag"

  log_flushing:
    cause: "Kafka flushes data to disk periodically"
    config: "log.flush.interval.messages, log.flush.interval.ms"
    monitoring: "LogFlushLatencyMs"

  consumer_processing:
    cause: "Slow message processing creates backpressure"
    monitoring: "fetch-rate (low values indicate slow processing)"

  acks_configuration:
    cause: "acks=all waits for all replicas, increasing latency"
    tradeoff: "Consistency vs latency"

  ssl_overhead:
    cause: "Encryption overhead on clients and brokers"
    impact: "Cannot leverage zero-copy (sendfile)"

  multi_az_replication:
    cause: "Cross-AZ network latency"
    impact: "Increases commit time due to replication delay"
```

---

### Anti-Pattern 9: Not Monitoring Replication Lag

**Problem Description:**
Replication lag delays message availability for consumers and is a leading indicator of broker resource exhaustion. The longer it takes to replicate, the worse latency and throughput become.

**What Metrics to Watch:**

```yaml
kafka.server:
  type: ReplicaFetcherManager
  name: MaxLag
  clientId: Replica
  description: "Maximum lag in messages between follower and leader"
  alert_threshold: "> 1000 messages for 5 minutes"

kafka.server:
  type: BrokerTopicMetrics
  name: ReplicationBytesInPerSec
  description: "Rate of replication traffic"
  alert_on: "Sudden drops indicate replication issues"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "High Replication Lag"
    condition: "MaxLag > 1000 messages"
    duration: "5 minutes"
    severity: HIGH

  - name: "Replication Stalled"
    condition: "ReplicationBytesInPerSec < baseline * 0.5"
    duration: "3 minutes"
    severity: CRITICAL
```

---

## Dead Letter Queue (DLQ) Monitoring

### Anti-Pattern 10: No DLQ Size Monitoring

**Problem Description:**
Dead Letter Queues collect messages that fail processing, but without monitoring DLQ size and growth rate, systemic upstream issues go undetected. A sudden spike in DLQ size indicates significant problems in the main processing pipeline.

**What Metrics to Watch:**

```yaml
# DLQ-specific metrics
kafka.connect:
  type: task-error-metrics
  connector: "*"
  task: "*"
  metrics:
    - deadletterqueue-produce-requests: "Number of messages sent to DLQ"

# Topic-level DLQ metrics
dlq_monitoring:
  - topic_size: "Total messages in DLQ topic"
  - message_age: "Age of oldest message in DLQ"
  - growth_rate: "Messages/second added to DLQ"
  - error_type_distribution: "Categorization of failure reasons"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "DLQ Growth Rate High"
    condition: "dlq_growth_rate > 100 messages/minute"
    duration: "5 minutes"
    severity: HIGH
    description: "Sudden spike indicates systemic processing issue"

  - name: "DLQ Size Large"
    condition: "dlq_total_messages > 10000"
    severity: MEDIUM
    description: "Large backlog requires investigation and cleanup"

  - name: "DLQ Message Age High"
    condition: "dlq_oldest_message_age > 24 hours"
    severity: LOW
    description: "Old unprocessed failures - review and remediate"

  - name: "Specific Error Type Concentration"
    condition: "single_error_type_percentage > 80%"
    severity: HIGH
    description: "Concentrated error pattern suggests upstream systemic issue"
```

**Detection Hints:**

```python
# Monitor DLQ patterns
def analyze_dlq_health(dlq_metrics):
    # Sudden spike detection
    if dlq_metrics.growth_rate > baseline * 5:
        alert("DLQ spike: systemic upstream failure likely")

    # Error type analysis
    error_distribution = dlq_metrics.error_types
    if any(error_count / total > 0.8 for error_count in error_distribution.values()):
        alert("Concentrated error pattern detected")
        investigate_upstream_service()

    # Age analysis
    if dlq_metrics.oldest_message_age > timedelta(hours=24):
        alert("Stale DLQ messages - review retry policy")
```

**Common Mistakes:**

```yaml
antipatterns:
  using_dlq_for_connectivity_issues:
    problem: "Putting messages in DLQ due to failed connectivity doesn't help"
    reason: "Following messages also cannot connect to the system"
    solution: "Fix connection issue instead - use retry logic for transient failures"

  wrong_use_cases:
    avoid_dlq_for:
      - "Network timeouts"
      - "Temporary service unavailability"
      - "Rate limiting (429 errors)"
    use_dlq_for:
      - "Schema validation errors"
      - "Malformed data"
      - "Business rule violations"
      - "Deserialization failures"
      - "Invalid/missing required fields"

  no_dlq_processing_strategy:
    problem: "Messages accumulate in DLQ without remediation plan"
    solution:
      - "Automated alerting on DLQ growth"
      - "Regular review process for DLQ messages"
      - "Automated retry after upstream fixes"
      - "Manual intervention workflow for data issues"
```

---

## JMX Metrics Misinterpretation

### Anti-Pattern 11: Single-Metric Analysis Without Context

**Problem Description:**
Analyzing individual JMX metrics in isolation often leads to false conclusions. Metrics must be correlated to understand the true system state. For example, a dropped fetch rate combined with constant network throughput indicates healthy consumption of larger messages, not a failure.

**What Metrics to Watch (With Context):**

```yaml
# Example: Consumer Health Assessment
consumer_health_analysis:
  fetch_rate:
    metric: "kafka.consumer:type=consumer-fetch-manager-metrics,fetch-rate"
    context_required:
      - network_throughput
      - message_size_avg
      - records_consumed_rate

    interpretation:
      - scenario: "fetch-rate drops + network-throughput constant"
        meaning: "Consuming fewer but larger messages (healthy)"
      - scenario: "fetch-rate drops + network-throughput drops"
        meaning: "Consumer stalled or processing slowly (unhealthy)"
      - scenario: "fetch-rate drops + records-consumed-rate stable"
        meaning: "Fewer fetches needed due to larger batches (healthy)"

# Example: Broker Saturation Assessment
broker_saturation_analysis:
  request_queue_size:
    metric: "kafka.network:type=RequestMetrics,name=RequestQueueSize"
    context_required:
      - request_processing_time
      - cpu_utilization
      - network_throughput

    interpretation:
      - scenario: "queue-size high + cpu-high + processing-time-high"
        meaning: "Broker overloaded - scale up or add brokers"
      - scenario: "queue-size high + cpu-low + processing-time-low"
        meaning: "Network bottleneck or client-side throttling"
```

**Alert Threshold Recommendations:**

```yaml
# Context-aware alerting
alerts:
  - name: "Consumer Actually Stalled"
    condition: |
      fetch-rate < baseline * 0.5 AND
      network-throughput < baseline * 0.5 AND
      records-lag-max increasing
    severity: HIGH

  - name: "Broker CPU Saturation"
    condition: |
      RequestQueueSize > 100 AND
      cpu-utilization > 80% AND
      RequestProcessingTimeMs.p99 > 1000
    severity: CRITICAL
```

**Detection Hints:**

```python
# Correlation-based detection
def assess_consumer_health(metrics):
    fetch_rate = metrics.fetch_rate
    throughput = metrics.network_throughput
    lag = metrics.records_lag_max

    # Pattern 1: Healthy large message consumption
    if fetch_rate.decreased() and throughput.stable() and lag.stable():
        return "healthy_large_messages"

    # Pattern 2: Consumer stall
    elif fetch_rate.decreased() and throughput.decreased() and lag.increasing():
        return "consumer_stalled"

    # Pattern 3: Slow processing
    elif fetch_rate.low() and lag.increasing():
        return "slow_message_processing"

    return "unknown_pattern"
```

---

### Anti-Pattern 12: Ignoring Page Cache Hit Ratio

**Problem Description:**
Kafka heavily relies on OS page cache for performance. A low page cache read ratio (below 80%) indicates that brokers are spending significant time on disk I/O instead of serving from memory, degrading performance. This is often ignored until severe latency issues occur.

**What Metrics to Watch:**

```yaml
# System-level metrics (require OS monitoring)
os_metrics:
  page_cache_hit_ratio:
    calculation: "(page_cache_reads - disk_reads) / page_cache_reads"
    target: "> 80%"
    alert_threshold: "< 80% for 10 minutes"

  disk_io_utilization:
    metric: "iostat -x"
    columns: ["%util", "await", "svctm"]
    alert_threshold: "%util > 80%"

# Kafka disk metrics
kafka.server:
  type: BrokerTopicMetrics
  name: BytesInPerSec
  correlation: "Compare with disk throughput to assess cache efficiency"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "Low Page Cache Hit Ratio"
    condition: "page_cache_hit_ratio < 80%"
    duration: "10 minutes"
    severity: HIGH
    action: "Consider adding brokers or increasing RAM"

  - name: "Disk I/O Saturation"
    condition: "disk_util > 80%"
    duration: "5 minutes"
    severity: CRITICAL
    description: "Disk is bottleneck - throttling imminent"
```

**Detection Hints:**

```bash
# Monitor disk I/O
iostat -x 5  # 5-second intervals

# Look for:
# %util > 80%: Disk is saturated
# await > 20ms: High latency
# svctm > 10ms: Service time high

# Check page cache statistics
vmstat 5

# Look for:
# High "bi" (blocks in): Reading from disk frequently
# High "bo" (blocks out): Writing to disk frequently
```

---

### Anti-Pattern 13: Not Monitoring JVM Garbage Collection

**Problem Description:**
JVM garbage collection pauses directly impact broker performance and cause latency spikes. GC pauses can cause replicas to fall out of ISR, request timeouts, and consumer rebalances. Many teams only investigate GC after experiencing severe production issues.

**What Metrics to Watch:**

```yaml
jvm_metrics:
  gc_time:
    metric: "java.lang:type=GarbageCollector,name=G1 Old Generation,CollectionTime"
    alert_threshold: "GC time > 5% of wall clock time"

  gc_count:
    metric: "java.lang:type=GarbageCollector,name=G1 Young Generation,CollectionCount"
    monitoring: "Track frequency and duration"

  heap_usage:
    metric: "java.lang:type=Memory,HeapMemoryUsage"
    alert_threshold: "> 85% sustained"

  gc_pause_duration:
    target: "< 100ms for young GC, < 1000ms for old GC"
    alert: "Pauses > 1 second cause ISR issues"
```

**Alert Threshold Recommendations:**

```yaml
alerts:
  - name: "GC Time Percentage High"
    condition: "gc_time_percentage > 5%"
    duration: "10 minutes"
    severity: HIGH
    description: "Broker spending too much time in GC"

  - name: "Long GC Pause"
    condition: "gc_pause_duration > 1000ms"
    severity: CRITICAL
    description: "GC pause may cause ISR shrinkage and timeouts"

  - name: "Heap Memory High"
    condition: "heap_usage_percentage > 85%"
    duration: "5 minutes"
    severity: HIGH
    description: "High memory pressure - frequent GC likely"
```

**Detection Hints:**

```bash
# Enable GC logging
KAFKA_JVM_PERFORMANCE_OPTS="-XX:+UseG1GC \
  -XX:+PrintGCDetails \
  -XX:+PrintGCDateStamps \
  -XX:+PrintGCTimeStamps \
  -Xloggc:/var/log/kafka/gc.log"

# Analyze GC logs
# Look for:
# - Frequent Full GC events
# - GC pause times > 1 second
# - Increasing pause times over time

# Monitor via JMX
# Set up continuous monitoring of:
# - GC pause distribution (p50, p99, p999)
# - Time spent in GC vs application
# - Heap usage trends
```

---

## Alert Configuration Anti-Patterns

### Anti-Pattern 14: Dashboards Without Actionable Alerts

**Problem Description:**
Many organizations create comprehensive Grafana dashboards showing all Kafka metrics but fail to implement actionable alerting rules. While visualizing spikes is useful, receiving alerts when specific thresholds are breached enables proactive remediation and prevents small issues from cascading into outages.

**What Metrics to Watch:**

```yaml
# Critical metrics requiring alerts (not just dashboards)
critical_alert_metrics:
  availability:
    - UnderReplicatedPartitions > 0
    - OfflinePartitionsCount > 0
    - ActiveControllerCount != 1

  durability:
    - IsrShrinksPerSec > 0 (sustained)
    - UncleanLeaderElectionsPerSec > 0
    - ReplicaMaxLag > threshold

  performance:
    - consumer_lag > threshold
    - request_queue_time_p99 > 1000ms
    - produce_latency_p99 > 500ms

  capacity:
    - disk_usage > 80%
    - cpu_utilization > 80%
    - network_throughput > 80% of capacity
```

**Alert Threshold Recommendations:**

```yaml
alerting_best_practices:
  severity_levels:
    critical:
      description: "Immediate response required - data loss or outage imminent"
      examples:
        - "OfflinePartitionsCount > 0"
        - "ActiveControllerCount != 1 for > 1 second"
        - "UncleanLeaderElectionsPerSec > 0"
      response_time: "< 5 minutes"

    high:
      description: "Urgent investigation needed - degraded state"
      examples:
        - "UnderReplicatedPartitions > 0 for > 2 minutes"
        - "ISR shrinkage without expansion for > 5 minutes"
        - "Consumer lag > 2 minutes for real-time workloads"
      response_time: "< 15 minutes"

    medium:
      description: "Attention needed - potential future issue"
      examples:
        - "Disk usage > 70%"
        - "Producer retry rate elevated"
        - "ISR flapping detected"
      response_time: "< 1 hour"

    low:
      description: "Review recommended - informational"
      examples:
        - "DLQ messages aging > 24 hours"
        - "Consumer group rebalancing frequently"
      response_time: "< 24 hours"

  alert_configuration:
    notification_channels:
      critical: ["pagerduty", "slack_urgent", "phone"]
      high: ["slack_alerts", "email_immediate"]
      medium: ["slack_monitoring", "email_digest"]
      low: ["email_daily_digest", "ticket_system"]

    deduplication:
      enabled: true
      window: "5 minutes"
      description: "Avoid alert fatigue from flapping metrics"

    escalation:
      enabled: true
      rules:
        - "If HIGH alert unacknowledged for 30 minutes, escalate to CRITICAL"
        - "If CRITICAL alert unacknowledged for 10 minutes, page secondary on-call"
```

**Detection Hints:**

```yaml
# Alert rule examples (Prometheus/Alertmanager format)

# Critical: Offline partitions
- alert: KafkaOfflinePartitions
  expr: kafka_controller_kafkacontroller_offlinepartitionscount > 0
  for: 30s
  labels:
    severity: critical
  annotations:
    summary: "Kafka offline partitions detected"
    description: "{{ $value }} partitions are offline - data inaccessible"

# High: Under-replicated partitions
- alert: KafkaUnderReplicatedPartitions
  expr: kafka_server_replicamanager_underreplicatedpartitions > 0
  for: 2m
  labels:
    severity: high
  annotations:
    summary: "Kafka has under-replicated partitions"
    description: "{{ $value }} partitions are under-replicated - durability at risk"

# High: Consumer lag time-based
- alert: KafkaConsumerLagHigh
  expr: kafka_consumer_lag_seconds > 120
  for: 5m
  labels:
    severity: high
    consumer_group: "{{ $labels.consumer_group }}"
  annotations:
    summary: "Consumer lag exceeds 2 minutes"
    description: "Consumer group {{ $labels.consumer_group }} is lagging {{ $value }}s behind"

# Medium: Disk usage warning
- alert: KafkaDiskUsageHigh
  expr: (node_filesystem_size_bytes - node_filesystem_avail_bytes) / node_filesystem_size_bytes > 0.70
  for: 5m
  labels:
    severity: medium
  annotations:
    summary: "Kafka broker disk usage high"
    description: "Disk usage is {{ $value | humanizePercentage }} on {{ $labels.instance }}"
```

---

### Anti-Pattern 15: No Baseline-Based Alerting

**Problem Description:**
Using static thresholds without establishing workload-specific baselines leads to either too many false positives or missed issues. What's "normal" varies significantly between different Kafka deployments, topics, and consumer groups.

**What Metrics to Watch:**

```yaml
# Metrics requiring baseline establishment
baseline_metrics:
  throughput:
    - messages_per_second
    - bytes_per_second
    - requests_per_second
    establish: "Monitor for 7-14 days to understand patterns"

  latency:
    - produce_latency_p50_p99
    - fetch_latency_p50_p99
    - e2e_latency_p50_p99
    establish: "Capture daily and weekly patterns"

  consumer_lag:
    - per_consumer_group_lag
    - per_topic_lag
    establish: "Different baseline per consumer type (real-time vs batch)"

  resource_utilization:
    - cpu_usage
    - memory_usage
    - disk_io
    - network_throughput
    establish: "Understand peak hours and growth trends"
```

**Alert Threshold Recommendations:**

```yaml
dynamic_alerting:
  approach: "Baseline + Deviation"

  configuration:
    baseline_window: "7 days"
    comparison_window: "5 minutes"
    deviation_threshold: "2x standard deviation"

  example_rules:
    - name: "Throughput Anomaly"
      condition: "current_value < (baseline_mean - 2 * baseline_stddev)"
      description: "Throughput dropped below expected range"

    - name: "Latency Anomaly"
      condition: "current_p99 > (baseline_p99 * 1.5)"
      description: "Latency 50% higher than baseline"

    - name: "Consumer Lag Anomaly"
      condition: |
        current_lag > baseline_lag * 3 OR
        lag_growth_rate > baseline_growth_rate * 5
      description: "Lag significantly higher than normal pattern"

  benefits:
    - "Adapts to workload changes automatically"
    - "Reduces false positives during known high-traffic periods"
    - "Detects subtle degradations that static thresholds miss"
    - "Accounts for daily/weekly patterns"
```

**Detection Hints:**

```python
# Baseline-based anomaly detection
class KafkaMetricBaseline:
    def __init__(self, metric_name, window_days=7):
        self.metric_name = metric_name
        self.window_days = window_days
        self.baseline = self.calculate_baseline()

    def calculate_baseline(self):
        """Calculate mean, stddev, p50, p99 from historical data"""
        historical_data = fetch_metric_history(
            metric=self.metric_name,
            days=self.window_days
        )
        return {
            'mean': np.mean(historical_data),
            'stddev': np.std(historical_data),
            'p50': np.percentile(historical_data, 50),
            'p99': np.percentile(historical_data, 99)
        }

    def is_anomalous(self, current_value):
        """Detect if current value deviates significantly from baseline"""
        lower_bound = self.baseline['mean'] - (2 * self.baseline['stddev'])
        upper_bound = self.baseline['mean'] + (2 * self.baseline['stddev'])

        return current_value < lower_bound or current_value > upper_bound

    def get_alert_context(self, current_value):
        """Provide context for alert"""
        deviation = abs(current_value - self.baseline['mean']) / self.baseline['stddev']
        return {
            'current': current_value,
            'baseline_mean': self.baseline['mean'],
            'deviation_stddev': deviation,
            'historical_p99': self.baseline['p99']
        }
```

---

### Anti-Pattern 16: Alert Fatigue from Non-Actionable Alerts

**Problem Description:**
Poorly configured alerts that fire frequently for non-critical issues lead to alert fatigue, causing teams to ignore notifications and miss actual critical problems. Alerts must be actionable with clear remediation steps.

**What to Avoid:**

```yaml
bad_alert_patterns:
  too_sensitive:
    example: "Alert on any consumer lag > 0"
    problem: "Fires constantly even during normal operation"
    fix: "Use time-based or trend-based thresholds"

  no_duration:
    example: "Alert on UnderReplicatedPartitions > 0 immediately"
    problem: "Fires during brief leader elections"
    fix: "Add 'for: 2m' to wait for transient issues to resolve"

  missing_context:
    example: "CPU usage high"
    problem: "No information about which broker, what's normal, or what to do"
    fix: "Include broker ID, baseline comparison, runbook link"

  non_actionable:
    example: "Alert on every ISR shrink event"
    problem: "Normal during rolling restarts, causes alert spam"
    fix: "Alert on sustained ISR shrinkage without recovery"
```

**Alert Quality Checklist:**

```yaml
actionable_alert_requirements:
  - is_actionable: "Can someone take immediate action?"
  - has_runbook: "Is there documentation on how to respond?"
  - includes_context:
      - "Which component (broker ID, topic, consumer group)?"
      - "Current value vs baseline/threshold"
      - "Related metrics for correlation"
      - "Recent events (deployments, scaling, failures)"
  - appropriate_severity: "Severity matches actual impact"
  - deduplication: "Won't fire repeatedly for same issue"
  - escalation_path: "Clear ownership and escalation"

example_good_alert:
  name: "KafkaConsumerLagCritical"
  condition: |
    kafka_consumer_lag_seconds{consumer_group="order-processor"} > 300
    AND
    rate(kafka_consumer_lag_seconds{consumer_group="order-processor"}[5m]) > 10
  for: "5m"
  severity: "high"
  annotations:
    summary: "Consumer group {{ $labels.consumer_group }} has critical lag"
    description: |
      Consumer group {{ $labels.consumer_group }} has {{ $value }}s lag.
      Lag is also increasing at {{ $rate }}s per second.
      Baseline lag: 30s. This is 10x normal levels.

      Possible causes:
      - Consumer instances down (check pod count)
      - Slow message processing (check application logs)
      - Sudden spike in producer traffic (check producer metrics)

      Runbook: https://wiki.company.com/kafka/consumer-lag-response
    dashboard: "https://grafana.company.com/d/kafka-consumer?var-consumer_group={{ $labels.consumer_group }}"
    runbook: "https://wiki.company.com/kafka/consumer-lag-response"
  labels:
    team: "data-platform"
    component: "kafka"
    consumer_group: "{{ $labels.consumer_group }}"
```

---

## Summary: Monitoring Coverage Checklist

Ensure you have monitoring and alerting for all these areas:

```yaml
essential_monitoring_coverage:
  availability:
    - ✓ ActiveControllerCount == 1
    - ✓ OfflinePartitionsCount == 0
    - ✓ UnderReplicatedPartitions == 0

  durability:
    - ✓ ISR shrinkage events
    - ✓ ISR count >= min.insync.replicas
    - ✓ UncleanLeaderElectionsPerSec == 0
    - ✓ Replication lag (MaxLag)

  consumer_health:
    - ✓ Consumer lag (time-based preferred)
    - ✓ Consumer lag trend (increasing/stable/decreasing)
    - ✓ Fetch rate and throughput correlation
    - ✓ Consumer group rebalancing frequency

  producer_health:
    - ✓ Record error rate
    - ✓ Record retry rate
    - ✓ Producer request latency (p99)
    - ✓ Producer throttling time

  latency:
    - ✓ End-to-end latency
    - ✓ Request queue time
    - ✓ Request processing time
    - ✓ Log flush latency

  dlq:
    - ✓ DLQ size and growth rate
    - ✓ DLQ message age
    - ✓ Error type distribution

  broker_health:
    - ✓ CPU utilization
    - ✓ Memory usage
    - ✓ Disk usage and I/O
    - ✓ Network throughput
    - ✓ Page cache hit ratio
    - ✓ JVM GC time and pause duration

  alerting_quality:
    - ✓ All critical metrics have alerts (not just dashboards)
    - ✓ Alerts include baseline/context
    - ✓ Alerts are actionable with runbooks
    - ✓ Alert severity matches impact
    - ✓ Deduplication configured
    - ✓ Escalation paths defined
```

---

## References

This knowledge base was compiled from the following sources:

1. **Kafka Anti-Patterns and Monitoring**
   - [Kafka Anti-Patterns: Common Pitfalls and How to Avoid Them](https://medium.com/@shailendrasinghpatil/kafka-anti-patterns-common-pitfalls-and-how-to-avoid-them-833cdcf2df89)
   - [Top 10 Kafka Anti-Patterns That Are Killing Your Microservices Performance](https://medium.com/@gaddamnaveen192/top-10-kafka-anti-patterns-that-are-killing-your-microservices-performance-5a6f71d58141)
   - [Apache Kafka Anti-Patterns and How To Avoid Them - Instaclustr](https://www.instaclustr.com/blog/apache-kafka-anti-patterns/)

2. **Consumer Lag and Monitoring**
   - [Kafka Fundamentals: Kafka Consumer Lag](https://dev.to/devopsfundamentals/kafka-fundamentals-kafka-consumer-lag-dfo)
   - [Monitor the Consumer Lag in Apache Kafka - Baeldung](https://www.baeldung.com/java-kafka-consumer-lag)
   - [Monitor Kafka Consumer Lag in Confluent Cloud](https://docs.confluent.io/cloud/current/monitoring/monitor-lag.html)
   - [The Kafka Metric You're Not Using: Stop Counting Messages, Start Measuring Time - WarpStream](https://www.warpstream.com/blog/the-kafka-metric-youre-not-using-stop-counting-messages-start-measuring-time)

3. **ISR and Replication Monitoring**
   - [Kafka Fundamentals: Kafka ISR](https://dev.to/devopsfundamentals/kafka-fundamentals-kafka-isr-5hl5)
   - [Understanding Kafka ISR: In-Sync Replicas](https://www.codestudy.net/blog/kafka-isr/)
   - [Kafka ISR, High Watermark & Leader Epoch - Deep Dive Guide](https://shayne007.github.io/2025/06/09/Kafka-ISR-High-Watermark-Leader-Epoch-Deep-Dive-Guide/)

4. **Performance and Latency**
   - [Kafka Performance Metrics: How to Monitor - Datadog](https://www.datadoghq.com/blog/monitoring-kafka-performance-metrics/)
   - [Why Kafka Latency Matters: Tips to Fix Streaming Delays](https://www.acceldata.io/blog/why-kafka-latency-matters-understanding-and-fixing-streaming-delays)
   - [Tail Latency at Scale with Apache Kafka - Confluent](https://www.confluent.io/blog/configure-kafka-to-minimize-latency/)

5. **Producer Metrics and Errors**
   - [How to Monitor Kafka Producer Metrics - Last9](https://last9.io/blog/kafka-producer-metrics/)
   - [An overview of Kafka performance metrics - Redpanda](https://www.redpanda.com/guides/kafka-use-cases-metrics)
   - [Kafka Producer Metrics Documentation](https://kafka.apache.org/32/generated/producer_metrics.html)

6. **Dead Letter Queue**
   - [Kafka Connect Deep Dive – Error Handling and Dead Letter Queues - Confluent](https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/)
   - [Apache Kafka Dead Letter Queue: A Comprehensive Guide - Confluent](https://www.confluent.io/learn/kafka-dead-letter-queue/)
   - [Kafka Dead Letter Queue Best Practices - Superstream](https://www.superstream.ai/blog/kafka-dead-letter-queue)

7. **JMX and Monitoring Tools**
   - [Monitoring Kafka with JMX - Confluent Documentation](https://docs.confluent.io/platform/current/kafka/monitoring.html)
   - [Essential Metrics for Kafka Performance Monitoring - Lumigo](https://lumigo.io/blog/essential-metrics-for-kafka-performance-monitoring/)
   - [Kafka monitoring: Key metrics and 5 tools to know in 2025 - Instaclustr](https://www.instaclustr.com/education/apache-kafka/kafka-monitoring-key-metrics-and-5-tools-to-know-in-2025/)

8. **Production Issues and Best Practices**
   - [Apache Kafka Issues in Production: How to Diagnose and Prevent Failures - Confluent](https://www.confluent.io/learn/kafka-issues-production/)
   - [Common Kafka Performance Issues and How to Fix Them - MeshIQ](https://meshiq.com/common-kafka-performance-issues-and-how-to-fix-them)
   - [How We Monitor and Run Kafka at Scale - Splunk](https://www.splunk.com/en_us/blog/devops/how-we-monitor-and-run-kafka-at-scale.html)

---

**Document Version:** 1.0
**Last Updated:** 2025-12-11
**Maintained By:** CodeGuard AI Knowledge Base
