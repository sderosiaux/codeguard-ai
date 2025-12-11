# Kafka Cluster Configuration and Multi-DC/DR Anti-Patterns

This document catalogs common anti-patterns in Kafka cluster configuration, replication, and multi-datacenter/disaster recovery setups based on industry research and production incidents.

---

## 1. Replication Factor = 1 (No Fault Tolerance)

### Pattern Name
**Single Replica Configuration - Zero Fault Tolerance**

### Description
Running Kafka topics with a replication factor of 1 eliminates all redundancy, meaning any broker failure results in immediate data loss. This configuration provides zero fault tolerance and should never be used in production environments.

### Bad Configuration Example
```properties
# Topic configuration
replication.factor=1

# Or via CLI
kafka-topics.sh --create --topic my-topic \
  --partitions 10 \
  --replication-factor 1 \
  --bootstrap-server localhost:9092
```

### Good Configuration Example
```properties
# Broker default configuration
default.replication.factor=3
min.insync.replicas=2

# Topic configuration with explicit RF
kafka-topics.sh --create --topic my-topic \
  --partitions 10 \
  --replication-factor 3 \
  --config min.insync.replicas=2 \
  --bootstrap-server localhost:9092

# Producer configuration for durability
acks=all
```

### Detection Hints
```bash
# Check replication factor for all topics
kafka-topics.sh --describe --bootstrap-server localhost:9092 | grep "ReplicationFactor:1"

# List topics with insufficient replication
kafka-topics.sh --describe --bootstrap-server localhost:9092 | awk '/ReplicationFactor:1/{print}'
```

**Monitoring Alert:**
- Alert when any topic has `replication.factor < 3`
- Track metrics: `kafka.cluster:type=Topic,name=PartitionCount,topic=*`

---

## 2. min.insync.replicas Too Low

### Pattern Name
**Minimum ISR Misconfiguration - Durability at Risk**

### Description
The default value of `min.insync.replicas=1` means that if only 1 replica is part of the in-sync-replica (ISR) set, writes will succeed. This is risky because data could be stored on only one broker, and if that broker experiences disk failure, data is lost since it hasn't been replicated yet.

**Common Misconception:** Developers often confuse `min.insync.replicas` as controlling how many replicas acknowledge messages at any time. In reality, with `acks=all`, the leader waits for ALL brokers in the ISR, not just the minimum. The `min.insync.replicas` setting only determines the minimum ISR size required for writes to succeed.

### Bad Configuration Example
```properties
# Broker or topic configuration - DANGEROUS DEFAULT
min.insync.replicas=1
replication.factor=3
# This allows writes to succeed with only 1 replica!

# Producer config
acks=all  # Misleading: only 1 replica might ack
```

**Risk Scenario:**
```
Cluster State:
- Topic: orders, RF=3, min.insync.replicas=1
- Broker-1 (Leader): UP
- Broker-2 (Follower): DOWN
- Broker-3 (Follower): DOWN

Result: Writes still succeed with only Broker-1!
If Broker-1 disk fails → DATA LOSS
```

### Good Configuration Example
```properties
# Broker defaults
default.replication.factor=3
min.insync.replicas=2

# Topic-level override
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name critical-topic \
  --add-config min.insync.replicas=2 \
  --bootstrap-server localhost:9092

# Producer configuration
acks=all
retries=2147483647
max.in.flight.requests.per.connection=5
enable.idempotence=true
```

**Tolerance Calculation:**
- With RF=3, min.insync.replicas=2: Can tolerate 1 broker failure
- With RF=5, min.insync.replicas=3: Can tolerate 2 broker failures

### Advanced: Multi-DC Configuration (Confluent Stretched Cluster)
```properties
# For stretched clusters across datacenters
replication.factor=6
min.insync.replicas=3

# Most robust configuration for combined broker + DC failures
# Simpler configs (RF=4, min.ISR=2) risk data loss during combined failures
```

### Detection Hints
```bash
# Check min.insync.replicas for all topics
kafka-configs.sh --describe --entity-type topics \
  --bootstrap-server localhost:9092 | grep min.insync.replicas

# Monitor ISR shrinkage
kafka-run-class.sh kafka.tools.JmxTool \
  --object-name kafka.server:type=ReplicaManager,name=UnderReplicatedPartitions \
  --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```

**Monitoring Alerts:**
- Alert when `min.insync.replicas < 2`
- Alert when `ISR size == min.insync.replicas` (operating at edge)
- Alert when `UnderReplicatedPartitions > 0`

---

## 3. Unclean Leader Election Enabled

### Pattern Name
**Unclean Leader Election - Data Loss Risk**

### Description
When `unclean.leader.election.enable=true`, Kafka allows an out-of-sync replica (not in ISR) to become leader if no in-sync replicas are available. This favors availability over durability and can result in message loss. While older Kafka versions defaulted to `true`, modern versions (≥0.11.0.0) default to `false`.

**Critical 2025 Bug:** In KRaft mode (Kafka 3.9.0 and 4.0.0), unclean leader election can occur even when `unclean.leader.election.enable=false` during partition reassignment if a non-ISR broker is promoted to leader while the current leader is simultaneously removed from the ISR.

### Bad Configuration Example
```properties
# Broker configuration - DANGEROUS for critical data
unclean.leader.election.enable=true

# Or topic-level override
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name my-topic \
  --add-config unclean.leader.election.enable=true \
  --bootstrap-server localhost:9092
```

**Managed Service Variance:**
- **Confluent Cloud**: Defaults to `false` (safe)
- **AWS MSK**: Defaults to `true` (dangerous - override required!)

