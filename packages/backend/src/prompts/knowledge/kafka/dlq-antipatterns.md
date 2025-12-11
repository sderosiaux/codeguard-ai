# Kafka Dead Letter Queue (DLQ) Anti-Patterns

This document catalogs common anti-patterns and mistakes when implementing Dead Letter Queues (DLQs) in Apache Kafka systems.

## Overview

A Dead Letter Queue (DLQ) in Kafka is a separate topic used to isolate messages that cannot be processed successfully. While Kafka doesn't natively support DLQ at the broker level, it's commonly implemented at the consumer/connector level. Improper DLQ implementation can lead to silent data loss, operational blindness, and difficult debugging scenarios.

---

## Anti-Pattern 1: Single DLQ for All Error Types (No Categorization)

### Pattern Name
**Undifferentiated DLQ** - Using a single dead letter topic for all types of failures without categorization.

### Description
Routing all failed messages (deserialization errors, business logic errors, external system failures, validation errors) to a single DLQ topic without distinguishing between error types. This makes it difficult to:
- Apply different retry strategies per error type
- Prioritize investigation and remediation
- Track metrics by error category
- Implement automated recovery for specific error classes

### Bad Example

```properties
# Kafka Connect Configuration - Single DLQ for everything
errors.tolerance=all
errors.deadletterqueue.topic.name=global-dlq
errors.deadletterqueue.topic.replication.factor=3
errors.log.enable=true
```

```java
// Consumer code - All errors go to same DLQ
@KafkaListener(topics = "orders")
public void processOrder(String message) {
    try {
        Order order = deserialize(message);
        processBusinessLogic(order);
    } catch (Exception e) {
        // All errors treated the same
        kafkaTemplate.send("global-dlq", message);
    }
}
```

### Good Example

```properties
# Kafka Connect Configuration - Categorized DLQs
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq-main
errors.deadletterqueue.topic.replication.factor=3
errors.log.enable=true
errors.deadletterqueue.context.headers.enable=true
```

```java
// Consumer code - Error categorization
@KafkaListener(topics = "orders")
public void processOrder(ConsumerRecord<String, String> record) {
    try {
        Order order = deserialize(record.value());
        processBusinessLogic(order);
    } catch (JsonProcessingException e) {
        // Deserialization errors - likely unrecoverable
        sendToDLQ("orders-dlq-deserialization", record, e, "DESERIALIZATION_ERROR");
    } catch (ValidationException e) {
        // Validation errors - needs investigation
        sendToDLQ("orders-dlq-validation", record, e, "VALIDATION_ERROR");
    } catch (ExternalServiceException e) {
        // External service errors - retryable
        sendToDLQ("orders-dlq-external", record, e, "EXTERNAL_SERVICE_ERROR");
    } catch (BusinessLogicException e) {
        // Business logic errors - needs code fix
        sendToDLQ("orders-dlq-business", record, e, "BUSINESS_LOGIC_ERROR");
    }
}

private void sendToDLQ(String dlqTopic, ConsumerRecord<String, String> record,
                       Exception e, String errorType) {
    ProducerRecord<String, String> dlqRecord = new ProducerRecord<>(
        dlqTopic,
        record.key(),
        record.value()
    );

    // Add error categorization headers
    dlqRecord.headers().add("error.type", errorType.getBytes());
    dlqRecord.headers().add("error.message", e.getMessage().getBytes());
    dlqRecord.headers().add("error.class", e.getClass().getName().getBytes());

    kafkaTemplate.send(dlqRecord);
}
```

### Detection Hints
- Look for single DLQ topic configurations across multiple services
- Search for generic exception handlers that route to one DLQ
- Check for absence of error type headers or categorization logic
- Missing separate alert configurations for different error types

**Code patterns to search:**
```java
catch (Exception e) {
    kafkaTemplate.send("global-dlq", message);
}
```

---

## Anti-Pattern 2: DLQ Without Metadata (Can't Replay)

### Pattern Name
**Context-Free DLQ** - Dead letter messages lack critical metadata needed for debugging and replay.

### Description
Sending failed messages to DLQ without preserving essential context such as:
- Original topic, partition, and offset
- Timestamp of original message and failure
- Error details (exception type, message, stack trace)
- Retry attempt count
- Original message headers

This makes root cause analysis difficult and replay nearly impossible.

### Bad Example

```java
// Missing critical metadata
@KafkaListener(topics = "payments")
public void processPayment(String message) {
    try {
        Payment payment = parse(message);
        process(payment);
    } catch (Exception e) {
        // Just send the raw message, no context
        kafkaTemplate.send("payments-dlq", message);
        log.error("Payment processing failed", e);
    }
}
```

```properties
# Kafka Connect - Headers disabled (bad!)
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq
errors.deadletterqueue.context.headers.enable=false
```

