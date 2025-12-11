# Kafka Offset and Commit Anti-patterns

This document catalogs common anti-patterns and bugs related to Kafka consumer offset management and commit strategies.

## Table of Contents
1. [Commit Before Processing (Unintended At-Most-Once)](#1-commit-before-processing-unintended-at-most-once)
2. [Auto-Commit with Slow Processing](#2-auto-commit-with-slow-processing)
3. [Incomplete Processing Before Next Poll](#3-incomplete-processing-before-next-poll)
4. [Async Commit Without Error Handling](#4-async-commit-without-error-handling)
5. [Manual Commit Without Proper Error Handling](#5-manual-commit-without-proper-error-handling)
6. [Missing Rebalance Listener Commits](#6-missing-rebalance-listener-commits)
7. [Broken Exactly-Once by Improper Transaction Usage](#7-broken-exactly-once-by-improper-transaction-usage)
8. [Non-Idempotent Processing with At-Least-Once](#8-non-idempotent-processing-with-at-least-once)
9. [Offset Reset Policy Misunderstanding](#9-offset-reset-policy-misunderstanding)
10. [Mixing Sync and Async Commits Incorrectly](#10-mixing-sync-and-async-commits-incorrectly)

---

## 1. Commit Before Processing (Unintended At-Most-Once)

### Description
Committing offsets immediately after polling but before processing messages results in at-most-once semantics. If the consumer crashes during message processing, those messages are permanently lost because Kafka believes they were already processed.

### Impact
- Message loss on consumer crashes
- Unintended at-most-once delivery when at-least-once or exactly-once is required
- Difficult to debug data loss issues

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");  // Manual commit enabled
props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    // ⚠️ ANTI-PATTERN: Committing BEFORE processing
    consumer.commitSync();

    // If this processing fails or crashes, messages are lost forever!
    for (ConsumerRecord<String, String> record : records) {
        processOrder(record.value());  // Any failure here = data loss
    }
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

for message in consumer:
    # ⚠️ ANTI-PATTERN: Committing BEFORE processing
    consumer.commit()

    # If this processing fails, message is lost!
    process_order(message.value)
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");
props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("orders"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    // ✅ Process messages FIRST
    for (ConsumerRecord<String, String> record : records) {
        try {
            processOrder(record.value());
        } catch (Exception e) {
            // Handle error - decide whether to skip or retry
            logger.error("Failed to process order: " + record.value(), e);
            // Don't commit if processing fails
            continue;
        }
    }

    // ✅ Commit AFTER successful processing
    consumer.commitSync();
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

for message in consumer:
    try:
        # ✅ Process message FIRST
        process_order(message.value)

        # ✅ Commit AFTER successful processing
        consumer.commit()
    except Exception as e:
        # Handle error - message will be reprocessed
        logger.error(f"Failed to process order: {message.value}", exc_info=e)
        # Don't commit on failure
```

### Detection Hints

```bash
# Grep patterns to detect this anti-pattern
grep -n "commitSync()" file.java | grep -B5 "poll("
grep -n "commit()" file.py | grep -B5 "consumer:"
grep -n "consumer.commit" file.py | grep -B3 "for message in"

# Look for commits happening before processing loops
rg "commit(Sync|Async)?\(\)" -A5 -B5 | grep -E "(poll|for.*record)"
```

### Configuration Checks

```bash
# Check if manual commit is enabled (required for this pattern)
grep -E "enable\.auto\.commit.*false" config.properties
```

---

## 2. Auto-Commit with Slow Processing

### Description
Using auto-commit (default behavior) with slow message processing creates a window where offsets are committed before messages finish processing. If the consumer crashes after auto-commit but before processing completes, messages are lost.

### Impact
- Message loss with slow processing pipelines
- Duplicate processing if crash occurs before auto-commit interval
- Unpredictable behavior based on timing

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
// ⚠️ ANTI-PATTERN: Using default auto-commit with slow processing
props.put("enable.auto.commit", "true");  // Default
props.put("auto.commit.interval.ms", "5000");  // Commits every 5 seconds
props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("images"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        // ⚠️ This takes 30 seconds per image!
        // Auto-commit happens every 5 seconds, potentially committing before processing finishes
        processLargeImage(record.value());  // Slow operation
    }
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer
import time

consumer = KafkaConsumer(
    'images',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    # ⚠️ ANTI-PATTERN: Auto-commit enabled (default) with slow processing
    enable_auto_commit=True,
    auto_commit_interval_ms=5000
)

for message in consumer:
    # ⚠️ This takes 30 seconds!
    # Auto-commit may happen before processing completes
    process_large_image(message.value)
    time.sleep(30)  # Simulating slow processing
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
// ✅ Disable auto-commit for slow processing
props.put("enable.auto.commit", "false");
props.put("key.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");
props.put("value.deserializer", "org.apache.kafka.common.serialization.StringDeserializer");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("images"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        try {
            // ✅ Process slow operation
            processLargeImage(record.value());

            // ✅ Commit only after successful processing
            consumer.commitSync(Collections.singletonMap(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            ));
        } catch (Exception e) {
            logger.error("Failed to process image", e);
            // Don't commit - message will be reprocessed
        }
    }
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer, TopicPartition, OffsetAndMetadata
import time

consumer = KafkaConsumer(
    'images',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    # ✅ Disable auto-commit for control
    enable_auto_commit=False
)

for message in consumer:
    try:
        # ✅ Process slow operation
        process_large_image(message.value)

        # ✅ Commit only after successful processing
        tp = TopicPartition(message.topic, message.partition)
        consumer.commit({tp: OffsetAndMetadata(message.offset + 1, None)})
    except Exception as e:
        logger.error(f"Failed to process image", exc_info=e)
        # Don't commit - message will be reprocessed
```

### Detection Hints

```bash
# Check for auto-commit enabled (default)
grep -E "enable\.auto\.commit.*(true|$)" config.properties

# Look for slow processing with auto-commit
rg "enable.auto.commit.*true" -A50 | grep -E "(sleep|Thread\.sleep|await|retry)"

# Find consumers without auto-commit disabled
grep -L "enable\.auto\.commit.*false" consumer-*.properties
```

### Configuration Checks

```properties
# Check these configurations
enable.auto.commit=true  # ⚠️ Dangerous with slow processing
auto.commit.interval.ms=5000  # How often commits happen

# Also check max.poll.interval.ms
max.poll.interval.ms=300000  # Must be > processing time to avoid rebalance
```

---

## 3. Incomplete Processing Before Next Poll

### Description
Calling `poll()` again before fully processing the previous batch of records causes auto-commit to commit offsets for unprocessed messages. This violates at-least-once semantics and can cause message loss.

### Impact
- Silent message loss
- Incomplete data processing
- Difficult to diagnose missing records

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "true");
props.put("auto.commit.interval.ms", "1000");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("events"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    // ⚠️ ANTI-PATTERN: Starting async processing and immediately polling again
    ExecutorService executor = Executors.newFixedThreadPool(10);
    for (ConsumerRecord<String, String> record : records) {
        executor.submit(() -> processEvent(record.value()));
    }
    // ⚠️ NOT waiting for processing to complete!
    // Next poll() will trigger auto-commit for these unprocessed records
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer
import asyncio
from concurrent.futures import ThreadPoolExecutor

consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=True,
    auto_commit_interval_ms=1000
)

executor = ThreadPoolExecutor(max_workers=10)

for message in consumer:
    # ⚠️ ANTI-PATTERN: Submitting to thread pool and moving on
    executor.submit(process_event, message.value)
    # ⚠️ Next iteration triggers auto-commit before processing completes!
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");  // ✅ Manual control

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("events"));

ExecutorService executor = Executors.newFixedThreadPool(10);

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    List<Future<?>> futures = new ArrayList<>();
    for (ConsumerRecord<String, String> record : records) {
        Future<?> future = executor.submit(() -> processEvent(record.value()));
        futures.add(future);
    }

    // ✅ Wait for ALL processing to complete
    for (Future<?> future : futures) {
        try {
            future.get();  // Block until complete
        } catch (Exception e) {
            logger.error("Processing failed", e);
            // Handle failure - maybe don't commit
        }
    }

    // ✅ Commit only after all records are processed
    consumer.commitSync();
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer
from concurrent.futures import ThreadPoolExecutor, as_completed

consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False,  # ✅ Manual control
    max_poll_records=100
)

executor = ThreadPoolExecutor(max_workers=10)

while True:
    messages = consumer.poll(timeout_ms=100)

    if not messages:
        continue

    futures = []
    for topic_partition, records in messages.items():
        for message in records:
            future = executor.submit(process_event, message.value)
            futures.append(future)

    # ✅ Wait for ALL processing to complete
    for future in as_completed(futures):
        try:
            future.result()
        except Exception as e:
            logger.error("Processing failed", exc_info=e)
            # Handle failure

    # ✅ Commit only after all records are processed
    consumer.commit()
```

### Detection Hints

```bash
# Look for async processing without waiting
grep -n "submit\|execute" *.java | grep -A10 "poll("
rg "executor\.(submit|execute)" -A5 | grep -v "\.get()"

# Check for thread pools used with Kafka consumers
grep -E "(ExecutorService|ThreadPoolExecutor)" *.java | grep -A20 "poll"
```

---

## 4. Async Commit Without Error Handling

### Description
Using `commitAsync()` without a callback to handle failures means commit failures go unnoticed. Failed commits can accumulate, and if the consumer crashes before a successful commit, extensive duplicate processing occurs.

### Impact
- Silent commit failures
- Uncontrolled duplicate processing
- No visibility into offset commit health

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("transactions"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        processTransaction(record.value());
    }

    // ⚠️ ANTI-PATTERN: Async commit without callback
    // If this fails, you'll never know!
    consumer.commitAsync();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'transactions',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

for message in consumer:
    process_transaction(message.value)

    # ⚠️ ANTI-PATTERN: Commit without checking success
    # Python kafka-python library doesn't have async commit,
    # but calling commit() without try-catch has same issue
    consumer.commit()  # No error handling!
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("transactions"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        processTransaction(record.value());
    }

    // ✅ Async commit WITH callback for error handling
    consumer.commitAsync(new OffsetCommitCallback() {
        @Override
        public void onComplete(Map<TopicPartition, OffsetAndMetadata> offsets,
                             Exception exception) {
            if (exception != null) {
                logger.error("Commit failed for offsets: " + offsets, exception);
                // Could trigger alerts, retry logic, or fallback to sync commit
                metrics.incrementCounter("kafka.commit.failures");
            } else {
                logger.debug("Commit succeeded for offsets: " + offsets);
            }
        }
    });
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer
from kafka.errors import KafkaError
import logging

consumer = KafkaConsumer(
    'transactions',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

for message in consumer:
    process_transaction(message.value)

    # ✅ Commit with proper error handling
    try:
        consumer.commit()
        logger.debug(f"Committed offset {message.offset}")
    except KafkaError as e:
        logger.error(f"Commit failed for offset {message.offset}", exc_info=e)
        # Could trigger alerts or retry logic
        metrics.increment('kafka.commit.failures')

        # Optionally retry with sync commit
        try:
            consumer.commit()
        except KafkaError as retry_error:
            logger.critical("Commit retry also failed!", exc_info=retry_error)
```

### Detection Hints

```bash
# Find async commits without callbacks
grep -n "commitAsync()" *.java | grep -v "OffsetCommitCallback"
rg "commitAsync\(\)" --type java | grep -v "new OffsetCommitCallback"

# Find commits without try-catch
rg "consumer\.commit\(\)" -A2 -B2 | grep -v "try\|catch\|except"

# Look for fire-and-forget commit patterns
grep -E "commitAsync\(\)\s*;" *.java
```

---

## 5. Manual Commit Without Proper Error Handling

### Description
Using `commitSync()` without try-catch blocks means transient errors (network issues, coordinator unavailable) can crash the consumer application unnecessarily. Even though `commitSync()` retries automatically, uncaught exceptions will terminate the consumer.

### Impact
- Consumer crashes on transient commit failures
- Reduced system reliability
- Unnecessary restarts and rebalances

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("payments"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        processPayment(record.value());
    }

    // ⚠️ ANTI-PATTERN: No error handling
    // If this throws, the consumer crashes!
    consumer.commitSync();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'payments',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

while True:
    messages = consumer.poll(timeout_ms=100)

    for topic_partition, records in messages.items():
        for message in records:
            process_payment(message.value)

    # ⚠️ ANTI-PATTERN: No error handling
    # If this throws, the consumer crashes!
    consumer.commit()
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("payments"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        processPayment(record.value());
    }

    // ✅ Proper error handling with retries
    boolean committed = false;
    int retries = 3;

    while (!committed && retries > 0) {
        try {
            consumer.commitSync();
            committed = true;
            logger.debug("Offset committed successfully");
        } catch (CommitFailedException e) {
            // Unrecoverable - consumer is no longer part of group
            logger.error("Commit failed - consumer removed from group", e);
            throw e;  // Should trigger consumer restart
        } catch (RetriableException e) {
            // Transient error - retry
            retries--;
            logger.warn("Commit failed, retrying... (" + retries + " left)", e);
            try {
                Thread.sleep(1000);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new RuntimeException(ie);
            }
        } catch (KafkaException e) {
            // Other Kafka errors
            logger.error("Unexpected commit error", e);
            metrics.incrementCounter("kafka.commit.errors");
            break;  // Continue processing, will retry on next batch
        }
    }

    if (!committed) {
        logger.error("Failed to commit after retries");
        // Decide: continue or throw
    }
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer
from kafka.errors import CommitFailedError, KafkaError
import time
import logging

consumer = KafkaConsumer(
    'payments',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

while True:
    messages = consumer.poll(timeout_ms=100)

    for topic_partition, records in messages.items():
        for message in records:
            process_payment(message.value)

    # ✅ Proper error handling with retries
    committed = False
    retries = 3

    while not committed and retries > 0:
        try:
            consumer.commit()
            committed = True
            logger.debug("Offset committed successfully")
        except CommitFailedError as e:
            # Unrecoverable - consumer is no longer part of group
            logger.error("Commit failed - consumer removed from group", exc_info=e)
            raise  # Should trigger consumer restart
        except KafkaError as e:
            # Transient error - retry
            retries -= 1
            logger.warning(f"Commit failed, retrying... ({retries} left)", exc_info=e)
            time.sleep(1)
        except Exception as e:
            # Unexpected error
            logger.error("Unexpected commit error", exc_info=e)
            metrics.increment('kafka.commit.errors')
            break  # Continue processing

    if not committed:
        logger.error("Failed to commit after retries")
        # Decide: continue or raise
```

### Detection Hints

```bash
# Find commitSync without try-catch
rg "commitSync\(\)" -A5 -B5 | grep -v "try\|catch"
grep -n "commitSync()" *.java | xargs -I {} sh -c 'grep -B10 {} | grep -q "try" || echo {}'

# Find commit without error handling in Python
rg "consumer\.commit\(\)" -A3 -B3 | grep -v "try:\|except"
```

---

## 6. Missing Rebalance Listener Commits

### Description
Not implementing a `ConsumerRebalanceListener` to commit offsets before partition revocation means the last processed offsets are lost when rebalancing occurs. This causes duplicate processing from the last committed offset.

### Impact
- Duplicate processing during rebalances
- Wasted compute resources
- Potential side effects from duplicate actions

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

// ⚠️ ANTI-PATTERN: No rebalance listener
// Offsets committed only in main loop
consumer.subscribe(Arrays.asList("notifications"));

Map<TopicPartition, OffsetAndMetadata> currentOffsets = new HashMap<>();

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        sendNotification(record.value());

        currentOffsets.put(
            new TopicPartition(record.topic(), record.partition()),
            new OffsetAndMetadata(record.offset() + 1)
        );
    }

    // ⚠️ If rebalance happens here, currentOffsets are lost!
    consumer.commitAsync(currentOffsets, null);
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer, TopicPartition, OffsetAndMetadata

consumer = KafkaConsumer(
    'notifications',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

# ⚠️ ANTI-PATTERN: No rebalance listener
# Offsets may be lost during rebalance

current_offsets = {}

for message in consumer:
    send_notification(message.value)

    tp = TopicPartition(message.topic, message.partition)
    current_offsets[tp] = OffsetAndMetadata(message.offset + 1, None)

    # ⚠️ If rebalance happens before this commit, offsets are lost!
    consumer.commit(current_offsets)
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

Map<TopicPartition, OffsetAndMetadata> currentOffsets = new HashMap<>();

// ✅ Implement rebalance listener
consumer.subscribe(Arrays.asList("notifications"), new ConsumerRebalanceListener() {
    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        // ✅ Commit offsets synchronously before losing partitions
        logger.info("Partitions revoked, committing current offsets: " + currentOffsets);
        try {
            consumer.commitSync(currentOffsets);
        } catch (Exception e) {
            logger.error("Failed to commit offsets on rebalance", e);
        }
    }

    @Override
    public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
        logger.info("Partitions assigned: " + partitions);
        currentOffsets.clear();
    }
});

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        sendNotification(record.value());

        currentOffsets.put(
            new TopicPartition(record.topic(), record.partition()),
            new OffsetAndMetadata(record.offset() + 1)
        );
    }

    // Use async commit in normal operation
    consumer.commitAsync(currentOffsets, null);
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer, TopicPartition, OffsetAndMetadata
import logging

current_offsets = {}

def on_partitions_revoked(consumer, partitions):
    """Called before partitions are reassigned"""
    # ✅ Commit offsets synchronously before losing partitions
    logger.info(f"Partitions revoked, committing current offsets: {current_offsets}")
    try:
        consumer.commit(current_offsets)
    except Exception as e:
        logger.error("Failed to commit offsets on rebalance", exc_info=e)

def on_partitions_assigned(consumer, partitions):
    """Called after partitions are assigned"""
    logger.info(f"Partitions assigned: {partitions}")
    current_offsets.clear()

# ✅ Create consumer with rebalance listener
consumer = KafkaConsumer(
    'notifications',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False
)

# Subscribe with listener
consumer.subscribe(
    ['notifications'],
    on_revoke=lambda c, p: on_partitions_revoked(c, p),
    on_assign=lambda c, p: on_partitions_assigned(c, p)
)

for message in consumer:
    send_notification(message.value)

    tp = TopicPartition(message.topic, message.partition)
    current_offsets[tp] = OffsetAndMetadata(message.offset + 1, None)

    # Use commit in normal operation
    consumer.commit(current_offsets)
```

### Detection Hints

```bash
# Find subscribe without rebalance listener
grep -n "subscribe(" *.java | grep -v "ConsumerRebalanceListener"
rg "\.subscribe\(" --type java | grep -v "ConsumerRebalanceListener"

# Check for missing rebalance handling in Python
rg "KafkaConsumer\(" -A10 | grep -v "on_revoke\|on_assign"
grep -n "consumer.subscribe" *.py | grep -v "on_revoke"
```

---

## 7. Broken Exactly-Once by Improper Transaction Usage

### Description
Attempting exactly-once semantics without properly using Kafka transactions, or committing consumer offsets outside the transaction, breaks the atomicity guarantee. This results in duplicates or data loss.

### Impact
- Broken exactly-once guarantees
- Duplicate or lost messages
- Inconsistent application state

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "my-consumer-group");
props.put("enable.auto.commit", "false");
props.put("isolation.level", "read_committed");

Properties producerProps = new Properties();
producerProps.put("bootstrap.servers", "localhost:9092");
producerProps.put("transactional.id", "my-transactional-id");
// ⚠️ Missing idempotence configuration

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

producer.initTransactions();
consumer.subscribe(Arrays.asList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    producer.beginTransaction();

    for (ConsumerRecord<String, String> record : records) {
        String transformed = transform(record.value());

        // ⚠️ ANTI-PATTERN: Producing within transaction
        producer.send(new ProducerRecord<>("output-topic", transformed));
    }

    // ⚠️ ANTI-PATTERN: Committing offsets OUTSIDE transaction
    // This breaks atomicity!
    consumer.commitSync();

    producer.commitTransaction();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer, KafkaProducer

consumer = KafkaConsumer(
    'input-topic',
    bootstrap_servers='localhost:9092',
    group_id='my-consumer-group',
    enable_auto_commit=False,
    isolation_level='read_committed'
)

producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    # ⚠️ Python kafka-python doesn't support transactions well
    # This is already an anti-pattern!
)

for message in consumer:
    transformed = transform(message.value)

    # ⚠️ ANTI-PATTERN: No transaction support
    producer.send('output-topic', transformed)
    producer.flush()

    # ⚠️ Separate commit - no atomicity!
    consumer.commit()
```

### Good Example (Java)

```java
Properties consumerProps = new Properties();
consumerProps.put("bootstrap.servers", "localhost:9092");
consumerProps.put("group.id", "my-consumer-group");
consumerProps.put("enable.auto.commit", "false");
consumerProps.put("isolation.level", "read_committed");

Properties producerProps = new Properties();
producerProps.put("bootstrap.servers", "localhost:9092");
producerProps.put("transactional.id", "my-transactional-id");
// ✅ Enable idempotence (required for transactions)
producerProps.put("enable.idempotence", "true");
producerProps.put("acks", "all");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(consumerProps);
KafkaProducer<String, String> producer = new KafkaProducer<>(producerProps);

// ✅ Initialize transactions
producer.initTransactions();
consumer.subscribe(Arrays.asList("input-topic"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    if (records.isEmpty()) {
        continue;
    }

    try {
        // ✅ Begin transaction
        producer.beginTransaction();

        Map<TopicPartition, OffsetAndMetadata> offsets = new HashMap<>();

        for (ConsumerRecord<String, String> record : records) {
            String transformed = transform(record.value());

            // ✅ Send within transaction
            producer.send(new ProducerRecord<>("output-topic", transformed));

            offsets.put(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            );
        }

        // ✅ Send offsets to transaction - this is the key!
        producer.sendOffsetsToTransaction(offsets, consumer.groupMetadata());

        // ✅ Commit transaction atomically
        producer.commitTransaction();

        logger.debug("Transaction committed successfully");

    } catch (ProducerFencedException | OutOfOrderSequenceException |
             AuthorizationException e) {
        // ✅ Fatal errors - close producer
        logger.error("Fatal producer error", e);
        producer.close();
        throw e;
    } catch (KafkaException e) {
        // ✅ Retriable errors - abort transaction
        logger.error("Transaction error, aborting", e);
        producer.abortTransaction();
    }
}
```

### Good Example (Python with confluent-kafka)

```python
# Note: Use confluent-kafka library, not kafka-python
from confluent_kafka import Consumer, Producer, KafkaError, KafkaException
import logging

consumer_conf = {
    'bootstrap.servers': 'localhost:9092',
    'group.id': 'my-consumer-group',
    'enable.auto.commit': False,
    'isolation.level': 'read_committed'
}

producer_conf = {
    'bootstrap.servers': 'localhost:9092',
    'transactional.id': 'my-transactional-id',
    # ✅ Idempotence enabled automatically with transactions
}

consumer = Consumer(consumer_conf)
producer = Producer(producer_conf)

# ✅ Initialize transactions
producer.init_transactions()
consumer.subscribe(['input-topic'])

try:
    while True:
        msg = consumer.poll(timeout=1.0)

        if msg is None:
            continue
        if msg.error():
            raise KafkaException(msg.error())

        try:
            # ✅ Begin transaction
            producer.begin_transaction()

            transformed = transform(msg.value())

            # ✅ Send within transaction
            producer.produce('output-topic', transformed)

            # ✅ Send offsets to transaction
            producer.send_offsets_to_transaction(
                consumer.position(consumer.assignment()),
                consumer.consumer_group_metadata()
            )

            # ✅ Commit transaction atomically
            producer.commit_transaction()

            logger.debug("Transaction committed successfully")

        except KafkaException as e:
            logger.error("Transaction error, aborting", exc_info=e)
            # ✅ Abort transaction on error
            producer.abort_transaction()

except KeyboardInterrupt:
    pass
finally:
    consumer.close()
    producer.flush()
```

### Detection Hints

```bash
# Find transactional producers without offset management
rg "transactional\.id" -A30 | grep -v "sendOffsetsToTransaction"
grep -n "beginTransaction" *.java | grep -A20 "commitSync"

# Check for missing idempotence with transactions
rg "transactional\.id" -B5 -A5 | grep -v "enable\.idempotence"

# Find isolation level without transactions
grep -E "isolation\.level.*read_committed" config.properties | grep -v "transactional.id"
```

### Configuration Checks

```properties
# Required for exactly-once
transactional.id=my-unique-id
enable.idempotence=true
acks=all

# Consumer side
isolation.level=read_committed
enable.auto.commit=false
```

---

## 8. Non-Idempotent Processing with At-Least-Once

### Description
Using at-least-once semantics (default) with non-idempotent processing logic causes duplicate side effects when messages are reprocessed. This is common after crashes or rebalances.

### Impact
- Duplicate database records
- Double-charging customers
- Incorrect counters/metrics
- Inconsistent application state

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "payment-processor");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("payment-events"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        PaymentEvent event = parsePayment(record.value());

        // ⚠️ ANTI-PATTERN: Non-idempotent operations
        // If this message is reprocessed, customer is charged twice!
        chargeCustomer(event.customerId, event.amount);

        // ⚠️ Non-idempotent database insert
        // Reprocessing causes duplicate records
        database.execute(
            "INSERT INTO payments (id, customer_id, amount) VALUES (?, ?, ?)",
            UUID.randomUUID(), event.customerId, event.amount
        );

        // ⚠️ Non-idempotent counter increment
        metrics.incrementCounter("total_revenue", event.amount);
    }

    consumer.commitSync();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer
import uuid

consumer = KafkaConsumer(
    'payment-events',
    bootstrap_servers='localhost:9092',
    group_id='payment-processor',
    enable_auto_commit=False
)

for message in consumer:
    event = parse_payment(message.value)

    # ⚠️ ANTI-PATTERN: Non-idempotent operations
    # Reprocessing causes duplicates!
    charge_customer(event['customer_id'], event['amount'])

    # ⚠️ Non-idempotent insert with random UUID
    db.execute(
        "INSERT INTO payments (id, customer_id, amount) VALUES (?, ?, ?)",
        (str(uuid.uuid4()), event['customer_id'], event['amount'])
    )

    # ⚠️ Non-idempotent metric
    metrics.increment('total_revenue', event['amount'])

    consumer.commit()
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "payment-processor");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("payment-events"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        PaymentEvent event = parsePayment(record.value());

        // ✅ Use deterministic ID from message key/content
        String idempotencyKey = generateIdempotencyKey(
            record.topic(),
            record.partition(),
            record.offset()
        );
        // OR use event ID if available: event.getId()

        // ✅ Check if already processed (idempotency check)
        if (database.exists("SELECT 1 FROM payments WHERE idempotency_key = ?", idempotencyKey)) {
            logger.info("Payment already processed, skipping: " + idempotencyKey);
            continue;
        }

        try {
            // ✅ Process with idempotency key
            chargeCustomer(event.customerId, event.amount, idempotencyKey);

            // ✅ Idempotent insert with deterministic ID
            database.execute(
                "INSERT INTO payments (idempotency_key, customer_id, amount) " +
                "VALUES (?, ?, ?) ON CONFLICT (idempotency_key) DO NOTHING",
                idempotencyKey, event.customerId, event.amount
            );

            // ✅ Metrics updated only on successful insert

        } catch (Exception e) {
            logger.error("Failed to process payment: " + idempotencyKey, e);
            // Don't commit - will retry
            throw e;
        }
    }

    consumer.commitSync();
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer
import hashlib

consumer = KafkaConsumer(
    'payment-events',
    bootstrap_servers='localhost:9092',
    group_id='payment-processor',
    enable_auto_commit=False
)

def generate_idempotency_key(topic, partition, offset):
    """Generate deterministic key from message coordinates"""
    return f"{topic}-{partition}-{offset}"

for message in consumer:
    event = parse_payment(message.value)

    # ✅ Use deterministic ID from message
    idempotency_key = generate_idempotency_key(
        message.topic,
        message.partition,
        message.offset
    )
    # OR: idempotency_key = event.get('id') if event has one

    # ✅ Check if already processed
    if db.exists("SELECT 1 FROM payments WHERE idempotency_key = ?", [idempotency_key]):
        logger.info(f"Payment already processed, skipping: {idempotency_key}")
        consumer.commit()
        continue

    try:
        # ✅ Process with idempotency key
        charge_customer(event['customer_id'], event['amount'], idempotency_key)

        # ✅ Idempotent insert (PostgreSQL example)
        db.execute("""
            INSERT INTO payments (idempotency_key, customer_id, amount)
            VALUES (?, ?, ?)
            ON CONFLICT (idempotency_key) DO NOTHING
        """, (idempotency_key, event['customer_id'], event['amount']))

        # ✅ Commit only after successful processing
        consumer.commit()

    except Exception as e:
        logger.error(f"Failed to process payment: {idempotency_key}", exc_info=e)
        # Don't commit - will retry
        raise
```

### Detection Hints

```bash
# Look for UUID generation in consumer loops
rg "UUID\.(randomUUID|uuid4)" -B10 | grep -E "(poll|for.*message)"

# Find INSERT without conflict handling
rg "INSERT INTO" -A2 | grep -v "ON CONFLICT\|ON DUPLICATE KEY\|MERGE\|UPSERT"

# Look for non-idempotent operations
grep -E "INCREMENT|UPDATE.*\+|INSERT INTO" consumer*.java | grep -v "WHERE.*="

# Find increment operations in consumer code
rg "(incrementCounter|increment\(|counter\+\+)" | grep -B5 "poll\|message"
```

### Configuration/Code Checks

```sql
-- Check for idempotency key columns
SELECT column_name FROM information_schema.columns
WHERE table_name = 'payments'
AND column_name LIKE '%idempoten%' OR column_name LIKE '%dedup%';

-- Check for unique constraints on idempotency keys
SELECT constraint_name FROM information_schema.table_constraints
WHERE table_name = 'payments' AND constraint_type = 'UNIQUE';
```

---

## 9. Offset Reset Policy Misunderstanding

### Description
Misunderstanding `auto.offset.reset` (earliest vs latest) leads to unexpected behavior when consumers start without committed offsets. Using "latest" (default) can cause message loss during deployments or extended downtime if offsets expire.

### Impact
- Data loss with "latest" when offsets expire
- System overload with "earliest" on large topics
- Unpredictable behavior in testing/staging

### Bad Example (Configuration)

```properties
# ⚠️ ANTI-PATTERN: Using default "latest" without understanding implications
bootstrap.servers=localhost:9092
group.id=order-processor
# auto.offset.reset=latest  # This is the default!

# If this consumer group is down for > offsets.retention.minutes (default 7 days)
# When it restarts, all messages during downtime are LOST!
```

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "critical-events-processor");
// ⚠️ ANTI-PATTERN: Not setting auto.offset.reset explicitly
// Defaults to "latest" - messages during downtime are lost!
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("critical-events"));

// If this is a new deployment after 7+ days downtime,
// all events during downtime are skipped!
while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));
    for (ConsumerRecord<String, String> record : records) {
        processCriticalEvent(record.value());
    }
    consumer.commitSync();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'critical-events',
    bootstrap_servers='localhost:9092',
    group_id='critical-events-processor',
    # ⚠️ ANTI-PATTERN: Not setting auto_offset_reset explicitly
    # Defaults to "latest" - potential data loss!
    enable_auto_commit=False
)

# Messages during downtime will be lost!
for message in consumer:
    process_critical_event(message.value)
    consumer.commit()
```

### Good Example (Configuration)

```properties
# ✅ Explicitly set auto.offset.reset based on requirements

# For critical data that must not be lost:
bootstrap.servers=localhost:9092
group.id=order-processor
auto.offset.reset=earliest  # Process all available messages if no offset

# For real-time data where old data is not valuable:
# auto.offset.reset=latest  # Only process new messages

# For strict control:
# auto.offset.reset=none  # Throw exception if no offset exists
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "critical-events-processor");

// ✅ Explicitly choose based on requirements
if (requireCompleteHistory) {
    // For critical data - process everything
    props.put("auto.offset.reset", "earliest");
    logger.info("Consumer configured to process all available messages");
} else if (requireStrictControl) {
    // Fail fast if offsets don't exist
    props.put("auto.offset.reset", "none");
    logger.info("Consumer requires existing offsets");
} else {
    // Only new messages (explicitly stated)
    props.put("auto.offset.reset", "latest");
    logger.info("Consumer will only process new messages");
}

props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("critical-events"));

while (true) {
    ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

    for (ConsumerRecord<String, String> record : records) {
        processCriticalEvent(record.value());
    }

    consumer.commitSync();
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer
from kafka.errors import OffsetOutOfRangeError
import logging

# ✅ Explicitly document and configure offset reset policy

# Determine policy based on requirements
REQUIRE_COMPLETE_HISTORY = True  # Set based on use case

if REQUIRE_COMPLETE_HISTORY:
    # For critical data
    auto_offset_reset = 'earliest'
    logger.info("Consumer configured to process all available messages")
else:
    # For real-time only
    auto_offset_reset = 'latest'
    logger.info("Consumer will only process new messages")

consumer = KafkaConsumer(
    'critical-events',
    bootstrap_servers='localhost:9092',
    group_id='critical-events-processor',
    # ✅ Explicitly set based on requirements
    auto_offset_reset=auto_offset_reset,
    enable_auto_commit=False
)

logger.info(f"Consumer started with auto_offset_reset={auto_offset_reset}")

try:
    for message in consumer:
        process_critical_event(message.value)
        consumer.commit()
except OffsetOutOfRangeError as e:
    logger.error("Offset out of range - may need to reset offsets", exc_info=e)
    # Handle appropriately
```

### Detection Hints

```bash
# Find consumers without explicit auto.offset.reset
grep -E "group\.id" config.properties | grep -v "auto\.offset\.reset"

# Check for missing auto_offset_reset in Python
rg "KafkaConsumer\(" -A10 | grep -v "auto_offset_reset"

# Find consumers that might lose data
grep -E "auto\.offset\.reset.*latest" config.properties | grep -E "(critical|important|order|payment)"
```

### Configuration Checks

```properties
# Check offset retention
offsets.retention.minutes=10080  # 7 days default on broker

# Consumer groups with potential issues
# List groups with no recent commits:
kafka-consumer-groups --bootstrap-server localhost:9092 --list
kafka-consumer-groups --bootstrap-server localhost:9092 --describe --group <group-id>
```

### Additional Considerations

```java
// ✅ Monitor lag to detect offset reset scenarios
public void monitorConsumerLag(KafkaConsumer<String, String> consumer) {
    Map<TopicPartition, Long> endOffsets = consumer.endOffsets(consumer.assignment());

    for (TopicPartition tp : consumer.assignment()) {
        long currentPosition = consumer.position(tp);
        long endOffset = endOffsets.get(tp);
        long lag = endOffset - currentPosition;

        // Alert if lag suddenly jumps (might indicate offset reset)
        if (lag > THRESHOLD) {
            logger.warn("High lag detected on " + tp + ": " + lag);
            metrics.recordGauge("consumer.lag", lag);
        }
    }
}
```

---

## 10. Mixing Sync and Async Commits Incorrectly

### Description
Using only async commits or improperly mixing sync and async commits can lead to uncommitted offsets during shutdowns or rebalances, causing extensive duplicate processing.

### Impact
- Lost offsets during shutdown/rebalance
- Duplicate processing on restart
- No guarantee of commit success

### Bad Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "data-processor");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);
consumer.subscribe(Arrays.asList("events"));

try {
    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

        for (ConsumerRecord<String, String> record : records) {
            processEvent(record.value());
        }

        // ⚠️ ANTI-PATTERN: Only using async commits
        // No guarantee these commits succeed!
        consumer.commitAsync();
    }
} finally {
    // ⚠️ ANTI-PATTERN: No sync commit on shutdown
    // Last offsets may be lost!
    consumer.close();
}
```

### Bad Example (Python)

```python
from kafka import KafkaConsumer

consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    group_id='data-processor',
    enable_auto_commit=False
)

try:
    for message in consumer:
        process_event(message.value)

        # ⚠️ ANTI-PATTERN: No guarantees on success
        # Using fire-and-forget commit
        consumer.commit_async()

except KeyboardInterrupt:
    # ⚠️ ANTI-PATTERN: No final sync commit
    pass
finally:
    consumer.close()
```

### Good Example (Java)

```java
Properties props = new Properties();
props.put("bootstrap.servers", "localhost:9092");
props.put("group.id", "data-processor");
props.put("enable.auto.commit", "false");

KafkaConsumer<String, String> consumer = new KafkaConsumer<>(props);

Map<TopicPartition, OffsetAndMetadata> currentOffsets = new HashMap<>();

consumer.subscribe(Arrays.asList("events"), new ConsumerRebalanceListener() {
    @Override
    public void onPartitionsRevoked(Collection<TopicPartition> partitions) {
        // ✅ Sync commit before rebalance
        logger.info("Rebalancing, committing offsets synchronously");
        consumer.commitSync(currentOffsets);
    }

    @Override
    public void onPartitionsAssigned(Collection<TopicPartition> partitions) {
        logger.info("Partitions assigned: " + partitions);
    }
});

try {
    while (true) {
        ConsumerRecords<String, String> records = consumer.poll(Duration.ofMillis(100));

        for (ConsumerRecord<String, String> record : records) {
            processEvent(record.value());

            currentOffsets.put(
                new TopicPartition(record.topic(), record.partition()),
                new OffsetAndMetadata(record.offset() + 1)
            );
        }

        // ✅ Async commit during normal operation for performance
        consumer.commitAsync(currentOffsets, new OffsetCommitCallback() {
            @Override
            public void onComplete(Map<TopicPartition, OffsetAndMetadata> offsets,
                                 Exception exception) {
                if (exception != null) {
                    logger.warn("Async commit failed: " + offsets, exception);
                }
            }
        });
    }
} catch (WakeupException e) {
    logger.info("Consumer wakeup called");
} finally {
    try {
        // ✅ Sync commit on shutdown - guarantee final offsets are saved
        logger.info("Shutting down, committing final offsets synchronously");
        consumer.commitSync(currentOffsets);
    } finally {
        consumer.close();
        logger.info("Consumer closed");
    }
}
```

### Good Example (Python)

```python
from kafka import KafkaConsumer, TopicPartition, OffsetAndMetadata
import signal
import sys
import logging

consumer = KafkaConsumer(
    'events',
    bootstrap_servers='localhost:9092',
    group_id='data-processor',
    enable_auto_commit=False
)

current_offsets = {}
shutdown_requested = False

def signal_handler(sig, frame):
    global shutdown_requested
    logger.info("Shutdown signal received")
    shutdown_requested = True

signal.signal(signal.SIGINT, signal_handler)
signal.signal(signal.SIGTERM, signal_handler)

def on_partitions_revoked(consumer, partitions):
    # ✅ Sync commit before rebalance
    logger.info(f"Rebalancing, committing offsets synchronously: {current_offsets}")
    consumer.commit(current_offsets)

consumer.subscribe(
    ['events'],
    on_revoke=lambda c, p: on_partitions_revoked(c, p)
)

try:
    while not shutdown_requested:
        messages = consumer.poll(timeout_ms=100)

        for topic_partition, records in messages.items():
            for message in records:
                process_event(message.value)

                tp = TopicPartition(message.topic, message.partition)
                current_offsets[tp] = OffsetAndMetadata(message.offset + 1, None)

        if current_offsets:
            # ✅ Async-style commit during normal operation
            try:
                consumer.commit(current_offsets)
            except Exception as e:
                logger.warning(f"Commit failed: {current_offsets}", exc_info=e)

finally:
    try:
        # ✅ Sync commit on shutdown - guarantee final offsets saved
        logger.info(f"Shutting down, committing final offsets: {current_offsets}")
        consumer.commit(current_offsets)
    except Exception as e:
        logger.error("Final commit failed", exc_info=e)
    finally:
        consumer.close()
        logger.info("Consumer closed")
```

### Detection Hints

```bash
# Find async-only commit patterns
rg "commitAsync" --type java | grep -v "commitSync"
grep -n "commitAsync()" *.java | grep -v -E "(finally|shutdown|close)"

# Find missing finally blocks with sync commit
rg "try\s*\{" -A30 | grep "commitAsync" | grep -v "finally.*commitSync"

# Check for consumers without rebalance listeners
grep -E "subscribe\(" *.java | grep -v "ConsumerRebalanceListener"
```

---

## Summary of Detection Commands

```bash
# General Kafka consumer anti-pattern scan
# Run from project root

echo "=== Scanning for Kafka Offset Anti-Patterns ==="

echo "\n1. Commit before processing:"
rg "commit(Sync|Async)?\(\)" -B3 | grep -E "poll\("

echo "\n2. Auto-commit enabled (check if intentional):"
rg "enable\.auto\.commit.*true"

echo "\n3. Missing rebalance listeners:"
rg "subscribe\(" --type java | grep -v "ConsumerRebalanceListener"

echo "\n4. Async commit without callback:"
rg "commitAsync\(\)" --type java | grep -v "OffsetCommitCallback"

echo "\n5. No error handling on commits:"
rg "commit(Sync|Async)?\(\)" -A2 -B2 | grep -v "try\|catch"

echo "\n6. UUID in consumer loops (non-idempotent):"
rg "UUID\.(randomUUID|uuid4)" -B10 | grep -E "poll\|message"

echo "\n7. Missing auto.offset.reset configuration:"
rg "KafkaConsumer" -A15 | grep -v "auto.offset.reset\|auto_offset_reset"

echo "\n8. Transactional without sendOffsetsToTransaction:"
rg "transactional\.id" -A30 | grep -v "sendOffsetsToTransaction"

echo "\n9. Async-only commits without shutdown sync:"
rg "commitAsync" --type java | grep -v "commitSync"

echo "\n=== Scan complete ==="
```

---

## References and Sources

### Primary Sources
- [Kafka Consumer for Confluent Platform - Confluent Documentation](https://docs.confluent.io/platform/current/clients/consumer.html)
- [Exactly-once Semantics is Possible: Here's How Apache Kafka Does it - Confluent Blog](https://www.confluent.io/blog/exactly-once-semantics-are-possible-heres-how-apache-kafka-does-it/)
- [Kafka Consumer Offsets Guide—Basic Principles, Insights & Enhancements - Confluent Blog](https://www.confluent.io/blog/guide-to-consumer-offsets/)
- [Message Delivery Guarantees for Apache Kafka - Confluent Documentation](https://docs.confluent.io/kafka/design/delivery-semantics.html)

### Additional Resources
- [Kafka - When to commit? - Quarkus Blog](https://quarkus.io/blog/kafka-commit-strategies/)
- [Understanding Kafka's auto offset reset configuration: Use cases and pitfalls - Quix.io](https://quix.io/blog/kafka-auto-offset-reset-use-cases-and-pitfalls)
- [Kafka Consumer Auto Offset Reset - Lydtech Consulting](https://www.lydtechconsulting.com/blog-kafka-auto-offset-reset.html)
- [Commit Offsets in Kafka - Baeldung](https://www.baeldung.com/kafka-commit-offsets)
- [Kafka Programming: Different ways to commit offsets - Medium](https://medium.com/@rramiz.rraza/kafka-programming-different-ways-to-commit-offsets-7bcd179b225a)
- [Idempotent Reader Pattern - Confluent Developer](https://developer.confluent.io/patterns/event-processing/idempotent-reader/)
- [Idempotent Processing with Kafka - Nejc Korasa](https://nejckorasa.github.io/posts/idempotent-kafka-procesing/)

---

## Document Metadata

**Created**: 2025-12-11
**Knowledge Domain**: Apache Kafka, Stream Processing
**Categories**: Offset Management, Commit Strategies, Exactly-Once Semantics
**Languages**: Java, Python
**Frameworks**: Apache Kafka, confluent-kafka-python, kafka-python