### Good Configuration Example
```properties
# Broker configuration - Favor durability
unclean.leader.election.enable=false

# Topic-level enforcement
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name critical-orders \
  --add-config unclean.leader.election.enable=false \
  --bootstrap-server localhost:9092

# Combined with proper replication
default.replication.factor=3
min.insync.replicas=2
```

### Detection Hints
```bash
# Check broker-level configuration
kafka-configs.sh --describe --entity-type brokers \
  --entity-default \
  --bootstrap-server localhost:9092 | grep unclean.leader.election

# Check for unclean leader election events in logs
grep "Unclean leader election" /var/log/kafka/server.log

# Monitor metrics
kafka-run-class.sh kafka.tools.JmxTool \
  --object-name kafka.controller:type=ControllerStats,name=UncleanLeaderElectionsPerSec \
  --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```

**Monitoring Alerts:**
- Alert when `UncleanLeaderElectionsPerSec > 0`
- Alert when `unclean.leader.election.enable=true` on critical topics
- Alert on partition reassignment in KRaft mode (potential bug trigger)

**KRaft Mode Workaround (2025):**
- Avoid simultaneous partition reassignment + ISR changes
- Monitor for unclean elections even with config set to false
- Consider staying on ZooKeeper mode until KRaft bug is resolved

---

## 4. ISR Shrinkage Not Monitored

### Pattern Name
**Invisible ISR Degradation - Silent Failure Risk**

### Description
When replicas fall out of sync, the ISR shrinks. If ISR size equals `min.insync.replicas`, the cluster operates at the edge of availability - one more broker failure will cause write failures. Organizations often fail to monitor this critical metric, leading to unexpected outages during normal broker restarts or failures.

### Bad Practice Example
```yaml
# Monitoring configuration - INSUFFICIENT
alerts:
  - name: kafka_broker_down
    condition: up == 0
  # Missing ISR monitoring!
  # Missing URP monitoring!
```

**Risk Scenario:**
```
Initial State:
- Topic: payments, RF=3, min.insync.replicas=2
- ISR: [1, 2, 3] - Healthy

After Broker-3 Lags:
- ISR: [1, 2] - At minimum threshold (NO ALERT!)
- Cluster appears healthy

During Routine Restart of Broker-2:
- ISR: [1] - Below minimum
- Producer writes FAIL with NotEnoughReplicasException
- Business impact!
```

### Good Practice Example
```yaml
# Comprehensive Kafka monitoring
alerts:
  # ISR monitoring
  - name: kafka_isr_at_minimum
    condition: kafka_cluster_partition_insyncreplicascount == kafka_topic_min_insync_replicas
    severity: warning
    message: "Topic {{ $labels.topic }} partition {{ $labels.partition }} operating at minimum ISR"

  - name: kafka_isr_below_minimum
    condition: kafka_cluster_partition_insyncreplicascount < kafka_topic_min_insync_replicas
    severity: critical
    message: "Topic {{ $labels.topic }} partition {{ $labels.partition }} ISR below minimum!"

  # Under-replicated partitions
  - name: kafka_under_replicated_partitions
    condition: kafka_server_replicamanager_underreplicatedpartitions > 0
    severity: warning
    for: 5m
    message: "Cluster has {{ $value }} under-replicated partitions"

  # Offline partitions
  - name: kafka_offline_partitions
    condition: kafka_controller_kafkacontroller_offlinepartitionscount > 0
    severity: critical
    message: "Cluster has {{ $value }} offline partitions - DATA UNAVAILABLE"

  # ISR expansion/shrink rate
  - name: kafka_isr_shrinks_rate_high
    condition: rate(kafka_server_replicamanager_isrshrinkspersec_count[5m]) > 0
    severity: warning
    message: "High ISR shrink rate: {{ $value }}/sec - Investigate replica lag"
```

### Monitoring Dashboard Metrics
```prometheus
# Key metrics to visualize
kafka_cluster_partition_insyncreplicascount  # Per-partition ISR count
kafka_server_replicamanager_underreplicatedpartitions  # Should always be 0
kafka_controller_kafkacontroller_offlinepartitionscount  # Should always be 0
kafka_server_replicamanager_isrshrinkspersec  # ISR shrink rate
kafka_server_replicamanager_isrexpandspersec  # ISR expansion rate
kafka_cluster_partition_replicascount  # Total replicas per partition

# Consumer lag
kafka_consumergroup_lag  # Per consumer group lag
kafka_consumergroup_lag_seconds  # Time-based lag
```

### Detection Hints
```bash
# Check ISR status for all partitions
kafka-topics.sh --describe --bootstrap-server localhost:9092 | grep -E "Isr:|Replicas:"

# Find under-replicated partitions
kafka-topics.sh --describe --under-replicated-partitions \
  --bootstrap-server localhost:9092

# Monitor ISR shrink/expand events
grep "Shrinking ISR" /var/log/kafka/server.log
grep "Expanding ISR" /var/log/kafka/server.log

# Check replica lag
kafka-run-class.sh kafka.tools.JmxTool \
  --object-name kafka.server:type=FetcherLagMetrics,name=ConsumerLag,clientId=*,topic=*,partition=* \
  --jmx-url service:jmx:rmi:///jndi/rmi://localhost:9999/jmxrmi
```

---

## 5. Replica Imbalance Across Brokers

### Pattern Name
**Skewed Partition Distribution - Load Imbalance and Availability Risk**

### Description
Uneven distribution of partition replicas and leaders across brokers creates hotspots, reduces throughput, and increases unavailability during failures. Excessive partitions compound the problem by adding significant latency during replication and controller operations. When a broker fails, if it hosted thousands of partitions, the controller must elect new leaders for all of them, potentially freezing the cluster.