### Good Example

```java
@KafkaListener(topics = "payments")
public void processPayment(ConsumerRecord<String, String> record,
                          Acknowledgment ack) {
    try {
        Payment payment = parse(record.value());
        process(payment);
        ack.acknowledge();
    } catch (Exception e) {
        sendToDLQWithMetadata(record, e);
        ack.acknowledge();
    }
}

private void sendToDLQWithMetadata(ConsumerRecord<String, String> record,
                                   Exception exception) {
    ProducerRecord<String, String> dlqRecord = new ProducerRecord<>(
        "payments-dlq",
        record.key(),
        record.value()
    );

    // Preserve original Kafka metadata
    dlqRecord.headers().add("original.topic",
        record.topic().getBytes(StandardCharsets.UTF_8));
    dlqRecord.headers().add("original.partition",
        String.valueOf(record.partition()).getBytes());
    dlqRecord.headers().add("original.offset",
        String.valueOf(record.offset()).getBytes());
    dlqRecord.headers().add("original.timestamp",
        String.valueOf(record.timestamp()).getBytes());

    // Add error context
    dlqRecord.headers().add("error.class",
        exception.getClass().getName().getBytes());
    dlqRecord.headers().add("error.message",
        exception.getMessage().getBytes());
    dlqRecord.headers().add("error.stacktrace",
        getStackTraceAsString(exception).getBytes());
    dlqRecord.headers().add("error.timestamp",
        Instant.now().toString().getBytes());

    // Preserve all original headers
    record.headers().forEach(header ->
        dlqRecord.headers().add(header.key(), header.value()));

    // Add retry metadata if applicable
    String retryCount = getHeaderValue(record.headers(), "retry.count", "0");
    dlqRecord.headers().add("retry.count",
        String.valueOf(Integer.parseInt(retryCount) + 1).getBytes());

    kafkaTemplate.send(dlqRecord);

    // Log with correlation ID for tracing
    log.error("Message sent to DLQ - topic: {}, partition: {}, offset: {}, error: {}",
        record.topic(), record.partition(), record.offset(),
        exception.getMessage());
}
```

```properties
# Kafka Connect - Headers enabled (good!)
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq
errors.deadletterqueue.topic.replication.factor=3
errors.deadletterqueue.context.headers.enable=true
errors.log.enable=true
errors.log.include.messages=true
```

### Detection Hints
- Search for DLQ producer code that doesn't include headers
- Check for `errors.deadletterqueue.context.headers.enable=false`
- Look for consumers that only send `message` or `value` without `ConsumerRecord`
- Missing error metadata in DLQ topic headers

**Code patterns to search:**
```java
kafkaTemplate.send("dlq-topic", message); // No metadata
kafkaTemplate.send("dlq-topic", key, value); // Missing headers
```

---

## Anti-Pattern 3: No Monitoring on DLQ Growth

### Pattern Name
**Blind DLQ** - Dead letter queue without monitoring, alerting, or visibility into message accumulation.

### Description
Operating a DLQ without proper monitoring and alerting means failures accumulate silently. Teams don't know when:
- Error rates spike
- Specific error types emerge
- DLQ is growing unbounded
- Messages age beyond recovery window
- Underlying issues require immediate attention

This leads to late detection of production issues and potential data loss.

### Bad Example

```java
// No metrics, no monitoring
public class OrderConsumer {
    @KafkaListener(topics = "orders")
    public void processOrder(ConsumerRecord<String, String> record) {
        try {
            process(record);
        } catch (Exception e) {
            // Silent DLQ write, no metrics
            kafkaTemplate.send("orders-dlq", record.value());
        }
    }
}
```

```yaml
# Application config - No DLQ monitoring
spring:
  kafka:
    consumer:
      group-id: order-service
      bootstrap-servers: localhost:9092
# Missing: metrics, alerts, dashboards
```

### Good Example

```java
@Component
public class OrderConsumer {
    private final MeterRegistry meterRegistry;
    private final Counter dlqCounter;
    private final Timer dlqTimer;

    public OrderConsumer(MeterRegistry meterRegistry) {
        this.meterRegistry = meterRegistry;
        this.dlqCounter = Counter.builder("kafka.dlq.messages")
            .tag("topic", "orders")
            .description("Number of messages sent to DLQ")
            .register(meterRegistry);
        this.dlqTimer = Timer.builder("kafka.dlq.processing.time")
            .description("Time from failure to DLQ write")
            .register(meterRegistry);
    }

    @KafkaListener(topics = "orders")
    public void processOrder(ConsumerRecord<String, String> record) {
        try {
            process(record);
        } catch (Exception e) {
            dlqTimer.record(() -> {
                sendToDLQ(record, e);
            });

            // Increment counter with error type tag
            dlqCounter.increment();
            Counter.builder("kafka.dlq.messages.by.error")
                .tag("error.type", e.getClass().getSimpleName())
                .tag("topic", "orders")
                .register(meterRegistry)
                .increment();
        }
    }
}
```