### Bad Configuration Example
```bash
# Creating topics without considering broker distribution
for i in {1..100}; do
  kafka-topics.sh --create --topic app-$i \
    --partitions 50 \
    --replication-factor 3 \
    --bootstrap-server localhost:9092
done
# Result: 5000 partitions, likely imbalanced

# Skewed partition key selection
# Producer code - BAD
Properties props = new Properties();
props.put("partitioner.class", "org.apache.kafka.clients.producer.internals.DefaultPartitioner");
// Using userId as key where userId=123 is a "power user" generating 80% of traffic
producer.send(new ProducerRecord<>("events", userId, event));
```

**Symptoms of Imbalance:**
- Disk usage varies 40%+ across brokers
- CPU/Network utilization highly uneven
- Some brokers process 3x more data than others
- Leader partitions concentrated on few brokers

### Good Configuration Example
```properties
# Broker configuration - Enable auto-balancing
auto.leader.rebalance.enable=true
leader.imbalance.per.broker.percentage=10
leader.imbalance.check.interval.seconds=300

# Partition assignment strategy
partition.assignment.strategy=org.apache.kafka.clients.consumer.RangeAssignor,\
  org.apache.kafka.clients.consumer.RoundRobinAssignor
```

```bash
# Periodic rebalancing using kafka-reassign-partitions
# 1. Generate reassignment plan
kafka-reassign-partitions.sh --bootstrap-server localhost:9092 \
  --topics-to-move-json-file topics.json \
  --broker-list "1,2,3,4,5" \
  --generate

# 2. Execute reassignment
kafka-reassign-partitions.sh --bootstrap-server localhost:9092 \
  --reassignment-json-file reassignment.json \
  --execute

# 3. Verify completion
kafka-reassign-partitions.sh --bootstrap-server localhost:9092 \
  --reassignment-json-file reassignment.json \
  --verify

# Use Cruise Control for automated continuous rebalancing
# Cruise Control provides intelligent rebalancing based on:
# - Disk usage
# - Network I/O
# - CPU utilization
# - Leader distribution
```

### Partition Sizing Best Practices
```properties
# Conservative partition count calculation
# partitions = max(t/p, t/c)
# where:
#   t = target throughput (MB/s)
#   p = max producer throughput per partition (MB/s)
#   c = max consumer throughput per partition (MB/s)

# Example: 100 MB/s target, 10 MB/s per partition
# partitions = 100/10 = 10 partitions

# Avoid over-partitioning
# Bad: 1000 partitions for 10 MB/s throughput
# Good: 10-20 partitions for 10 MB/s throughput
```

### Detection Hints
```bash
# Check partition distribution across brokers
kafka-topics.sh --describe --bootstrap-server localhost:9092 | \
  awk '{print $4}' | grep "Leader:" | awk -F: '{print $2}' | sort | uniq -c

# Check leader imbalance
kafka-broker-api-versions.sh --bootstrap-server localhost:9092 | \
  while read broker; do
    echo "=== Broker $broker ==="
    kafka-log-dirs.sh --describe --bootstrap-server localhost:9092 \
      --broker-list $broker | grep "Leader" | wc -l
  done

# Monitor broker disk usage variance
df -h /kafka-logs-* | awk '{print $5}' | sort -n

# Check for skewed partition sizes
kafka-log-dirs.sh --describe --bootstrap-server localhost:9092 | \
  jq '.brokers[].logDirs[].partitions[] | {partition, size}' | \
  sort -k2 -n
```

**Monitoring Metrics:**
```prometheus
# Partition distribution metrics
kafka_server_replicamanager_partitioncount  # Per broker
kafka_server_replicamanager_leadercount  # Leader count per broker
kafka_log_log_size  # Partition size distribution

# Alerts
- Alert when partition count variance > 20% across brokers
- Alert when leader count variance > 15% across brokers
- Alert when single broker handles > 40% of total load
- Alert when partition count > 4000 per broker
```

---

## 6. MirrorMaker2 Cycles and Duplications

### Pattern Name
**Bidirectional Replication Loops - Infinite Message Cycles**

### Description
In multi-datacenter active-active setups, MirrorMaker2 (MM2) can create replication cycles where messages replicate back and forth infinitely between clusters. Without proper configuration, a message written to Cluster A gets replicated to Cluster B, which then replicates it back to Cluster A, creating an infinite loop. MM2's topic prefixing mechanism is designed to prevent this, but misconfiguration can still cause issues.

### Bad Configuration Example
```properties
# mm2.properties - DANGEROUS: Removes cluster prefix
replication.policy.class=org.apache.kafka.connect.mirror.IdentityReplicationPolicy

# Source cluster A
clusters = clusterA, clusterB
clusterA.bootstrap.servers = kafka-a:9092
clusterB.bootstrap.servers = kafka-b:9092

# Bidirectional replication without prefixes
clusterA->clusterB.enabled = true
clusterB->clusterA.enabled = true
clusterA->clusterB.topics = orders
clusterB->clusterA.topics = orders

# Result: orders topic cycles infinitely between clusters!
```

**Cycle Scenario:**
```
Time T0:
  ClusterA: orders topic (message M1)

Time T1:
  ClusterA: orders (M1)
  ClusterB: orders (M1) - replicated from A

Time T2:
  ClusterA: orders (M1, M1-from-B) - DUPLICATE!
  ClusterB: orders (M1, M1-from-A) - DUPLICATE!

Time T3: Infinite loop...
```