```yaml
# Comprehensive monitoring configuration
management:
  endpoints:
    web:
      exposure:
        include: health,metrics,prometheus
  metrics:
    export:
      prometheus:
        enabled: true
    tags:
      application: order-service

# Alert rules (Prometheus/AlertManager format)
groups:
  - name: kafka_dlq_alerts
    rules:
      - alert: DLQHighMessageRate
        expr: rate(kafka_dlq_messages_total[5m]) > 10
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High DLQ message rate detected"
          description: "DLQ receiving {{ $value }} messages/sec for topic {{ $labels.topic }}"

      - alert: DLQMessageSpike
        expr: increase(kafka_dlq_messages_total[15m]) > 100
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "DLQ message spike detected"
          description: "DLQ received {{ $value }} messages in 15 minutes"

      - alert: DLQConsumerLag
        expr: kafka_consumer_lag{topic=~".*-dlq"} > 1000
        for: 10m
        labels:
          severity: warning
        annotations:
          summary: "DLQ consumer lag is high"
          description: "DLQ topic {{ $labels.topic }} has lag of {{ $value }}"
```

```java
// Regular DLQ health checks
@Component
@Slf4j
public class DLQHealthMonitor {

    @Scheduled(fixedRate = 60000) // Every minute
    public void checkDLQHealth() {
        Map<String, Long> dlqSizes = getDLQTopicSizes();

        dlqSizes.forEach((topic, size) -> {
            if (size > DLQ_SIZE_THRESHOLD) {
                log.warn("DLQ topic {} has {} messages (threshold: {})",
                    topic, size, DLQ_SIZE_THRESHOLD);
                alertService.sendAlert(
                    "DLQ_SIZE_EXCEEDED",
                    String.format("Topic %s has %d messages", topic, size)
                );
            }

            // Record metric
            Gauge.builder("kafka.dlq.size", () -> size)
                .tag("topic", topic)
                .register(meterRegistry);
        });

        // Check message age
        checkOldestMessageAge();
    }

    private void checkOldestMessageAge() {
        // Implementation to check timestamp of oldest message
        // Alert if messages are aging beyond retention policy
    }
}
```

### Detection Hints
- No metrics collection in DLQ producer code
- Missing `MeterRegistry`, `Counter`, `Gauge`, or `Timer` usage
- Absence of monitoring dashboard configurations
- No alert rules defined for DLQ topics
- Missing scheduled health check jobs for DLQ

**Code patterns to search:**
```java
kafkaTemplate.send(".*-dlq", .*); // Without metrics
// Missing: Counter, Timer, Gauge registration
```

---

## Anti-Pattern 4: Silent Failures (Errors Swallowed, No DLQ)

### Pattern Name
**Error Black Hole** - Exceptions caught and swallowed without routing to DLQ or logging, causing silent data loss.

### Description
The most dangerous anti-pattern: catching exceptions but failing to properly handle them. Messages are lost without any record, making debugging impossible and violating data reliability guarantees. Common scenarios:
- Empty catch blocks
- Logging-only error handling
- Not configuring DLQ when `errors.tolerance=all`
- Anonymous consumer groups attempting to use DLQ

### Bad Example

```java
// Silent failure - message lost forever
@KafkaListener(topics = "user-events")
public void processUserEvent(String message) {
    try {
        UserEvent event = parse(message);
        processEvent(event);
    } catch (Exception e) {
        // Silent failure - message is lost!
        // No DLQ, no retry, nothing
    }
}
```

```java
// Log-only handling - still data loss
@KafkaListener(topics = "transactions")
public void processTransaction(String message) {
    try {
        Transaction tx = parse(message);
        process(tx);
    } catch (Exception e) {
        // Just logging is not enough!
        log.error("Transaction failed: {}", e.getMessage());
        // Message is acknowledged and lost
    }
}
```

```properties
# Kafka Connect - Tolerating errors without DLQ (bad!)
errors.tolerance=all
errors.log.enable=true
# Missing: errors.deadletterqueue.topic.name
# Result: Errors are silently dropped!
```

```java
// Anonymous consumer group - cannot use DLQ properly
public class BadConsumer {
    @KafkaListener(topics = "events")  // No group.id specified
    @DltHandler
    public void handleDlt(String message) {
        // This won't work with anonymous consumer groups!
        // Anonymous groups cannot enable DLQ feature
    }
}
```

### Good Example

```java
@KafkaListener(topics = "user-events", groupId = "user-service")
public void processUserEvent(ConsumerRecord<String, String> record,
                             Acknowledgment ack) {
    try {
        UserEvent event = parse(record.value());
        processEvent(event);
        ack.acknowledge();
    } catch (Exception e) {
        // Properly handle the error
        log.error("Failed to process user event from offset {}: {}",
            record.offset(), e.getMessage(), e);

        // Send to DLQ with full context
        sendToDLQWithMetadata(record, e);

        // Increment failure metrics
        failureCounter.increment();

        // Send alert if critical
        if (isCriticalError(e)) {
            alertService.sendAlert("CRITICAL_USER_EVENT_FAILURE",
                String.format("Error: %s, Offset: %d", e.getMessage(), record.offset()));
        }

        // Acknowledge to prevent reprocessing
        ack.acknowledge();
    }
}
```

```properties
# Kafka Connect - Proper error handling configuration
errors.tolerance=all
errors.log.enable=true
errors.log.include.messages=true

# REQUIRED: Configure DLQ to prevent data loss
errors.deadletterqueue.topic.name=connector-errors-dlq
errors.deadletterqueue.topic.replication.factor=3
errors.deadletterqueue.context.headers.enable=true

# Retry configuration
errors.retry.timeout=600000
errors.retry.delay.max.ms=30000
```

```java
// Explicit consumer group with proper DLQ configuration
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String>
            kafkaListenerContainerFactory(ConsumerFactory<String, String> consumerFactory,
                                         KafkaTemplate<String, String> kafkaTemplate) {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
            new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);

        // Configure error handler with DLQ
        DefaultErrorHandler errorHandler = new DefaultErrorHandler(
            new DeadLetterPublishingRecoverer(kafkaTemplate),
            new FixedBackOff(1000L, 3L)
        );

        // Don't swallow errors - route to DLQ
        factory.setCommonErrorHandler(errorHandler);

        // Enable manual acknowledgment for better control
        factory.getContainerProperties().setAckMode(AckMode.MANUAL);

        return factory;
    }
}

@Component
public class EventConsumer {

    @KafkaListener(
        topics = "events",
        groupId = "event-service",  // Explicit group ID required for DLQ
        containerFactory = "kafkaListenerContainerFactory"
    )
    public void consumeEvent(ConsumerRecord<String, String> record,
                            Acknowledgment ack) {
        // Processing logic
        // Errors automatically routed to DLQ by errorHandler
    }
}
```

### Detection Hints
- Empty catch blocks in Kafka listeners
- Catch blocks with only logging and no DLQ/retry
- `errors.tolerance=all` without `errors.deadletterqueue.topic.name`
- Anonymous consumer groups with DLT handlers
- Missing error handler configuration in Spring Kafka
- No `DeadLetterPublishingRecoverer` in error handler chain

**Code patterns to search:**
```java
catch (Exception e) { }  // Empty catch
catch (Exception e) { log.error(...); }  // Log-only, no DLQ
@KafkaListener(topics = ".*")  // No groupId
errors.tolerance=all  // Without deadletterqueue.topic.name
```

---

## Anti-Pattern 5: DLQ Without Retry Mechanism

### Pattern Name
**No-Retry DLQ** - Sending messages directly to DLQ on first failure without retry attempts for transient errors.

### Description
Immediately routing failed messages to DLQ without distinguishing between transient and permanent errors wastes DLQ capacity and creates unnecessary manual intervention. Transient errors (network timeouts, temporary service unavailability, rate limits) often resolve themselves with retry logic. Proper error handling includes:
- Retry with exponential backoff for transient errors
- Retry limits to prevent infinite loops
- DLQ as last resort after retries exhausted

### Bad Example

```java
// No retry - immediate DLQ on any failure
@KafkaListener(topics = "orders")
public void processOrder(ConsumerRecord<String, String> record) {
    try {
        Order order = deserialize(record.value());
        externalService.createOrder(order);  // Network call
    } catch (Exception e) {
        // First failure -> straight to DLQ (bad!)
        kafkaTemplate.send("orders-dlq", record.value());
    }
}
```

```properties
# Kafka Connect - No retry configuration (bad!)
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq
# Missing: retry configuration
# Result: Every error immediately goes to DLQ
```

```java
// Spring Kafka without retry configuration
@Configuration
public class BadKafkaConfig {
    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String>
            kafkaListenerContainerFactory() {
        ConcurrentKafkaListenerContainerFactory<String, String> factory =
            new ConcurrentKafkaListenerContainerFactory<>();

        // No error handler configured
        // Default behavior: fail fast, no retry

        return factory;
    }
}
```

### Good Example