### Good Configuration Example
```properties
# mm2.properties - Safe bidirectional replication

# Use default replication policy (adds cluster prefix)
replication.policy.class=org.apache.kafka.connect.mirror.DefaultReplicationPolicy

# Cluster definitions
clusters = us-east, us-west
us-east.bootstrap.servers = kafka-east:9092
us-west.bootstrap.servers = kafka-west:9092

# Bidirectional replication with prefixes
us-east->us-west.enabled = true
us-west->us-east.enabled = true

# Whitelist patterns (excludes prefixed topics)
us-east->us-west.topics = ^(?!us-west\\.).*
us-west->us-east.topics = ^(?!us-east\\.).*

# Topic naming result:
# us-east cluster: orders, us-west.orders
# us-west cluster: orders, us-east.orders
# No cycles because prefixed topics are excluded!

# Offset sync configuration
us-east->us-west.sync.group.offsets.enabled = true
us-east->us-west.sync.group.offsets.interval.seconds = 60
us-east->us-west.emit.checkpoints.enabled = true
us-east->us-west.emit.checkpoints.interval.seconds = 60
```

### Advanced: Consumer Offset Translation
```properties
# MM2 critical limitation: min.insync.replicas always set to 1
# in destination topics regardless of source config

# Workaround: Manually override after replication
kafka-configs.sh --alter \
  --entity-type topics \
  --entity-name us-east.orders \
  --add-config min.insync.replicas=2 \
  --bootstrap-server kafka-west:9092

# Consumer offset sync (enables failover)
checkpoints.topic.replication.factor = 3
offset-syncs.topic.replication.factor = 3
sync.group.offsets.enabled = true
sync.group.offsets.interval.seconds = 60

# Consumer must use RemoteClusterUtils for failover
# Java example:
import org.apache.kafka.connect.mirror.RemoteClusterUtils;

Map<TopicPartition, OffsetAndMetadata> translatedOffsets =
  RemoteClusterUtils.translateOffsets(
    sourceAdminClient,
    targetAdminClient,
    "us-west",  // Target cluster
    "my-consumer-group",
    Duration.ofSeconds(60)
  );
```

### Detection Hints
```bash
# Check for replicated topics on each cluster
kafka-topics.sh --list --bootstrap-server kafka-east:9092 | grep "\\."
kafka-topics.sh --list --bootstrap-server kafka-west:9092 | grep "\\."

# Monitor for message count anomalies (exponential growth indicates cycles)
kafka-run-class.sh kafka.tools.GetOffsetShell \
  --broker-list kafka-east:9092 \
  --topic orders | awk -F: '{sum+=$3} END {print sum}'

# Check MM2 connector status
curl -s http://mm2-worker:8083/connectors | jq

# Monitor for duplicate message IDs in application logs
# Application-level deduplication required!

# Check replication policy in use
kafka-configs.sh --describe --entity-type topics \
  --entity-name us-east.orders \
  --bootstrap-server kafka-west:9092 | grep replication.policy

# Monitor MM2 lag metrics
kafka-consumer-groups.sh --describe \
  --group mirrormaker2-cluster \
  --bootstrap-server kafka-east:9092
```

**Monitoring Alerts:**
```yaml
- name: mm2_replication_lag_high
  condition: kafka_connect_mirror_source_connector_replication_latency_ms_max > 60000
  severity: warning

- name: mm2_checkpoint_sync_failure
  condition: rate(kafka_connect_mirror_checkpoint_connector_checkpoint_failure_total[5m]) > 0
  severity: critical

- name: duplicate_message_ids_detected
  # Application-level metric
  condition: rate(app_duplicate_message_count[5m]) > 10
  severity: warning

- name: topic_growth_anomaly
  condition: deriv(kafka_log_log_size[1h]) > 2 * avg_over_time(deriv(kafka_log_log_size[24h])[7d:1h])
  severity: warning
  message: "Unusual topic growth - possible replication cycle"
```

---

## 7. Failover Without Offset Sync

### Pattern Name
**Blind Failover - Duplicate/Lost Messages**

### Description
During disaster recovery failover from primary to secondary datacenter, if consumer offsets are not synchronized, consumers either restart from beginning (duplicates), from latest (data loss), or fail entirely. Unlike Confluent's Multi-Region Clusters (MRC) which preserve offsets, standard MirrorMaker2 requires explicit offset translation. Without proper offset sync, failover causes confusion about which messages have been processed.

### Bad Practice Example
```properties
# mm2.properties - Missing offset sync
clusters = primary, secondary
primary.bootstrap.servers = kafka-primary:9092
secondary.bootstrap.servers = kafka-secondary:9092

primary->secondary.enabled = true
primary->secondary.topics = .*

# MISSING: No offset sync configuration!
# sync.group.offsets.enabled not set
# emit.checkpoints.enabled not set

# Consumer failover script - DANGEROUS
#!/bin/bash
# Manual failover without offset translation
kubectl scale deployment myapp --replicas=0  # Stop in primary
kubectl --context=secondary scale deployment myapp --replicas=5  # Start in secondary
# Consumers start from latest or earliest - DATA LOSS or DUPLICATES!
```

**Failure Scenario:**
```
Before Failover:
  Primary Cluster:
    Topic: orders, Offset: 15000
    Consumer Group: payment-processor, Committed Offset: 15000
  Secondary Cluster:
    Topic: primary.orders, Offset: 14950 (50 messages behind)
    Consumer Group: payment-processor - NO OFFSETS!

After Failover (without offset sync):
  Application connects to secondary cluster
  No offset found for payment-processor
  Options:
    1. auto.offset.reset=earliest → Reprocess 14950 messages (DUPLICATES)
    2. auto.offset.reset=latest → Skip 50 messages (DATA LOSS)
    3. auto.offset.reset=none → Consumer fails (OUTAGE)
```

### Good Practice Example
```properties
# mm2.properties - Complete offset sync configuration
clusters = primary, dr
primary.bootstrap.servers = kafka-primary:9092
dr.bootstrap.servers = kafka-dr:9092

# Data replication
primary->dr.enabled = true
primary->dr.topics = orders, payments, inventory

# Offset sync - CRITICAL for failover
primary->dr.sync.group.offsets.enabled = true
primary->dr.sync.group.offsets.interval.seconds = 30
primary->dr.emit.checkpoints.enabled = true
primary->dr.emit.checkpoints.interval.seconds = 30

# Increase replication factors for offset topics
offset-syncs.topic.replication.factor = 3
checkpoints.topic.replication.factor = 3

# Consumer group filtering (optional)
primary->dr.groups = payment-processor, order-service, inventory-updater
primary->dr.groups.exclude = test-.*, dev-.*

# Topic configuration sync (but note min.isr limitation)
sync.topic.configs.enabled = true
```

```java
// Consumer application - Offset translation for failover
import org.apache.kafka.connect.mirror.RemoteClusterUtils;
import org.apache.kafka.clients.admin.AdminClient;

public class FailoverAwareConsumer {

    public void failoverToSecondaryCluster() {
        String primaryCluster = "primary";
        String secondaryCluster = "dr";
        String consumerGroup = "payment-processor";

        try (AdminClient primaryAdmin = AdminClient.create(primaryConfig);
             AdminClient secondaryAdmin = AdminClient.create(secondaryConfig)) {

            // Translate offsets from primary to secondary
            Map<TopicPartition, OffsetAndMetadata> translatedOffsets =
                RemoteClusterUtils.translateOffsets(
                    primaryAdmin,
                    secondaryAdmin,
                    secondaryCluster,
                    consumerGroup,
                    Duration.ofSeconds(60)
                );

            // Create consumer with translated offsets
            KafkaConsumer<String, String> consumer = new KafkaConsumer<>(secondaryConfig);
            consumer.assign(translatedOffsets.keySet());

            // Seek to translated offsets
            for (Map.Entry<TopicPartition, OffsetAndMetadata> entry : translatedOffsets.entrySet()) {
                consumer.seek(entry.getKey(), entry.getValue().offset());
            }

            logger.info("Failover complete with offset translation: {}", translatedOffsets);

            // Resume processing
            while (true) {
                ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
                processRecords(records);
                consumer.commitSync();
            }
        }
    }
}
```

```bash
# Automated failover script with offset verification
#!/bin/bash
set -e

PRIMARY_BOOTSTRAP="kafka-primary:9092"
DR_BOOTSTRAP="kafka-dr:9092"
CONSUMER_GROUP="payment-processor"

echo "Starting failover for consumer group: $CONSUMER_GROUP"

# 1. Verify MM2 offset sync is current
SYNC_LAG=$(kafka-consumer-groups.sh \
  --bootstrap-server $DR_BOOTSTRAP \
  --describe --group mirrormaker2-cluster \
  --offsets | awk '{print $5}' | paste -sd+ | bc)

if [ "$SYNC_LAG" -gt 100 ]; then
  echo "ERROR: MM2 offset sync lag too high: $SYNC_LAG"
  exit 1
fi

# 2. Verify checkpoint topic exists and is current
kafka-topics.sh --list --bootstrap-server $DR_BOOTSTRAP | \
  grep "mm2-offset-syncs.primary.internal" || {
  echo "ERROR: Offset sync topic not found in DR cluster"
  exit 1
}

# 3. Stop consumers in primary DC
kubectl scale deployment payment-processor --replicas=0

# 4. Wait for in-flight processing to complete
sleep 30

# 5. Verify final offset sync
FINAL_OFFSET_PRIMARY=$(kafka-consumer-groups.sh \
  --bootstrap-server $PRIMARY_BOOTSTRAP \
  --describe --group $CONSUMER_GROUP \
  --offsets | awk '{sum+=$3} END {print sum}')

echo "Final offset in primary: $FINAL_OFFSET_PRIMARY"

# 6. Start consumers in DR DC with offset translation
kubectl --context=dr scale deployment payment-processor --replicas=5

# 7. Verify consumers picked up correct offsets
sleep 10
OFFSET_DR=$(kafka-consumer-groups.sh \
  --bootstrap-server $DR_BOOTSTRAP \
  --describe --group $CONSUMER_GROUP \
  --offsets | awk '{sum+=$3} END {print sum}')

echo "Offset in DR after failover: $OFFSET_DR"
echo "Failover complete!"
```

### Detection Hints
```bash
# Check if offset sync is enabled in MM2
curl -s http://mm2-worker:8083/connectors/mm2-offset-sync/config | \
  jq '.["sync.group.offsets.enabled"]'

# Verify offset sync topics exist
kafka-topics.sh --list --bootstrap-server kafka-dr:9092 | \
  grep -E "mm2-offset-syncs|checkpoint"

# Check offset sync lag
kafka-consumer-groups.sh --describe \
  --group mirrormaker2-cluster \
  --bootstrap-server kafka-dr:9092 \
  --offsets

# Verify consumer group offsets exist in DR cluster
kafka-consumer-groups.sh --list \
  --bootstrap-server kafka-dr:9092 | grep payment-processor

# Monitor offset sync latency
curl -s http://mm2-worker:8083/connectors/mm2-checkpoint-connector/status | \
  jq '.tasks[].trace'

# Test offset translation before actual failover
kafka-run-class.sh org.apache.kafka.connect.mirror.RemoteClusterUtils \
  --primary-bootstrap kafka-primary:9092 \
  --secondary-bootstrap kafka-dr:9092 \
  --consumer-group payment-processor
```