```java
// Retry with exponential backoff before DLQ
@Component
public class OrderConsumer {
    private static final int MAX_RETRIES = 3;
    private static final long INITIAL_BACKOFF = 1000L;

    @KafkaListener(topics = "orders")
    public void processOrder(ConsumerRecord<String, String> record) {
        int retryCount = getRetryCount(record);

        try {
            Order order = deserialize(record.value());
            externalService.createOrder(order);
        } catch (TransientException e) {
            // Transient error - retry with backoff
            if (retryCount < MAX_RETRIES) {
                long backoff = INITIAL_BACKOFF * (long) Math.pow(2, retryCount);
                scheduleRetry(record, retryCount + 1, backoff);
                log.info("Scheduling retry {} for order {} after {}ms",
                    retryCount + 1, record.key(), backoff);
            } else {
                // Max retries reached - send to DLQ
                log.error("Max retries ({}) exceeded for order {}, sending to DLQ",
                    MAX_RETRIES, record.key());
                sendToDLQ(record, e, "MAX_RETRIES_EXCEEDED");
            }
        } catch (PermanentException e) {
            // Permanent error - immediate DLQ
            log.error("Permanent error for order {}, sending to DLQ", record.key());
            sendToDLQ(record, e, "PERMANENT_ERROR");
        }
    }

    private void scheduleRetry(ConsumerRecord<String, String> record,
                              int retryCount, long delayMs) {
        ProducerRecord<String, String> retryRecord = new ProducerRecord<>(
            "orders-retry",
            record.key(),
            record.value()
        );

        // Preserve original headers
        record.headers().forEach(h -> retryRecord.headers().add(h));

        // Add retry metadata
        retryRecord.headers().add("retry.count",
            String.valueOf(retryCount).getBytes());
        retryRecord.headers().add("retry.timestamp",
            Instant.now().toString().getBytes());
        retryRecord.headers().add("retry.delay.ms",
            String.valueOf(delayMs).getBytes());

        kafkaTemplate.send(retryRecord);
    }
}
```

```properties
# Kafka Connect - Proper retry configuration
errors.tolerance=all

# Retry settings
errors.retry.timeout=600000           # Retry for up to 10 minutes
errors.retry.delay.max.ms=30000       # Max 30 seconds between retries

# DLQ for messages that still fail after retries
errors.deadletterqueue.topic.name=connector-dlq
errors.deadletterqueue.topic.replication.factor=3
errors.deadletterqueue.context.headers.enable=true

# Logging
errors.log.enable=true
errors.log.include.messages=true
```

```java
// Spring Kafka with sophisticated retry and DLQ
@Configuration
public class KafkaRetryConfig {

    @Bean
    public ConcurrentKafkaListenerContainerFactory<String, String>
            kafkaListenerContainerFactory(
                ConsumerFactory<String, String> consumerFactory,
                KafkaTemplate<String, String> kafkaTemplate) {

        ConcurrentKafkaListenerContainerFactory<String, String> factory =
            new ConcurrentKafkaListenerContainerFactory<>();
        factory.setConsumerFactory(consumerFactory);

        // Configure exponential backoff: 1s, 2s, 4s, 8s, 16s
        ExponentialBackOff backOff = new ExponentialBackOff(1000L, 2.0);
        backOff.setMaxAttempts(5);
        backOff.setMaxInterval(30000L);  // Cap at 30 seconds

        // Create error handler with DLQ as final destination
        DeadLetterPublishingRecoverer recoverer =
            new DeadLetterPublishingRecoverer(kafkaTemplate,
                (record, ex) -> {
                    // Route to appropriate DLQ based on error type
                    if (ex.getCause() instanceof SerializationException) {
                        return new TopicPartition("orders-dlq-deserialization", -1);
                    } else if (isTransient(ex)) {
                        return new TopicPartition("orders-dlq-transient", -1);
                    } else {
                        return new TopicPartition("orders-dlq-permanent", -1);
                    }
                });

        DefaultErrorHandler errorHandler = new DefaultErrorHandler(recoverer, backOff);

        // Don't retry certain exceptions (e.g., deserialization errors)
        errorHandler.addNotRetryableExceptions(
            SerializationException.class,
            MessageConversionException.class
        );

        factory.setCommonErrorHandler(errorHandler);

        return factory;
    }

    private boolean isTransient(Throwable ex) {
        return ex instanceof TimeoutException
            || ex instanceof IOException
            || ex.getMessage().contains("timeout")
            || ex.getMessage().contains("connection refused");
    }
}
```

```java
// Using Spring Kafka's @RetryableTopic annotation
@Component
public class OrderConsumerWithRetryable {

    @RetryableTopic(
        attempts = "4",  // 1 initial + 3 retries
        backoff = @Backoff(
            delay = 1000,      // 1 second initial delay
            multiplier = 2.0,  // Exponential backoff
            maxDelay = 30000   // Max 30 seconds
        ),
        autoCreateTopics = "false",
        exclude = {
            SerializationException.class,
            DeserializationException.class
        },
        dltStrategy = DltStrategy.FAIL_ON_ERROR
    )
    @KafkaListener(topics = "orders", groupId = "order-service")
    public void processOrder(Order order) {
        // Processing logic
        // Automatic retry on failure
        // After max attempts -> goes to DLT
        externalService.createOrder(order);
    }

    @DltHandler
    public void handleDlt(Order order,
                         @Header(KafkaHeaders.EXCEPTION_MESSAGE) String exceptionMessage,
                         @Header(KafkaHeaders.EXCEPTION_STACKTRACE) String stackTrace) {
        // Handle messages that exhausted all retries
        log.error("Order sent to DLT after all retries failed. Order: {}, Error: {}",
            order.getId(), exceptionMessage);

        // Store in persistent DLQ for manual investigation
        dlqRepository.save(new DLQRecord(order, exceptionMessage, stackTrace));

        // Send alert
        alertService.sendAlert("ORDER_PROCESSING_FAILED",
            String.format("Order %s failed after retries", order.getId()));
    }
}
```

### Detection Hints
- Direct DLQ sends without retry logic
- Missing retry configuration in Kafka Connect
- No `errors.retry.timeout` or `errors.retry.delay.max.ms` properties
- Spring Kafka configs without `BackOff` or error handlers
- Missing `@RetryableTopic` annotation in Spring consumers
- No distinction between transient and permanent errors

**Code patterns to search:**
```java
catch (.*Exception e) {
    kafkaTemplate.send(".*-dlq", .*);  // No retry attempt
}

// Missing retry config
errors.tolerance=all
errors.deadletterqueue.topic.name=.*
// No errors.retry.* properties
```

---

## Anti-Pattern 6: Missing Original Headers/Context in DLQ Messages

### Pattern Name
**Header Loss** - DLQ messages lose original Kafka headers and custom application context during error routing.

### Description
When routing messages to DLQ, failing to preserve:
- Original Kafka headers (correlation IDs, trace IDs, custom business headers)
- Message lineage information
- Producer metadata
- Timestamps and ordering information

This breaks distributed tracing, makes correlation difficult, and loses valuable debugging context. Without headers, you can't:
- Trace message flow across services
- Correlate failures with upstream events
- Replay messages with original context
- Maintain audit trails

### Bad Example

```java
// Headers lost when creating new message
@KafkaListener(topics = "payments")
public void processPayment(ConsumerRecord<String, String> record) {
    try {
        process(record.value());
    } catch (Exception e) {
        // Creating new message without preserving headers!
        ProducerRecord<String, String> dlqRecord = new ProducerRecord<>(
            "payments-dlq",
            record.key(),
            record.value()
            // Missing: record.headers()
        );

        // Only adds error info, loses all original headers
        dlqRecord.headers().add("error", e.getMessage().getBytes());
        kafkaTemplate.send(dlqRecord);
    }
}
```

```java
// Using convenience method that loses headers
@KafkaListener(topics = "orders")
public void processOrder(ConsumerRecord<String, String> record) {
    try {
        process(record.value());
    } catch (Exception e) {
        // send(topic, key, value) doesn't preserve headers!
        kafkaTemplate.send("orders-dlq", record.key(), record.value());
    }
}
```

```properties
# Kafka Connect - Headers disabled
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq
errors.deadletterqueue.context.headers.enable=false  # Bad!
# Result: Loses all Kafka metadata and original headers
```

### Good Example