**Monitoring Alerts:**
```yaml
- name: mm2_offset_sync_disabled
  condition: kafka_connect_mirror_checkpoint_connector_offset_sync_enabled == 0
  severity: critical
  message: "MM2 offset sync is disabled - failover will fail!"

- name: mm2_checkpoint_lag_high
  condition: kafka_connect_mirror_checkpoint_connector_lag_ms > 300000
  severity: warning
  message: "MM2 checkpoint lag > 5 minutes"

- name: offset_sync_topic_missing
  condition: absent(kafka_log_log_size{topic=~"mm2-offset-syncs.*"})
  severity: critical
  message: "MM2 offset sync topic not found in DR cluster"

- name: consumer_group_offsets_missing_in_dr
  # Custom script to check consumer groups in both clusters
  condition: consumer_groups_in_primary - consumer_groups_in_dr > 0
  severity: warning
  message: "Consumer groups exist in primary but not synced to DR"
```

### Advanced: Active-Active Offset Sync (Agoda Pattern)
```yaml
# Enhanced MM2 configuration for bidirectional offset sync
# Based on Agoda's two-way failover system

clusters = east, west

# Bidirectional data replication
east->west.enabled = true
west->east.enabled = true

# Always-on two-way offset sync
east->west.sync.group.offsets.enabled = true
west->east.sync.group.offsets.enabled = true

# Continuous checkpoint emission
east->west.emit.checkpoints.enabled = true
west->east.emit.checkpoints.enabled = true

# Persistent offset translation records
# Allows consumers to translate offsets in either direction
east->west.emit.offset.syncs.enabled = true
west->east.emit.offset.syncs.enabled = true

# Offset sync interval (trade-off: frequency vs overhead)
offset.sync.interval.seconds = 10

# Application-level deduplication required
# Use message IDs or idempotent processing
```

---

## 8. Active-Active Replication Conflicts

### Pattern Name
**Active-Active Data Conflicts - Inconsistent State Across Regions**

### Description
In active-active geo-replication setups where both datacenters accept writes, conflicting updates to the same logical entity can occur in different regions simultaneously. Without conflict resolution strategies, last-write-wins based on timestamps can lead to data inconsistency, lost updates, and business logic violations. This is compounded by the "dual writes" anti-pattern where producers write to multiple clusters.

### Bad Configuration Example
```java
// Producer code - DUAL WRITES ANTI-PATTERN
public class MultiRegionProducer {
    private KafkaProducer<String, Order> eastProducer;
    private KafkaProducer<String, Order> westProducer;

    public void placeOrder(Order order) {
        // Writing to both clusters directly - NO CONSISTENCY GUARANTEE!
        eastProducer.send(new ProducerRecord<>("orders", order.getId(), order));
        westProducer.send(new ProducerRecord<>("orders", order.getId(), order));

        // Problems:
        // 1. What if eastProducer succeeds but westProducer fails?
        // 2. No ordering guarantee between clusters
        // 3. Network partitions cause divergence
        // 4. Race conditions on same order ID
    }
}
```

```properties
# mm2.properties - No conflict detection
clusters = east, west
east->west.enabled = true
west->east.enabled = true

# Both clusters accept writes on same topic
# No conflict resolution strategy
# Topic: orders exists in both east and west
# Result: Conflicting updates propagate back and forth
```

**Conflict Scenario:**
```
T0: Customer in East region updates order #123: {status: "shipped", address: "NY"}
    Customer in West region updates order #123: {status: "cancelled", refund: true}

T1: East cluster: order #123 = {status: "shipped", address: "NY"}
    West cluster: order #123 = {status: "cancelled", refund: true}

T2: MM2 replication occurs
    East cluster receives West update: {status: "cancelled", refund: true}
    West cluster receives East update: {status: "shipped", address: "NY"}

T3: Conflict! Which version wins?
    - Last-write-wins by timestamp? Depends on clock sync!
    - Merge both updates? {status: ???, address: "NY", refund: true}
    - Manual reconciliation required?

Business Impact:
    - Package shipped but order shows cancelled
    - Customer charged twice or not at all
    - Inventory count incorrect
```

### Good Practice Example

#### Pattern 1: Active-Passive with Regional Routing
```properties
# Route writes to designated primary regions per topic/partition
# mm2.properties
clusters = east, west

# Unidirectional replication
east->west.enabled = true
east->west.topics = orders, payments  # East is primary for these topics

west->east.enabled = true
west->east.topics = inventory, shipping  # West is primary for these topics

# Application routing logic ensures writes go to correct region
```

```java
// Application code - Regional write routing
public class RegionalProducer {
    private Map<String, KafkaProducer<String, ?>> regionalProducers;
    private Map<String, String> topicPrimaryRegion;

    public RegionalProducer() {
        topicPrimaryRegion.put("orders", "east");
        topicPrimaryRegion.put("payments", "east");
        topicPrimaryRegion.put("inventory", "west");
        topicPrimaryRegion.put("shipping", "west");
    }

    public <V> void send(String topic, String key, V value) {
        String primaryRegion = topicPrimaryRegion.get(topic);
        KafkaProducer<String, V> producer = regionalProducers.get(primaryRegion);

        producer.send(new ProducerRecord<>(topic, key, value), (metadata, exception) -> {
            if (exception != null) {
                // Failover logic: try alternate region
                handleFailover(topic, key, value, primaryRegion);
            }
        });
    }
}
```