```java
@Component
@Slf4j
public class PaymentConsumer {
    private static final List<String> CRITICAL_HEADERS = Arrays.asList(
        "correlation-id",
        "trace-id",
        "span-id",
        "business-transaction-id",
        "idempotency-key",
        "source-system",
        "timestamp"
    );

    @KafkaListener(topics = "payments")
    public void processPayment(ConsumerRecord<String, String> record) {
        try {
            process(record.value());
        } catch (Exception e) {
            sendToDLQPreservingHeaders(record, e);
        }
    }

    private void sendToDLQPreservingHeaders(ConsumerRecord<String, String> record,
                                           Exception exception) {
        ProducerRecord<String, String> dlqRecord = new ProducerRecord<>(
            "payments-dlq",
            record.partition(),  // Preserve partition for ordering
            record.key(),
            record.value()
        );

        // 1. Preserve ALL original headers
        record.headers().forEach(header -> {
            dlqRecord.headers().add(
                header.key(),
                header.value()
            );
        });

        // 2. Add original Kafka metadata as new headers
        dlqRecord.headers().add("original.topic",
            record.topic().getBytes(StandardCharsets.UTF_8));
        dlqRecord.headers().add("original.partition",
            String.valueOf(record.partition()).getBytes());
        dlqRecord.headers().add("original.offset",
            String.valueOf(record.offset()).getBytes());
        dlqRecord.headers().add("original.timestamp",
            String.valueOf(record.timestamp()).getBytes());
        dlqRecord.headers().add("original.timestamp.type",
            record.timestampType().name().getBytes());

        // 3. Add error context
        dlqRecord.headers().add("error.timestamp",
            Instant.now().toString().getBytes());
        dlqRecord.headers().add("error.class",
            exception.getClass().getName().getBytes());
        dlqRecord.headers().add("error.message",
            truncate(exception.getMessage(), 1024).getBytes());
        dlqRecord.headers().add("error.stacktrace",
            getStackTraceAsString(exception).getBytes());

        // 4. Add processing context
        dlqRecord.headers().add("consumer.group",
            "payment-service".getBytes());
        dlqRecord.headers().add("consumer.host",
            getHostName().getBytes());

        // 5. Verify critical headers are present
        verifyCriticalHeaders(record.headers());

        kafkaTemplate.send(dlqRecord);

        // 6. Log with header context
        String correlationId = getHeaderValue(record.headers(), "correlation-id");
        log.error("Message sent to DLQ - correlationId: {}, offset: {}, error: {}",
            correlationId, record.offset(), exception.getMessage());
    }

    private void verifyCriticalHeaders(Headers headers) {
        List<String> missingHeaders = CRITICAL_HEADERS.stream()
            .filter(headerName -> getHeaderValue(headers, headerName) == null)
            .collect(Collectors.toList());

        if (!missingHeaders.isEmpty()) {
            log.warn("Message missing critical headers: {}", missingHeaders);
        }
    }

    private String getHeaderValue(Headers headers, String key) {
        Header header = headers.lastHeader(key);
        return header != null ? new String(header.value(), StandardCharsets.UTF_8) : null;
    }
}
```

```properties
# Kafka Connect - Headers enabled and enhanced
errors.tolerance=all
errors.deadletterqueue.topic.name=connector-dlq
errors.deadletterqueue.topic.replication.factor=3

# CRITICAL: Enable context headers
errors.deadletterqueue.context.headers.enable=true

# This adds the following headers automatically:
# - __connect.errors.topic
# - __connect.errors.partition
# - __connect.errors.offset
# - __connect.errors.connector.name
# - __connect.errors.task.id
# - __connect.errors.stage
# - __connect.errors.class.name
# - __connect.errors.exception.class.name
# - __connect.errors.exception.message
# - __connect.errors.exception.stacktrace

errors.log.enable=true
errors.log.include.messages=true
```

```java
// Spring Kafka - Custom DeadLetterPublishingRecoverer with header preservation
@Configuration
public class DLQConfig {

    @Bean
    public DeadLetterPublishingRecoverer deadLetterPublishingRecoverer(
            KafkaTemplate<String, String> kafkaTemplate) {

        DeadLetterPublishingRecoverer recoverer = new DeadLetterPublishingRecoverer(
            kafkaTemplate,
            (record, ex) -> new TopicPartition(record.topic() + "-dlq", -1)
        );

        // Customize headers added to DLQ messages
        recoverer.setHeadersFunction((consumerRecord, exception) -> {
            Headers headers = new RecordHeaders();

            // Preserve all original headers
            consumerRecord.headers().forEach(header ->
                headers.add(header.key(), header.value()));

            // Add custom error headers
            headers.add("dlq.exception.message",
                exception.getMessage().getBytes(StandardCharsets.UTF_8));
            headers.add("dlq.exception.type",
                exception.getClass().getName().getBytes(StandardCharsets.UTF_8));
            headers.add("dlq.exception.fqn",
                exception.getClass().getCanonicalName().getBytes());
            headers.add("dlq.original.topic",
                consumerRecord.topic().getBytes(StandardCharsets.UTF_8));
            headers.add("dlq.original.partition",
                String.valueOf(consumerRecord.partition()).getBytes());
            headers.add("dlq.original.offset",
                String.valueOf(consumerRecord.offset()).getBytes());
            headers.add("dlq.timestamp",
                Instant.now().toString().getBytes(StandardCharsets.UTF_8));

            return headers;
        });

        // Set to false to avoid appending default exception headers
        // (if you're adding your own custom headers)
        recoverer.setAppendOriginalHeaders(true);

        return recoverer;
    }

    @Bean
    public DefaultErrorHandler errorHandler(
            DeadLetterPublishingRecoverer recoverer) {

        DefaultErrorHandler handler = new DefaultErrorHandler(
            recoverer,
            new ExponentialBackOff(1000L, 2.0)
        );

        return handler;
    }
}
```

```java
// Utility class for header management
@Component
public class KafkaHeaderUtil {

    public static final String CORRELATION_ID = "correlation-id";
    public static final String TRACE_ID = "trace-id";
    public static final String ORIGINAL_TOPIC = "original.topic";
    public static final String ORIGINAL_OFFSET = "original.offset";

    /**
     * Copy all headers from source to destination record
     */
    public void copyHeaders(ConsumerRecord<?, ?> source,
                           ProducerRecord<?, ?> destination) {
        source.headers().forEach(header ->
            destination.headers().add(header.key(), header.value()));
    }

    /**
     * Get header value as String
     */
    public String getHeaderValue(Headers headers, String key) {
        Header header = headers.lastHeader(key);
        if (header == null) {
            return null;
        }
        return new String(header.value(), StandardCharsets.UTF_8);
    }

    /**
     * Add or update header value
     */
    public void setHeader(Headers headers, String key, String value) {
        headers.remove(key);  // Remove existing
        headers.add(key, value.getBytes(StandardCharsets.UTF_8));
    }

    /**
     * Extract all custom headers (non-Kafka internal headers)
     */
    public Map<String, String> extractCustomHeaders(Headers headers) {
        Map<String, String> customHeaders = new HashMap<>();
        headers.forEach(header -> {
            if (!header.key().startsWith("__") && !header.key().startsWith("kafka_")) {
                customHeaders.put(header.key(),
                    new String(header.value(), StandardCharsets.UTF_8));
            }
        });
        return customHeaders;
    }
}
```

### Detection Hints
- DLQ code using `send(topic, key, value)` instead of `send(ProducerRecord)`
- Creating new `ProducerRecord` without copying headers
- `errors.deadletterqueue.context.headers.enable=false` in configs
- Missing `record.headers().forEach()` loops in DLQ code
- No header preservation in custom error handlers
- Missing distributed tracing headers in DLQ messages

**Code patterns to search:**
```java
kafkaTemplate.send(".*-dlq", .*.key(), .*.value()); // No headers
new ProducerRecord<>(topic, key, value); // Headers not added
errors.deadletterqueue.context.headers.enable=false
```

---

## Summary Table

| Anti-Pattern | Impact | Key Detection |
|-------------|--------|---------------|
| Single DLQ for All Error Types | Difficult categorization, poor metrics, inefficient recovery | Single DLQ topic, no error type headers |
| DLQ Without Metadata | Can't debug or replay, lost context | Missing offset/timestamp/error headers |
| No Monitoring on DLQ | Silent failures, late detection, data loss | No metrics, no alerts, no dashboards |
| Silent Failures | Complete data loss, debugging impossible | Empty catch blocks, log-only handling |
| DLQ Without Retry | Wasted DLQ capacity, unnecessary manual work | No BackOff, immediate DLQ routing |
| Missing Original Headers | Broken tracing, lost correlation, difficult debugging | send(topic, key, value), context.headers.enable=false |

---

## References

This document was compiled from the following sources:

- [Kafka Dead Letter Queue Best Practices: Examples, Retries, and Monitoring - Superstream](https://www.superstream.ai/blog/kafka-dead-letter-queue)
- [Kafka Connect Deep Dive – Error Handling and Dead Letter Queues - Confluent](https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/)
- [Apache Kafka Dead Letter Queue: A Comprehensive Guide - Confluent](https://www.confluent.io/learn/kafka-dead-letter-queue/)
- [Error Handling via Dead Letter Queue in Apache Kafka - Kai Waehner](https://www.kai-waehner.de/blog/2022/05/30/error-handling-via-dead-letter-queue-in-apache-kafka/)
- [Kafka DLQ Guide - Svix Resources](https://www.svix.com/resources/guides/kafka-dlq/)
- [Can Your Kafka Consumers Handle a Poison Pill? - Confluent](https://www.confluent.io/blog/spring-kafka-can-your-kafka-consumers-handle-a-poison-pill/)
- [Kafka Resiliency — Retry/Delay Topic, Dead Letter Queue (DLQ) - Medium](https://medium.com/@shesh.soft/kafka-resiliency-retry-delay-topic-dead-letter-queue-dlq-fa2434688d22)
- [Handling Errors in Kafka Consumers - Medium](https://medium.com/@franco.torriani/handling-errors-in-kafka-consumers-ced0b3bad211)
- [Enhanced Dead Letter Queue - Karafka Documentation](https://karafka.io/docs/Pro-Enhanced-Dead-Letter-Queue/)
- [Apache Kafka Patterns and Anti-Patterns - DZone](https://dzone.com/refcardz/apache-kafka-patterns-and-anti-patterns)

---

## Version History

- v1.0 (2025-12-11): Initial compilation of Kafka DLQ anti-patterns