#### Pattern 2: Partition-Level Affinity (Geographic Sharding)
```java
// Custom partitioner for regional affinity
public class RegionalPartitioner implements Partitioner {
    private static final Set<String> EAST_REGIONS = Set.of("US-EAST", "EU");
    private static final Set<String> WEST_REGIONS = Set.of("US-WEST", "ASIA");

    @Override
    public int partition(String topic, Object key, byte[] keyBytes,
                        Object value, byte[] valueBytes, Cluster cluster) {
        Order order = (Order) value;
        String region = order.getRegion();

        int numPartitions = cluster.partitionCountForTopic(topic);
        int halfPartitions = numPartitions / 2;

        // East regions use partitions 0 to N/2
        if (EAST_REGIONS.contains(region)) {
            return Math.abs(key.hashCode()) % halfPartitions;
        }
        // West regions use partitions N/2 to N
        else {
            return halfPartitions + (Math.abs(key.hashCode()) % halfPartitions);
        }
    }
}

// MM2 configuration - replicate but preserve regional writes
// partitions 0-499: East writes only (replicated to West as read-only)
// partitions 500-999: West writes only (replicated to East as read-only)
```

#### Pattern 3: Event Sourcing with Conflict-Free Replicated Data Types (CRDTs)
```java
// Use CRDTs for mergeable updates
public class OrderEvent {
    private String orderId;
    private String eventId;  // Unique event ID
    private long timestamp;
    private String region;  // Origin region
    private EventType type;  // ORDER_PLACED, STATUS_UPDATED, etc.
    private Map<String, Object> payload;
}

public class OrderStateMachine {
    // Deterministic merge logic
    public Order merge(Order eastVersion, Order westVersion) {
        // Combine events from both regions, sort by timestamp
        List<OrderEvent> allEvents = new ArrayList<>();
        allEvents.addAll(eastVersion.getEvents());
        allEvents.addAll(westVersion.getEvents());
        allEvents.sort(Comparator.comparingLong(OrderEvent::getTimestamp));

        // Replay events to build consistent final state
        Order merged = new Order();
        for (OrderEvent event : allEvents) {
            merged.apply(event);
        }
        return merged;
    }
}
```

#### Pattern 4: Logical Clock (Vector Clocks)
```java
// Track causality with vector clocks
public class VersionedOrder {
    private String orderId;
    private Order data;
    private Map<String, Long> vectorClock;  // {east: 5, west: 3}

    public ConflictResolution detectConflict(VersionedOrder other) {
        boolean thisDescendsFromOther = descendsFrom(this.vectorClock, other.vectorClock);
        boolean otherDescendsFromThis = descendsFrom(other.vectorClock, this.vectorClock);

        if (thisDescendsFromOther) {
            return ConflictResolution.USE_THIS;  // This is newer
        } else if (otherDescendsFromThis) {
            return ConflictResolution.USE_OTHER;  // Other is newer
        } else {
            return ConflictResolution.CONCURRENT_CONFLICT;  // Need manual resolution
        }
    }

    private boolean descendsFrom(Map<String, Long> a, Map<String, Long> b) {
        return a.entrySet().stream()
            .allMatch(entry -> entry.getValue() >= b.getOrDefault(entry.getKey(), 0L));
    }
}
```

#### Pattern 5: Application-Level Deduplication
```properties
# Enable idempotent producer
enable.idempotence=true
max.in.flight.requests.per.connection=5
acks=all
retries=2147483647

# Message format with deduplication ID
{
  "messageId": "uuid-v4-or-snowflake-id",
  "producerId": "producer-instance-id",
  "timestamp": 1702300000000,
  "region": "east",
  "data": { ... }
}
```

```java
// Consumer deduplication using Redis/distributed cache
public class DeduplicatingConsumer {
    private RedisTemplate<String, String> redis;

    public void processMessage(ConsumerRecord<String, Order> record) {
        String messageId = record.value().getMessageId();
        String dedupeKey = "processed:" + messageId;

        // Atomic check-and-set with TTL
        Boolean wasAbsent = redis.opsForValue()
            .setIfAbsent(dedupeKey, "1", Duration.ofDays(7));

        if (Boolean.TRUE.equals(wasAbsent)) {
            // First time seeing this message
            processOrder(record.value());
        } else {
            // Duplicate detected - skip processing
            logger.warn("Duplicate message detected: {}", messageId);
            metrics.increment("messages.duplicates");
        }
    }
}
```

### Detection Hints
```bash
# Monitor for duplicate message IDs across regions
# Requires application-level instrumentation
curl -s http://app-metrics:8080/metrics | grep message_duplicates

# Check for bidirectional replication on same topics
kafka-topics.sh --list --bootstrap-server kafka-east:9092 | sort > /tmp/east-topics
kafka-topics.sh --list --bootstrap-server kafka-west:9092 | sort > /tmp/west-topics

# Find topics that exist without cluster prefix in both regions (conflict risk!)
comm -12 /tmp/east-topics /tmp/west-topics | grep -v "^east\\." | grep -v "^west\\."

# Monitor replication lag variance (high variance indicates conflicts)
kafka-consumer-groups.sh --describe \
  --group mirrormaker2-cluster \
  --bootstrap-server kafka-east:9092 | \
  awk '{print $5}' | awk '{s+=$1; ss+=$1*$1; n++} END {print sqrt(ss/n - (s/n)^2)}'

# Check for high update rates on same keys in different regions
# Requires application-level logging
grep "concurrent_update_detected" /var/log/app.log | \
  awk '{print $5}' | sort | uniq -c | sort -rn | head

# Monitor clock skew between regions (affects LWW conflict resolution)
ntpq -p kafka-east-broker
ntpq -p kafka-west-broker
```

**Monitoring Alerts:**
```yaml
- name: potential_write_conflict_detected
  # Application-level metric
  condition: rate(app_concurrent_updates_same_key[5m]) > 1
  severity: warning
  message: "Concurrent updates detected for {{ $labels.key }} in multiple regions"

- name: duplicate_message_rate_high
  condition: rate(app_duplicate_messages_total[5m]) > 100
  severity: warning
  message: "High duplicate message rate: {{ $value }}/s"

- name: clock_skew_between_regions
  condition: abs(kafka_broker_timestamp_east - kafka_broker_timestamp_west) > 5000
  severity: critical
  message: "Clock skew > 5s between regions - LWW conflict resolution unreliable"

- name: bidirectional_replication_without_prefix
  # Custom check for topics without cluster prefix
  condition: topics_without_prefix_in_both_clusters > 0
  severity: critical
  message: "{{ $value }} topics lack cluster prefix - conflict risk!"

- name: mm2_replication_cycle_suspected
  condition: rate(kafka_log_log_size[1h]) > 2 * avg_over_time(rate(kafka_log_log_size[1h])[7d])
  severity: warning
  message: "Unusual topic growth rate - possible replication cycle"
```

---

## Summary: Detection and Prevention Checklist

### Pre-Production Checklist
- [ ] All topics have `replication.factor >= 3`
- [ ] All topics have `min.insync.replicas >= 2`
- [ ] `unclean.leader.election.enable=false` for critical topics
- [ ] Monitoring configured for ISR, URP, offline partitions
- [ ] Partition count is reasonable (< 4000 per broker)
- [ ] Replica distribution balanced across brokers
- [ ] MirrorMaker2 uses `DefaultReplicationPolicy` (cluster prefixes)
- [ ] MM2 offset sync enabled: `sync.group.offsets.enabled=true`
- [ ] MM2 checkpoint emission enabled: `emit.checkpoints.enabled=true`
- [ ] Active-active conflicts addressed with proper patterns
- [ ] Application implements idempotent processing
- [ ] Deduplication strategy in place for multi-region
- [ ] DR failover playbook documented and tested
- [ ] Clock synchronization (NTP) configured across all brokers

### Monitoring Dashboard Metrics
```prometheus
# Critical metrics to visualize
kafka_cluster_partition_insyncreplicascount
kafka_server_replicamanager_underreplicatedpartitions
kafka_controller_kafkacontroller_offlinepartitionscount
kafka_server_replicamanager_isrshrinkspersec
kafka_controller_controllerstat_uncleanleaderelectionspersec
kafka_server_replicamanager_partitioncount
kafka_server_replicamanager_leadercount
kafka_connect_mirror_source_connector_replication_latency_ms
kafka_connect_mirror_checkpoint_connector_checkpoint_latency_ms
kafka_consumergroup_lag
```

### Automated Testing
```bash
# Chaos engineering tests
# 1. Kill single broker - verify no data loss, writes continue
# 2. Kill min.isr-1 brokers - verify writes continue
# 3. Kill min.isr brokers - verify writes fail gracefully
# 4. Partition network - verify no split-brain
# 5. Failover to DR - verify offset translation works
# 6. Clock skew simulation - verify conflict resolution
# 7. MM2 worker failure - verify automatic recovery
```

---

## References

### Sources
- [Kafka Replication: Concept & Best Practices](https://www.automq.com/blog/kafka-replication-concepts-best-practices)
- [Kafka ISR, High Watermark & Leader Epoch - Deep Dive Guide](https://shayne007.github.io/2025/06/09/Kafka-ISR-High-Watermark-Leader-Epoch-Deep-Dive-Guide/)
- [Understanding in-sync replicas and replication factor in Confluent Stretched Cluster](https://softwaremill.com/understanding-in-sync-replicas-and-replication-factor-in-confluent-stretched-cluster-2-5/)
- [Kafka Unclean Leader Election](https://medium.com/lydtech-consulting/kafka-unclean-leader-election-13ac8018f176)
- [Kafka Anti-Patterns: Common Pitfalls and How to Avoid Them](https://medium.com/@shailendrasinghpatil/kafka-anti-patterns-common-pitfalls-and-how-to-avoid-them-833cdcf2df89)
- [Apache Kafka Anti-Patterns and How To Avoid Them](https://www.instaclustr.com/blog/apache-kafka-anti-patterns/)
- [Kafka monitoring: Key metrics and 5 tools to know in 2025](https://www.instaclustr.com/education/apache-kafka/kafka-monitoring-key-metrics-and-5-tools-to-know-in-2025/)
- [Taming MirrorMaker2](https://lenses.io/blog/kafka-replication-taming-mirrormaker)
- [Increase Apache Kafka's resiliency with a multi-Region deployment and MirrorMaker 2](https://aws.amazon.com/blogs/big-data/increase-apache-kafkas-resiliency-with-a-multi-region-deployment-and-mirrormaker-2/)
- [Agoda Handles Kafka Consumer Failover Across Data Centers](https://www.infoq.com/news/2025/08/agoda-kafka-failover/)
- [Kafka's Approach to Multi-Region Streaming](https://streamnative.io/blog/kafkas-approach-to-multi-region-streaming/)
- [Active-Passive vs. Active-Active: A Comparison of Kafka Replication Topologies](https://www.automq.com/blog/kafka-replication-topologies-active-passive-vs-active-active)

### Additional Resources
- [Confluent Kafka Replication Documentation](https://docs.confluent.io/kafka/design/replication.html)
- [Best Practices for Kafka Production Deployments](https://docs.confluent.io/platform/current/kafka/post-deployment.html)
- [KIP-382: MirrorMaker 2.0](https://cwiki.apache.org/confluence/display/KAFKA/KIP-382:+MirrorMaker+2.0)
- [KIP-106: Change Default unclean.leader.election.enabled from True to False](https://cwiki.apache.org/confluence/display/KAFKA/KIP-106+-+Change+Default+unclean.leader.election.enabled+from+True+to+False)
