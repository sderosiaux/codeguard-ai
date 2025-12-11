# Kafka Retry and Resilience Anti-Patterns

This document catalogs common anti-patterns related to retry logic and resilience in Kafka consumer applications, based on research from industry best practices and real-world incidents.

## Table of Contents

1. [Retry Inside Consumer Poll Loop (Blocking Retry)](#1-retry-inside-consumer-poll-loop-blocking-retry)
2. [No Exponential Backoff (Retry Storms)](#2-no-exponential-backoff-retry-storms)
3. [No Jitter (Thundering Herd)](#3-no-jitter-thundering-herd)
4. [Infinite Retries Without Circuit Breaker](#4-infinite-retries-without-circuit-breaker)
5. [Retrying Non-Retriable Errors](#5-retrying-non-retriable-errors)
6. [No Distinction Between Transient and Permanent Failures](#6-no-distinction-between-transient-and-permanent-failures)
7. [Ignoring max.poll.interval.ms During Retries](#7-ignoring-maxpollintervalms-during-retries)
8. [Missing Dead Letter Queue (DLQ) Strategy](#8-missing-dead-letter-queue-dlq-strategy)

---

## 1. Retry Inside Consumer Poll Loop (Blocking Retry)

### Description

Performing synchronous retries within the consumer's poll loop blocks the entire partition from processing subsequent messages. This creates a cascading failure where one failing message prevents all downstream messages from being consumed, potentially causing consumer rebalancing and duplicate message processing.

**Key Problems:**
- Blocks batch processing for all messages in the partition
- Risks exceeding `max.poll.interval.ms`, triggering rebalancing
- Creates "poison pill" scenarios where one bad message stops all processing
- No ability to configure retry delay or backoff
- Subsequent events cannot be processed until the failing message completes

### Bad Code Example (Java)

```java
@KafkaListener(topics = "orders")
public void consumeOrder(Order order) {
    int retries = 0;
    int maxRetries = 3;

    while (retries < maxRetries) {
        try {
            // Blocking retry inside poll loop
            orderService.processOrder(order);
            return; // Success
        } catch (Exception e) {
            retries++;
            if (retries >= maxRetries) {
                log.error("Failed to process order after {} retries", maxRetries);
                throw e; // This will cause rebalancing
            }
            // Blocking sleep in poll loop - ANTI-PATTERN
            Thread.sleep(1000 * retries);
        }
    }
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

consumer = KafkaConsumer('orders', group_id='order-processor')

for message in consumer:
    order = parse_order(message.value)
    retries = 0
    max_retries = 3

    # Blocking retry inside poll loop - ANTI-PATTERN
    while retries < max_retries:
        try:
            process_order(order)
            break
        except Exception as e:
            retries += 1
            if retries >= max_retries:
                print(f"Failed after {max_retries} retries")
                raise
            # Blocks entire partition
            time.sleep(1 * retries)
```

### Good Code Example (Java - Non-Blocking Retry)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration(KafkaTemplate<String, Order> template) {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(4)
            .exponentialBackoff(1000, 2, 10000) // 1s, 2s, 4s, 8s (max 10s)
            .retryTopicSuffix("-retry")
            .dltTopicSuffix("-dlt")
            .dltHandlerMethod("processOrderDlt")
            .build();
    }
}

@KafkaListener(topics = "orders")
public void consumeOrder(Order order) {
    // Process immediately - failures are sent to retry topic
    orderService.processOrder(order);
}

@DltHandler
public void processOrderDlt(Order order, @Header(KafkaHeaders.EXCEPTION_MESSAGE) String exception) {
    log.error("Order {} sent to DLT: {}", order.getId(), exception);
    alertingService.sendAlert("Order processing failed permanently", order);
}
```

### Good Code Example (Python - Async Retry with Separate Topic)

```python
from kafka import KafkaConsumer, KafkaProducer
import json

consumer = KafkaConsumer(
    'orders',
    group_id='order-processor',
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

retry_producer = KafkaProducer(
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

for message in consumer:
    order = message.value

    try:
        # Non-blocking - process immediately
        process_order(order)
    except TransientError as e:
        # Send to retry topic - don't block poll loop
        retry_count = order.get('retry_count', 0)

        if retry_count < 3:
            order['retry_count'] = retry_count + 1
            order['last_error'] = str(e)

            # Send to retry topic with delay (handled by separate consumer)
            retry_producer.send('orders-retry', value=order)
            print(f"Sent order {order['id']} to retry topic")
        else:
            # Send to DLT
            retry_producer.send('orders-dlt', value=order)
            print(f"Sent order {order['id']} to DLT after {retry_count} retries")
```

### Detection Hints

- Consumer logs show repeated processing of the same message offset
- Consumer rebalancing occurs frequently
- `max.poll.interval.ms` exceeded errors in logs
- Partition lag increases while consumer appears active
- High consumer group rebalancing rate
- `Thread.sleep()` or synchronous retries inside `@KafkaListener` methods
- No retry topics defined in topic list
- Consumer processing time consistently approaches or exceeds `max.poll.interval.ms`

**Metrics to Monitor:**
- `kafka.consumer.consumer_coordinator.commit_latency_avg` (increases)
- `kafka.consumer.fetch_manager.records_lag` (increases)
- Consumer rebalance rate (increases)
- Time between `poll()` calls (approaches max.poll.interval.ms)

---

## 2. No Exponential Backoff (Retry Storms)

### Description

Using fixed retry intervals causes "retry storms" where multiple consumers retry simultaneously at regular intervals, overwhelming the downstream service or database. Without exponential backoff, retries continue at the same rate, preventing the system from recovering and amplifying the load during failures.

**Key Problems:**
- All retries happen at the same interval, creating synchronized load spikes
- Prevents downstream services from recovering
- Wastes resources with rapid-fire retries
- Can amplify cascading failures across services
- Fixed delays don't account for varying failure scenarios

### Bad Code Example (Java)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();

        // Fixed backoff - ANTI-PATTERN
        FixedBackOffPolicy backOffPolicy = new FixedBackOffPolicy();
        backOffPolicy.setBackOffPeriod(1000); // Always 1 second

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(10); // 10 retries with same interval

        template.setBackOffPolicy(backOffPolicy);
        template.setRetryPolicy(retryPolicy);
        return template;
    }
}

@KafkaListener(topics = "events")
public void processEvent(Event event) {
    // All retries happen at 1-second intervals
    // Creates retry storm when service fails
    retryTemplate.execute(context -> {
        return externalService.process(event);
    });
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

def process_with_fixed_retry(event):
    max_attempts = 10
    fixed_delay = 1.0  # Always 1 second - ANTI-PATTERN

    for attempt in range(max_attempts):
        try:
            return external_service.process(event)
        except Exception as e:
            if attempt == max_attempts - 1:
                raise
            # Fixed delay creates retry storm
            time.sleep(fixed_delay)
```

### Good Code Example (Java - Exponential Backoff)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration(KafkaTemplate<String, Event> template) {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(5)
            // Exponential backoff: 1s, 2s, 4s, 8s, 16s (capped at 60s)
            .exponentialBackoff(1_000, 2.0, 60_000)
            .retryTopicSuffix("-retry")
            .dltTopicSuffix("-dlt")
            .build();
    }
}

@KafkaListener(topics = "events")
public void processEvent(Event event) {
    externalService.process(event);
}
```

### Good Code Example (Python - Exponential Backoff with Backoff Library)

```python
from kafka import KafkaConsumer
import backoff
import random

@backoff.on_exception(
    backoff.expo,  # Exponential backoff
    Exception,
    max_tries=5,
    max_time=300,  # Max 5 minutes total
    base=2,  # Base multiplier
    factor=1  # Starting at 1 second
)
def process_with_exponential_backoff(event):
    """
    Retry with exponential backoff:
    Attempt 1: immediate
    Attempt 2: ~2 seconds
    Attempt 3: ~4 seconds
    Attempt 4: ~8 seconds
    Attempt 5: ~16 seconds
    """
    return external_service.process(event)

consumer = KafkaConsumer('events', group_id='processor')

for message in consumer:
    event = message.value
    try:
        process_with_exponential_backoff(event)
    except Exception as e:
        send_to_dlq(event, str(e))
```

### Detection Hints

- Monitoring shows regular, synchronized spikes in retry attempts
- Downstream service load doesn't decrease during failures
- Retry intervals are constant in logs (e.g., always "retrying in 1000ms")
- Code uses `FixedBackOffPolicy` or fixed `sleep()` durations
- No multiplier or exponential factor in retry configuration
- Service metrics show consistent retry rates that don't decay
- Error rates remain constant across retry attempts

**Log Patterns:**
```
Retry attempt 1 - waiting 1000ms
Retry attempt 2 - waiting 1000ms
Retry attempt 3 - waiting 1000ms
```

**Code Smells:**
- `FixedBackOffPolicy` in Spring Kafka
- Fixed `time.sleep()` values
- No `multiplier` or `factor` parameter in retry config
- Constant `backoff_ms` values

---

## 3. No Jitter (Thundering Herd)

### Description

When multiple consumers retry at exactly the same time (synchronized by exponential backoff intervals), they create a "thundering herd" that overwhelms the recovering service. Jitter adds randomization to retry delays, distributing retry attempts across time and preventing coordinated traffic spikes.

**Key Problems:**
- All consumers retry simultaneously after the same backoff period
- Creates synchronized load spikes that prevent service recovery
- Amplifies the thundering herd problem with multiple consumer instances
- Downstream services experience burst traffic instead of gradual recovery
- Can trigger cascading failures in dependent systems

### Bad Code Example (Java)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();

        // Exponential backoff WITHOUT jitter - ANTI-PATTERN
        ExponentialBackOffPolicy backOffPolicy = new ExponentialBackOffPolicy();
        backOffPolicy.setInitialInterval(1000);
        backOffPolicy.setMultiplier(2.0);
        backOffPolicy.setMaxInterval(60000);
        // No jitter - all consumers retry at exactly the same time

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(5);

        template.setBackOffPolicy(backOffPolicy);
        template.setRetryPolicy(retryPolicy);
        return template;
    }
}

// With 100 consumers, all will retry at:
// t=1s, t=2s, t=4s, t=8s, t=16s
// Creating 100x load spikes
```

### Bad Code Example (Python)

```python
import time

def exponential_backoff_no_jitter(attempt):
    """Exponential backoff without jitter - ANTI-PATTERN"""
    delay = min(2 ** attempt, 60)  # Cap at 60 seconds
    # No randomization - all consumers wait exactly this time
    return delay

def process_with_retry(event):
    for attempt in range(5):
        try:
            return external_service.process(event)
        except Exception as e:
            if attempt == 4:
                raise
            # All consumers sleep for exactly the same duration
            delay = exponential_backoff_no_jitter(attempt)
            time.sleep(delay)
```

### Good Code Example (Java - Exponential Backoff with Jitter)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();

        // Exponential backoff WITH jitter
        ExponentialRandomBackOffPolicy backOffPolicy =
            new ExponentialRandomBackOffPolicy();
        backOffPolicy.setInitialInterval(1000);
        backOffPolicy.setMultiplier(2.0);
        backOffPolicy.setMaxInterval(60000);
        // Adds ±20% randomization to prevent thundering herd

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(5);

        template.setBackOffPolicy(backOffPolicy);
        template.setRetryPolicy(retryPolicy);
        return template;
    }
}

// Alternative: Manual jitter implementation
public class JitterBackoff {
    private static final Random RANDOM = new Random();

    public static long calculateBackoffWithJitter(int attempt) {
        long baseDelay = (long) Math.pow(2, attempt) * 1000; // Exponential
        long maxDelay = Math.min(baseDelay, 60000);

        // Add ±20% jitter
        double jitterFactor = 0.8 + (RANDOM.nextDouble() * 0.4); // 0.8 to 1.2
        return (long) (maxDelay * jitterFactor);
    }
}
```

### Good Code Example (Python - Full Jitter)

```python
import random
import time
from kafka import KafkaConsumer

def exponential_backoff_full_jitter(attempt, base_delay=1.0, max_delay=60.0):
    """
    Full jitter: random value between 0 and exponential backoff
    Recommended by AWS for preventing thundering herd
    """
    exponential_delay = min(base_delay * (2 ** attempt), max_delay)
    # Full jitter: random between 0 and exponential value
    return random.uniform(0, exponential_delay)

def exponential_backoff_equal_jitter(attempt, base_delay=1.0, max_delay=60.0):
    """
    Equal jitter: half exponential + random half
    Good balance between predictability and randomization
    """
    exponential_delay = min(base_delay * (2 ** attempt), max_delay)
    half = exponential_delay / 2
    # Equal jitter: half base + random half
    return half + random.uniform(0, half)

@backoff.on_exception(
    backoff.expo,
    Exception,
    max_tries=5,
    jitter=backoff.full_jitter,  # Adds randomization
    base=2,
    factor=1
)
def process_with_jittered_retry(event):
    return external_service.process(event)

# Manual implementation example
def process_with_manual_jitter(event):
    for attempt in range(5):
        try:
            return external_service.process(event)
        except Exception as e:
            if attempt == 4:
                raise
            # Use full jitter to prevent thundering herd
            delay = exponential_backoff_full_jitter(attempt)
            time.sleep(delay)
```

### Good Code Example (Spring Kafka - Randomized Backoff)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(5)
            // Uses internal randomization for backoff
            .exponentialBackoff(1_000, 2.0, 60_000)
            .retryTopicSuffix("-retry")
            .build();
    }
}

// Or custom jitter implementation
@Component
public class JitteredRetryTopicConfigurer implements RetryTopicConfigurer {

    @Override
    public Consumer<RetryTopicComponentFactory> configureCustomizer() {
        return factory -> {
            factory.setDestinationTopicResolver(
                new CustomJitteredDestinationTopicResolver()
            );
        };
    }
}
```

### Detection Hints

- Monitoring shows synchronized spikes in retry attempts across all consumers
- Downstream service receives burst traffic at predictable intervals
- Multiple consumer instances retry at exactly the same timestamps
- No randomization in backoff delay calculations
- Code uses `ExponentialBackOffPolicy` without random component
- Logs from different consumers show identical retry timestamps
- Service recovery is delayed by coordinated retry bursts

**Metrics Patterns:**
- Request rate shows sharp spikes at 1s, 2s, 4s, 8s intervals
- All consumer instances show synchronized retry behavior
- Downstream service load doesn't spread out during recovery

**Code Smells:**
- No `Random` or `jitter` in retry logic
- `ExponentialBackOffPolicy` instead of `ExponentialRandomBackOffPolicy`
- Fixed mathematical calculations without randomization
- No `jitter` parameter in backoff decorators

**Benchmark Data:**
According to Confluent 2025 benchmarks, workloads using backoff with jitter experienced 30% fewer message blockages compared to static retry delays.

---

## 4. Infinite Retries Without Circuit Breaker

### Description

Retrying indefinitely without a circuit breaker creates "poison pill" scenarios where failing messages block partition processing forever. Without retry limits or circuit breaking, consumers can't make progress, topics are blocked, and messages may be lost when they exceed retention periods.

**Key Problems:**
- Poison pill messages block partition processing indefinitely
- No mechanism to stop retries when downstream service is persistently down
- Application cannot progress and partition remains blocked
- Messages may be lost when they exceed Kafka topic retention period
- Resource exhaustion from infinite retry loops
- No escape hatch for permanently failing messages

### Bad Code Example (Java)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTemplate retryTemplate() {
        RetryTemplate template = new RetryTemplate();

        // UNLIMITED attempts - ANTI-PATTERN
        FixedBackOffPolicy backOffPolicy = new FixedBackOffPolicy();
        backOffPolicy.setBackOffPeriod(60000); // 1 minute

        SimpleRetryPolicy retryPolicy = new SimpleRetryPolicy();
        retryPolicy.setMaxAttempts(Integer.MAX_VALUE); // Infinite retries!

        template.setBackOffPolicy(backOffPolicy);
        template.setRetryPolicy(retryPolicy);
        return template;
    }
}

@KafkaListener(topics = "orders")
public void processOrder(Order order) {
    // Will retry forever if external service is down
    // Blocks entire partition indefinitely
    retryTemplate.execute(context -> {
        return externalService.createOrder(order);
    });
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

def process_with_infinite_retry(order):
    """Infinite retry loop - ANTI-PATTERN"""
    while True:  # No exit condition!
        try:
            return external_service.create_order(order)
        except Exception as e:
            print(f"Error processing order {order['id']}: {e}")
            # Retry forever, even if service is permanently down
            time.sleep(60)
            # No circuit breaker, no max attempts, no DLQ

consumer = KafkaConsumer('orders', group_id='order-processor')

for message in consumer:
    order = message.value
    # This will block forever on first failing message
    process_with_infinite_retry(order)
```

### Good Code Example (Java - Circuit Breaker with Resilience4j)

```java
@Configuration
public class ResilienceConfig {

    @Bean
    public CircuitBreakerRegistry circuitBreakerRegistry() {
        CircuitBreakerConfig config = CircuitBreakerConfig.custom()
            .failureRateThreshold(50) // Open circuit at 50% failure rate
            .waitDurationInOpenState(Duration.ofSeconds(60)) // Wait 60s before retry
            .slidingWindowSize(10) // Last 10 calls
            .minimumNumberOfCalls(5) // Need 5 calls to calculate rate
            .permittedNumberOfCallsInHalfOpenState(3)
            .build();

        return CircuitBreakerRegistry.of(config);
    }

    @Bean
    public CircuitBreaker externalServiceCircuitBreaker(
            CircuitBreakerRegistry registry) {
        return registry.circuitBreaker("externalService");
    }
}

@Service
public class OrderService {

    @Autowired
    private CircuitBreaker circuitBreaker;

    @KafkaListener(topics = "orders")
    public void processOrder(Order order) {
        try {
            // Wrapped with circuit breaker
            String result = circuitBreaker.executeSupplier(() ->
                externalService.createOrder(order)
            );
            log.info("Order processed: {}", result);

        } catch (CallNotPermittedException e) {
            // Circuit is open - don't retry
            log.error("Circuit breaker is OPEN for order {}", order.getId());
            sendToDLQ(order, "Circuit breaker open - service unavailable");

        } catch (Exception e) {
            log.error("Failed to process order {}", order.getId(), e);
            sendToRetryTopic(order, e);
        }
    }

    @RetryableTopic(
        attempts = "4",
        backoff = @Backoff(delay = 1000, multiplier = 2, maxDelay = 30000)
    )
    private void sendToRetryTopic(Order order, Exception e) {
        throw new RetryableException("Order processing failed", e);
    }
}
```

### Good Code Example (Python - Circuit Breaker with PyBreaker)

```python
from kafka import KafkaConsumer
from pybreaker import CircuitBreaker, CircuitBreakerError
import time

# Configure circuit breaker
circuit_breaker = CircuitBreaker(
    fail_max=5,  # Open circuit after 5 failures
    reset_timeout=60,  # Try again after 60 seconds
    exclude=[ValueError]  # Don't count these as failures
)

@circuit_breaker
def call_external_service(order):
    """Protected by circuit breaker"""
    return external_service.create_order(order)

def process_order_with_circuit_breaker(order, max_retries=3):
    """Limited retries with circuit breaker protection"""

    for attempt in range(max_retries):
        try:
            # Circuit breaker will raise CircuitBreakerError if open
            result = call_external_service(order)
            return result

        except CircuitBreakerError:
            # Circuit is open - service is down
            print(f"Circuit breaker OPEN for order {order['id']}")
            send_to_dlq(order, "Circuit breaker open - service unavailable")
            return None

        except Exception as e:
            if attempt == max_retries - 1:
                # Max retries reached
                print(f"Max retries reached for order {order['id']}")
                send_to_dlq(order, str(e))
                return None

            # Exponential backoff with jitter
            delay = min(2 ** attempt, 30) * random.uniform(0.8, 1.2)
            time.sleep(delay)

consumer = KafkaConsumer('orders', group_id='order-processor')

for message in consumer:
    order = message.value
    process_order_with_circuit_breaker(order)
    # Won't block forever - circuit breaker stops retries
```

### Good Code Example (Java - Spring Retry with Max Attempts)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(5) // Clear limit - NOT infinite
            .exponentialBackoff(1_000, 2.0, 60_000)
            .retryTopicSuffix("-retry")
            .dltTopicSuffix("-dlt")
            .dltHandlerMethod("handleDltOrder")
            .build();
    }
}

@Component
public class OrderConsumer {

    @KafkaListener(topics = "orders")
    public void processOrder(Order order) {
        // Will retry up to 5 times, then send to DLT
        externalService.createOrder(order);
    }

    @DltHandler
    public void handleDltOrder(Order order,
                               @Header(KafkaHeaders.EXCEPTION_MESSAGE) String error) {
        log.error("Order {} failed permanently: {}", order.getId(), error);
        alertService.sendAlert("Order processing failed", order, error);
        // Store in database for manual review
        failedOrderRepository.save(order);
    }
}
```

### Detection Hints

- Consumer appears stuck processing the same message for extended periods
- Logs show repeated retry attempts without end condition
- Partition lag increases while offset doesn't advance
- No DLT topic or error handling path configured
- Code uses `Integer.MAX_VALUE`, `while(true)`, or `FixedBackOffPolicy.UNLIMITED_ATTEMPTS`
- No circuit breaker configuration in codebase
- Consumer threads show high CPU usage but no progress
- Messages disappear after exceeding topic retention period

**Code Smells:**
- `maxAttempts = Integer.MAX_VALUE`
- `while (true)` in retry logic
- `FixedBackOffPolicy.UNLIMITED_ATTEMPTS`
- No DLT handler or error topic
- No circuit breaker dependency or configuration
- No `@DltHandler` annotation

**Log Patterns:**
```
Retry attempt 1 for order 123
Retry attempt 2 for order 123
Retry attempt 3 for order 123
...
Retry attempt 1000 for order 123
```

**Metrics:**
- Consumer offset doesn't advance for extended periods
- Same message offset appears repeatedly in logs
- Consumer lag increases linearly
- No messages sent to DLT topic

---

## 5. Retrying Non-Retriable Errors

### Description

Not all errors should be retried. Retrying non-retriable errors (like validation failures, authentication errors, or malformed data) wastes resources and creates unnecessary load. These errors won't resolve themselves through retries and should be sent directly to a dead letter queue.

**Key Problems:**
- Wastes resources retrying errors that will never succeed
- Delays detection and handling of permanent failures
- Increases system load unnecessarily
- Blocks processing of valid messages while retrying invalid ones
- Masks real issues that need immediate attention

**Examples of Non-Retriable Errors:**
- Validation errors (malformed JSON, missing required fields)
- Authentication/authorization failures
- Deserialization errors
- Business rule violations
- 4xx HTTP errors (400 Bad Request, 401 Unauthorized, 404 Not Found)
- Schema validation failures

**Examples of Retriable Errors:**
- Network timeouts
- Temporary unavailability (503 Service Unavailable)
- Connection refused
- Database deadlocks
- Rate limiting (429 Too Many Requests)
- 5xx HTTP errors (500 Internal Server Error, 502 Bad Gateway)

### Bad Code Example (Java)

```java
@KafkaListener(topics = "orders")
@RetryableTopic(
    attempts = "5",
    backoff = @Backoff(delay = 1000, multiplier = 2)
    // No exception classification - retries ALL errors!
)
public void processOrder(String orderJson) {
    try {
        // Will throw JsonProcessingException for invalid JSON
        Order order = objectMapper.readValue(orderJson, Order.class);

        // Will throw IllegalArgumentException for invalid data
        validateOrder(order);

        // Will throw various exceptions
        externalService.createOrder(order);

    } catch (Exception e) {
        // All exceptions treated the same - ANTI-PATTERN
        // Will retry validation errors, deserialization errors, etc.
        throw new RuntimeException("Order processing failed", e);
    }
}

// This will retry even for malformed JSON 5 times!
// Complete waste of resources
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import json
import time

def process_order_bad(order_json):
    """Retries all errors indiscriminately - ANTI-PATTERN"""
    max_attempts = 5

    for attempt in range(max_attempts):
        try:
            # May fail with JSONDecodeError (non-retriable)
            order = json.loads(order_json)

            # May fail with ValueError (non-retriable)
            validate_order(order)

            # May fail with various exceptions
            return external_service.create_order(order)

        except Exception as e:
            # Retries EVERYTHING, including validation errors
            if attempt == max_attempts - 1:
                raise
            time.sleep(2 ** attempt)

# This retries invalid JSON 5 times - wasteful!
```

### Good Code Example (Java - Exception Classification)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(4)
            .exponentialBackoff(1_000, 2.0, 30_000)
            // Classify exceptions - only retry retriable ones
            .notRetryOn(JsonProcessingException.class) // Deserialization
            .notRetryOn(ValidationException.class)     // Validation
            .notRetryOn(IllegalArgumentException.class) // Bad data
            .notRetryOn(AuthenticationException.class)  // Auth errors
            .retryOn(TimeoutException.class)           // Network timeout
            .retryOn(ServiceUnavailableException.class) // Temporary
            .dltTopicSuffix("-dlt")
            .build();
    }
}

@Component
public class OrderConsumer {

    @KafkaListener(topics = "orders")
    public void processOrder(String orderJson) throws Exception {
        try {
            Order order = parseAndValidate(orderJson);
            externalService.createOrder(order);

        } catch (JsonProcessingException | ValidationException e) {
            // Non-retriable - send directly to DLT
            log.error("Non-retriable error for message: {}", orderJson, e);
            throw e; // Will be caught by @notRetryOn and sent to DLT

        } catch (TimeoutException | ServiceUnavailableException e) {
            // Retriable - will go through retry flow
            log.warn("Retriable error, will retry: {}", e.getMessage());
            throw e;
        }
    }

    private Order parseAndValidate(String json)
            throws JsonProcessingException, ValidationException {
        Order order = objectMapper.readValue(json, Order.class);

        if (order.getAmount() <= 0) {
            throw new ValidationException("Amount must be positive");
        }
        if (order.getCustomerId() == null) {
            throw new ValidationException("Customer ID is required");
        }

        return order;
    }
}
```

### Good Code Example (Python - Smart Exception Classification)

```python
from kafka import KafkaConsumer
import json
import time
import requests

class NonRetriableError(Exception):
    """Base class for errors that shouldn't be retried"""
    pass

class ValidationError(NonRetriableError):
    pass

class DeserializationError(NonRetriableError):
    pass

class TransientError(Exception):
    """Base class for temporary errors that should be retried"""
    pass

def classify_http_error(status_code):
    """Determine if HTTP error is retriable"""
    # 4xx errors are client errors - not retriable
    if 400 <= status_code < 500:
        if status_code == 429:  # Rate limit
            return TransientError("Rate limited")
        return NonRetriableError(f"Client error: {status_code}")

    # 5xx errors are server errors - retriable
    if 500 <= status_code < 600:
        return TransientError(f"Server error: {status_code}")

    return NonRetriableError(f"Unknown status: {status_code}")

def parse_and_validate(order_json):
    """Parse and validate - raises NonRetriableError on failure"""
    try:
        order = json.loads(order_json)
    except json.JSONDecodeError as e:
        raise DeserializationError(f"Invalid JSON: {e}")

    # Validation checks
    if not order.get('customer_id'):
        raise ValidationError("customer_id is required")

    if order.get('amount', 0) <= 0:
        raise ValidationError("amount must be positive")

    return order

def call_external_service(order):
    """Call external service - classifies errors properly"""
    try:
        response = requests.post(
            'https://api.example.com/orders',
            json=order,
            timeout=5
        )
        response.raise_for_status()
        return response.json()

    except requests.Timeout:
        raise TransientError("Request timed out")

    except requests.ConnectionError:
        raise TransientError("Connection failed")

    except requests.HTTPError as e:
        # Classify based on status code
        error = classify_http_error(e.response.status_code)
        raise error

def process_order_smart(order_json, max_retries=3):
    """Smart retry - only retries transient errors"""

    try:
        # Parse and validate - will raise NonRetriableError if bad
        order = parse_and_validate(order_json)

    except NonRetriableError as e:
        # Don't retry - send directly to DLQ
        print(f"Non-retriable error: {e}")
        send_to_dlq(order_json, str(e), "VALIDATION_ERROR")
        return None

    # Now retry only transient errors
    for attempt in range(max_retries):
        try:
            return call_external_service(order)

        except TransientError as e:
            if attempt == max_retries - 1:
                print(f"Max retries reached: {e}")
                send_to_dlq(order, str(e), "MAX_RETRIES_EXCEEDED")
                return None

            # Exponential backoff for transient errors
            delay = min(2 ** attempt, 30) * random.uniform(0.8, 1.2)
            print(f"Transient error, retrying in {delay:.2f}s: {e}")
            time.sleep(delay)

        except NonRetriableError as e:
            # Caught from HTTP classification
            print(f"Non-retriable error from service: {e}")
            send_to_dlq(order, str(e), "SERVICE_REJECTED")
            return None

consumer = KafkaConsumer('orders', group_id='order-processor')

for message in consumer:
    process_order_smart(message.value)
```

### Good Code Example (Java - Custom Exception Classifier)

```java
@Component
public class SmartExceptionClassifier implements Predicate<Throwable> {

    private static final Set<Class<? extends Exception>> NON_RETRIABLE = Set.of(
        JsonProcessingException.class,
        ValidationException.class,
        IllegalArgumentException.class,
        AuthenticationException.class,
        DataIntegrityViolationException.class
    );

    @Override
    public boolean test(Throwable throwable) {
        // Return true if exception should be retried

        // Check if it's in non-retriable list
        if (NON_RETRIABLE.stream().anyMatch(c -> c.isInstance(throwable))) {
            return false;
        }

        // Check HTTP errors
        if (throwable instanceof HttpClientErrorException) {
            HttpClientErrorException httpEx = (HttpClientErrorException) throwable;
            int statusCode = httpEx.getStatusCode().value();

            // 4xx errors (except 429) are not retriable
            if (statusCode >= 400 && statusCode < 500) {
                return statusCode == 429; // Only retry rate limit
            }

            // 5xx errors are retriable
            return statusCode >= 500 && statusCode < 600;
        }

        // Network errors are retriable
        if (throwable instanceof TimeoutException ||
            throwable instanceof ConnectException ||
            throwable instanceof SocketTimeoutException) {
            return true;
        }

        // Default: don't retry unknown exceptions
        return false;
    }
}

@Configuration
public class KafkaRetryConfig {

    @Autowired
    private SmartExceptionClassifier exceptionClassifier;

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(4)
            .exponentialBackoff(1_000, 2.0, 30_000)
            // Use custom classifier
            .traversingCauses()
            .retryOn(exceptionClassifier)
            .dltTopicSuffix("-dlt")
            .build();
    }
}
```

### Detection Hints

- Logs show repeated retries for validation or deserialization errors
- High retry rate for messages with malformed data
- No exception classification or filtering in retry configuration
- All exceptions treated uniformly regardless of type
- DLT contains messages that were retried multiple times unnecessarily
- Monitoring shows retries for 4xx HTTP errors (except 429)
- Code catches `Exception` without distinguishing types

**Code Smells:**
- `catch (Exception e)` without type checking
- No `@notRetryOn` or exception classification
- Retrying `JsonProcessingException`, `ValidationException`
- No custom exception hierarchy (retriable vs non-retriable)
- Blanket retry policy on all exceptions

**Log Patterns:**
```
Retry attempt 1: JsonProcessingException: Unexpected character...
Retry attempt 2: JsonProcessingException: Unexpected character...
Retry attempt 3: JsonProcessingException: Unexpected character...
```

**Metrics:**
- High ratio of retries to successful processing
- Same error messages appearing repeatedly in retry logs
- DLT messages show validation/deserialization errors

---

## 6. No Distinction Between Transient and Permanent Failures

### Description

Failing to distinguish between transient errors (temporary issues that may resolve) and permanent failures (errors that won't resolve through retries) leads to inefficient resource usage and delayed error handling. Transient errors should be retried with backoff, while permanent errors should be sent directly to a dead letter queue.

**Key Problems:**
- Wastes resources retrying permanent failures
- Delays handling of messages that need manual intervention
- Obscures real issues behind retry noise
- Makes monitoring and alerting less effective
- Prevents fast-fail for truly broken messages

### Bad Code Example (Java)

```java
@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    @Retryable(
        maxAttempts = 5,
        backoff = @Backoff(delay = 1000, multiplier = 2)
    )
    public void processOrder(Order order) {
        // No distinction between error types - ANTI-PATTERN

        try {
            // Could throw validation error (permanent)
            validator.validate(order);

            // Could throw network error (transient)
            Customer customer = customerService.getCustomer(order.getCustomerId());

            // Could throw business rule violation (permanent)
            if (customer.getBalance() < order.getAmount()) {
                throw new RuntimeException("Insufficient balance");
            }

            // Could throw timeout (transient)
            paymentService.processPayment(order);

        } catch (Exception e) {
            // All errors handled the same way
            log.error("Error processing order", e);
            throw e; // Will retry regardless of error type
        }
    }
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

def process_order(order):
    """No error classification - ANTI-PATTERN"""
    max_retries = 5

    for attempt in range(max_retries):
        try:
            # Could fail with validation error (permanent)
            validate_order(order)

            # Could fail with network error (transient)
            customer = customer_service.get_customer(order['customer_id'])

            # Could fail with business rule (permanent)
            if customer['balance'] < order['amount']:
                raise Exception("Insufficient balance")

            # Could fail with timeout (transient)
            return payment_service.process(order)

        except Exception as e:
            # Treats all errors the same
            print(f"Error: {e}")
            if attempt < max_retries - 1:
                time.sleep(2 ** attempt)
            else:
                raise
```

### Good Code Example (Java - Error Classification)

```java
// Define exception hierarchy
public class TransientException extends RuntimeException {
    public TransientException(String message, Throwable cause) {
        super(message, cause);
    }
}

public class PermanentException extends RuntimeException {
    public PermanentException(String message, Throwable cause) {
        super(message, cause);
    }
}

@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    public void processOrder(Order order) {
        try {
            processOrderInternal(order);

        } catch (PermanentException e) {
            // Don't retry - send to DLT immediately
            log.error("Permanent failure for order {}: {}",
                order.getId(), e.getMessage());
            sendToDLQ(order, e, "PERMANENT_FAILURE");

        } catch (TransientException e) {
            // Retry with backoff
            log.warn("Transient failure for order {}, will retry: {}",
                order.getId(), e.getMessage());
            throw e; // Triggers retry mechanism
        }
    }

    private void processOrderInternal(Order order) {
        // Validation - permanent failure
        try {
            validator.validate(order);
        } catch (ValidationException e) {
            throw new PermanentException("Validation failed", e);
        }

        // Get customer - transient failure
        Customer customer;
        try {
            customer = customerService.getCustomer(order.getCustomerId());
        } catch (TimeoutException | ServiceUnavailableException e) {
            throw new TransientException("Customer service unavailable", e);
        } catch (CustomerNotFoundException e) {
            throw new PermanentException("Customer not found", e);
        }

        // Business rule check - permanent failure
        if (customer.getBalance() < order.getAmount()) {
            throw new PermanentException(
                "Insufficient balance: " + customer.getBalance(), null);
        }

        // Process payment - classify based on error
        try {
            paymentService.processPayment(order);
        } catch (TimeoutException e) {
            throw new TransientException("Payment timeout", e);
        } catch (PaymentDeclinedException e) {
            throw new PermanentException("Payment declined", e);
        } catch (RateLimitException e) {
            throw new TransientException("Rate limited", e);
        }
    }
}

@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryConfig() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(4)
            .exponentialBackoff(1_000, 2.0, 30_000)
            // Only retry transient exceptions
            .retryOn(TransientException.class)
            .notRetryOn(PermanentException.class)
            .dltTopicSuffix("-dlt")
            .build();
    }
}
```

### Good Code Example (Python - Error Classification)

```python
from kafka import KafkaConsumer
import time
import random

# Define exception hierarchy
class PermanentError(Exception):
    """Errors that won't resolve through retries"""
    pass

class TransientError(Exception):
    """Temporary errors that may resolve"""
    pass

class ErrorClassifier:
    """Classifies errors as transient or permanent"""

    @staticmethod
    def classify_validation_error(e):
        """Validation errors are always permanent"""
        return PermanentError(f"Validation failed: {e}")

    @staticmethod
    def classify_service_error(e):
        """Classify based on error type"""
        if isinstance(e, TimeoutError):
            return TransientError("Service timeout")
        elif isinstance(e, ConnectionError):
            return TransientError("Connection failed")
        elif "503" in str(e):
            return TransientError("Service unavailable")
        elif "404" in str(e):
            return PermanentError("Resource not found")
        elif "401" in str(e) or "403" in str(e):
            return PermanentError("Authentication failed")
        else:
            return PermanentError(f"Unknown error: {e}")

    @staticmethod
    def classify_business_error(e):
        """Business rule violations are permanent"""
        return PermanentError(f"Business rule violation: {e}")

def process_order_with_classification(order):
    """Process order with proper error classification"""

    # Step 1: Validation (permanent if fails)
    try:
        validate_order(order)
    except Exception as e:
        raise ErrorClassifier.classify_validation_error(e)

    # Step 2: Get customer (classify based on error)
    try:
        customer = customer_service.get_customer(order['customer_id'])
    except Exception as e:
        raise ErrorClassifier.classify_service_error(e)

    # Step 3: Business rules (permanent if fails)
    try:
        if customer['balance'] < order['amount']:
            raise ValueError("Insufficient balance")
    except Exception as e:
        raise ErrorClassifier.classify_business_error(e)

    # Step 4: Process payment (classify based on error)
    try:
        return payment_service.process(order)
    except Exception as e:
        raise ErrorClassifier.classify_service_error(e)

def consume_with_smart_retry(consumer):
    """Consumer with intelligent retry logic"""

    for message in consumer:
        order = message.value

        try:
            # Try to process
            result = process_order_with_classification(order)
            print(f"Order {order['id']} processed successfully")

        except PermanentError as e:
            # Don't retry - send directly to DLQ
            print(f"PERMANENT failure for order {order['id']}: {e}")
            send_to_dlq(
                order,
                error=str(e),
                reason="PERMANENT_FAILURE",
                retry_count=0
            )

        except TransientError as e:
            # Retry with exponential backoff
            print(f"TRANSIENT failure for order {order['id']}: {e}")
            retry_with_backoff(order, e)

def retry_with_backoff(order, initial_error, max_retries=3):
    """Retry only transient errors with exponential backoff"""

    for attempt in range(max_retries):
        try:
            # Add delay with jitter
            if attempt > 0:
                delay = min(2 ** attempt, 30) * random.uniform(0.8, 1.2)
                print(f"Retrying in {delay:.2f}s...")
                time.sleep(delay)

            return process_order_with_classification(order)

        except TransientError as e:
            print(f"Retry {attempt + 1}/{max_retries} failed: {e}")
            if attempt == max_retries - 1:
                # Max retries reached - send to DLQ
                send_to_dlq(
                    order,
                    error=str(e),
                    reason="MAX_RETRIES_EXCEEDED",
                    retry_count=max_retries
                )

        except PermanentError as e:
            # Permanent error discovered during retry
            print(f"Permanent error discovered: {e}")
            send_to_dlq(
                order,
                error=str(e),
                reason="PERMANENT_FAILURE_ON_RETRY",
                retry_count=attempt + 1
            )
            break

consumer = KafkaConsumer('orders', group_id='order-processor')
consume_with_smart_retry(consumer)
```

### Good Code Example (Java - HTTP Status Code Classification)

```java
@Component
public class HttpErrorClassifier {

    public RuntimeException classify(HttpClientErrorException ex) {
        int statusCode = ex.getStatusCode().value();

        if (statusCode >= 400 && statusCode < 500) {
            // 4xx errors are client errors (permanent)
            if (statusCode == 429) {
                // Rate limiting is transient
                return new TransientException("Rate limited", ex);
            }
            if (statusCode == 408) {
                // Request timeout can be transient
                return new TransientException("Request timeout", ex);
            }
            // Other 4xx are permanent
            return new PermanentException(
                "Client error: " + statusCode, ex);
        }

        if (statusCode >= 500 && statusCode < 600) {
            // 5xx errors are server errors (transient)
            return new TransientException("Server error: " + statusCode, ex);
        }

        return new PermanentException("Unknown error: " + statusCode, ex);
    }

    public RuntimeException classify(Exception ex) {
        // Network errors are transient
        if (ex instanceof TimeoutException ||
            ex instanceof SocketTimeoutException ||
            ex instanceof ConnectException) {
            return new TransientException("Network error", ex);
        }

        // Serialization errors are permanent
        if (ex instanceof JsonProcessingException ||
            ex instanceof SerializationException) {
            return new PermanentException("Serialization error", ex);
        }

        // Validation errors are permanent
        if (ex instanceof ValidationException ||
            ex instanceof IllegalArgumentException) {
            return new PermanentException("Validation error", ex);
        }

        // Default to permanent to be safe
        return new PermanentException("Unclassified error", ex);
    }
}
```

### Detection Hints

- No exception hierarchy distinguishing transient vs permanent errors
- All exceptions handled with same retry logic
- Validation and business rule violations being retried
- No fast-path to DLQ for obviously permanent failures
- Logs show retries for "not found", "unauthorized", "invalid data" errors
- Code catches generic `Exception` without classification
- No error categorization in monitoring/metrics

**Code Smells:**
- Single `catch (Exception e)` block
- No custom exception types
- No error classification logic
- Retrying 404, 401, validation errors
- No distinction in retry configuration

**Log Patterns:**
```
ERROR: Customer not found for ID 123, retrying...
ERROR: Customer not found for ID 123, retrying...
ERROR: Customer not found for ID 123, retrying...
```
(Should have gone to DLQ immediately)

**Metrics:**
- High retry rate for non-retriable error types
- DLQ receives messages only after max retries (not fast-fail)
- Average retry count is high for all error types

---

## 7. Ignoring max.poll.interval.ms During Retries

### Description

When processing time (including retries) exceeds `max.poll.interval.ms`, the Kafka broker considers the consumer failed and triggers rebalancing. This leads to duplicate processing, partition reassignment, and consumer instability. Developers must ensure total processing time stays within this limit or implement non-blocking retry patterns.

**Key Problems:**
- Consumer is removed from group due to poll timeout
- Triggers consumer group rebalancing
- Causes duplicate message processing
- Other consumers are affected by rebalancing
- Application becomes unstable with frequent rebalances

**Default Values:**
- `max.poll.interval.ms`: 300,000ms (5 minutes)
- `max.poll.records`: 500 records
- `session.timeout.ms`: 45,000ms (45 seconds)

### Bad Code Example (Java)

```java
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConsumerFactory<String, Order> consumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-processor");
        // Default max.poll.interval.ms = 5 minutes
        // No consideration for retry time!
        return new DefaultKafkaConsumerFactory<>(props);
    }
}

@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    @Retryable(
        maxAttempts = 10,
        backoff = @Backoff(delay = 60000) // 1 minute between retries
    )
    public void processOrder(Order order) {
        // With 10 retries at 1 minute each = 10 minutes total
        // This will exceed max.poll.interval.ms (5 min) on 6th retry
        // Consumer will be kicked out and rebalanced!

        externalService.processOrder(order);

        // Total time: initial attempt + (10 retries * 60s) = 10+ minutes
        // max.poll.interval.ms = 5 minutes
        // Result: Consumer rebalances after 5 minutes
    }
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='order-processor',
    max_poll_interval_ms=300000  # 5 minutes (default)
)

def process_with_blocking_retry(order):
    """Blocking retry that exceeds max_poll_interval_ms"""
    max_retries = 10
    retry_delay = 60  # 1 minute

    for attempt in range(max_retries):
        try:
            return external_service.process(order)
        except Exception as e:
            if attempt < max_retries - 1:
                print(f"Retry {attempt + 1}, waiting 60s...")
                time.sleep(retry_delay)  # Blocks for 1 minute
            else:
                raise

    # Total time: 10 retries * 60s = 600 seconds (10 minutes)
    # max_poll_interval_ms = 300 seconds (5 minutes)
    # Consumer will be removed from group!

for message in consumer:
    order = message.value
    # This can take 10+ minutes, exceeding max_poll_interval_ms
    process_with_blocking_retry(order)
```

### Good Code Example (Java - Increase max.poll.interval.ms)

```java
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConsumerFactory<String, Order> consumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-processor");

        // Calculate required time:
        // Max processing time: 30s
        // Max retries: 4
        // Max backoff: 16s (1s * 2^4)
        // Total retry time: 4 * 16s = 64s
        // Total max time: 30s + 64s = 94s
        // Add 20% buffer: 94s * 1.2 = 113s

        // Set max.poll.interval.ms to 2 minutes (120s) for safety
        props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 120_000);

        // Reduce batch size to process faster
        props.put(ConsumerConfig.MAX_POLL_RECORDS_CONFIG, 100);

        // Adjust heartbeat settings
        props.put(ConsumerConfig.SESSION_TIMEOUT_MS_CONFIG, 30_000); // 30s
        props.put(ConsumerConfig.HEARTBEAT_INTERVAL_MS_CONFIG, 10_000); // 10s

        return new DefaultKafkaConsumerFactory<>(props);
    }
}

@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    @RetryableTopic(
        attempts = "4",
        backoff = @Backoff(delay = 1000, multiplier = 2, maxDelay = 16000)
        // Total retry time: 1s + 2s + 4s + 8s + 16s = 31s
        // Well within max.poll.interval.ms of 120s
    )
    public void processOrder(Order order) {
        externalService.processOrder(order);
    }
}
```

### Good Code Example (Java - Non-Blocking Retry with Separate Topics)

```java
@Configuration
public class KafkaConsumerConfig {

    @Bean
    public ConsumerFactory<String, Order> consumerFactory() {
        Map<String, Object> props = new HashMap<>();
        props.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, "localhost:9092");
        props.put(ConsumerConfig.GROUP_ID_CONFIG, "order-processor");

        // Can keep default max.poll.interval.ms
        // Because retries happen asynchronously via retry topics
        props.put(ConsumerConfig.MAX_POLL_INTERVAL_MS_CONFIG, 300_000);

        return new DefaultKafkaConsumerFactory<>(props);
    }

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(10)
            // Long delays are OK because they happen in retry topics
            .fixedBackOff(60_000) // 1 minute between retries
            .retryTopicSuffix("-retry")
            .dltTopicSuffix("-dlt")
            .build();
    }
}

@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    public void processOrder(Order order) {
        // Process immediately - no blocking retries
        // Failures are sent to retry topic with delay
        externalService.processOrder(order);

        // poll() is called regularly, keeping consumer alive
        // Retries happen in separate topics, not blocking the poll loop
    }
}
```

### Good Code Example (Python - Async Retry Pattern)

```python
from kafka import KafkaConsumer, KafkaProducer
import json
import time

# Main consumer - processes quickly
consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='order-processor',
    max_poll_interval_ms=300000,  # 5 minutes (default)
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

# Retry producer
retry_producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

def process_order_fast(order):
    """Fast, non-blocking processing"""
    try:
        # Try once - don't block
        return external_service.process(order)

    except Exception as e:
        # Don't retry here - send to retry topic
        retry_count = order.get('retry_count', 0)

        if retry_count < 10:
            # Schedule retry via retry topic
            order['retry_count'] = retry_count + 1
            order['last_error'] = str(e)
            order['retry_at'] = time.time() + 60  # Retry in 60 seconds

            retry_producer.send('orders-retry', value=order)
            print(f"Scheduled retry for order {order['id']}")
        else:
            # Max retries - send to DLQ
            retry_producer.send('orders-dlt', value=order)
            print(f"Max retries reached for order {order['id']}")

# Main consumer loop - stays fast
for message in consumer:
    order = message.value
    # Process quickly - no blocking retries
    process_order_fast(order)
    # poll() called regularly, consumer stays healthy

# Separate consumer for retry topic
retry_consumer = KafkaConsumer(
    'orders-retry',
    bootstrap_servers='localhost:9092',
    group_id='order-retry-processor',
    max_poll_interval_ms=300000
)

for message in retry_consumer:
    order = message.value

    # Check if it's time to retry
    retry_at = order.get('retry_at', 0)
    if time.time() < retry_at:
        # Not yet - send back to retry topic
        retry_producer.send('orders-retry', value=order)
        continue

    # Time to retry
    process_order_fast(order)
```

### Good Code Example (Python - Configuring Timeouts Properly)

```python
from kafka import KafkaConsumer
import time

# Calculate required max_poll_interval_ms:
# - Average processing time: 10s per message
# - Max poll records: 100
# - Max total processing time: 10s * 100 = 1000s
# - Add 20% buffer: 1000s * 1.2 = 1200s
# - Set to 1200s (20 minutes)

consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='order-processor',

    # Adjusted for batch processing time
    max_poll_interval_ms=1200000,  # 20 minutes

    # Smaller batches for faster processing
    max_poll_records=50,  # Process 50 at a time instead of 500

    # Session timeout (heartbeat)
    session_timeout_ms=30000,  # 30 seconds
    heartbeat_interval_ms=10000,  # 10 seconds (1/3 of session timeout)

    # Fetch settings
    fetch_min_bytes=1,
    fetch_max_wait_ms=500
)

print(f"Consumer configured:")
print(f"  max_poll_interval_ms: {consumer.config['max_poll_interval_ms'] / 1000}s")
print(f"  max_poll_records: {consumer.config['max_poll_records']}")
print(f"  Max safe processing time per batch: "
      f"{consumer.config['max_poll_interval_ms'] / 1000}s")
```

### Detection Hints

- Frequent "consumer group rebalance" messages in logs
- "Offset commit failed" errors
- Consumer leaving and rejoining group repeatedly
- "Marking the coordinator dead" in logs
- Duplicate message processing
- Consumer lag increasing during processing
- Rebalancing correlation with long-running message processing

**Log Patterns:**
```
consumer.poll timeout expired
Attempt to heartbeat failed since group is rebalancing
Marking the coordinator dead
Revoking previously assigned partitions
Resetting offset for partition
```

**Metrics:**
- High rebalance rate
- `consumer.coordinator.commit.latency` increases
- `consumer.coordinator.join.time` spikes
- Processing time approaching or exceeding `max.poll.interval.ms`

**Configuration Issues:**
- `max.poll.interval.ms` too small for processing time
- `max.poll.records` too large for batch processing time
- Retry delay * max attempts > `max.poll.interval.ms`
- No adjustment for blocking retry logic

---

## 8. Missing Dead Letter Queue (DLQ) Strategy

### Description

Without a dead letter queue, failed messages either block processing indefinitely, are silently dropped, or cause application crashes. A DLQ provides a safety net for messages that cannot be processed after all retry attempts, enabling investigation, manual intervention, and system recovery.

**Key Problems:**
- Failed messages either block partitions or are lost
- No visibility into failing messages
- Cannot investigate root causes
- No mechanism for manual intervention or reprocessing
- Lost revenue/data from dropped messages
- Difficult to diagnose production issues

### Bad Code Example (Java)

```java
@Service
public class OrderProcessor {

    @KafkaListener(topics = "orders")
    @Retryable(maxAttempts = 3)
    public void processOrder(Order order) {
        try {
            externalService.processOrder(order);
        } catch (Exception e) {
            // What happens after max retries?
            // No DLQ configured - message is just lost!
            log.error("Failed to process order {}", order.getId(), e);
            // Message disappears into the void
        }
    }
}

@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryConfig() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(3)
            .exponentialBackoff(1000, 2, 10000)
            // No DLT configured - ANTI-PATTERN
            .build();
    }
}
```

### Bad Code Example (Python)

```python
from kafka import KafkaConsumer
import time

consumer = KafkaConsumer('orders', group_id='order-processor')

for message in consumer:
    order = message.value

    max_retries = 3
    for attempt in range(max_retries):
        try:
            external_service.process(order)
            break
        except Exception as e:
            if attempt == max_retries - 1:
                # Max retries reached - what now?
                print(f"Failed to process order {order['id']}: {e}")
                # Message is just dropped - ANTI-PATTERN
                # No DLQ, no alerting, no recovery
            else:
                time.sleep(2 ** attempt)
```

### Good Code Example (Java - DLQ with Spring Kafka)

```java
@Configuration
public class KafkaRetryConfig {

    @Bean
    public RetryTopicConfiguration retryTopicConfiguration() {
        return RetryTopicConfigurationBuilder
            .newInstance()
            .maxAttempts(4)
            .exponentialBackoff(1_000, 2.0, 30_000)
            .retryTopicSuffix("-retry")
            // Configure DLT
            .dltTopicSuffix("-dlt")
            .dltHandlerMethod("handleDltOrder")
            // Include headers for debugging
            .setIncludeHeaders(true)
            .build();
    }
}

@Component
public class OrderConsumer {

    @Autowired
    private AlertingService alertingService;

    @Autowired
    private FailedOrderRepository failedOrderRepository;

    @KafkaListener(topics = "orders")
    public void processOrder(Order order) {
        // Normal processing - failures go to retry topics
        externalService.processOrder(order);
    }

    @DltHandler
    public void handleDltOrder(
            Order order,
            @Header(KafkaHeaders.EXCEPTION_MESSAGE) String exceptionMessage,
            @Header(KafkaHeaders.EXCEPTION_STACKTRACE) String stackTrace,
            @Header(KafkaHeaders.ORIGINAL_TOPIC) String originalTopic,
            @Header(KafkaHeaders.RECEIVED_TIMESTAMP) long timestamp) {

        log.error("Order {} sent to DLT from topic {}. Error: {}",
            order.getId(), originalTopic, exceptionMessage);

        // Store in database for investigation
        FailedOrder failedOrder = FailedOrder.builder()
            .orderId(order.getId())
            .originalTopic(originalTopic)
            .payload(order)
            .errorMessage(exceptionMessage)
            .stackTrace(stackTrace)
            .failedAt(Instant.ofEpochMilli(timestamp))
            .status("PENDING_REVIEW")
            .build();

        failedOrderRepository.save(failedOrder);

        // Send alert to monitoring system
        alertingService.sendAlert(
            "Order Processing Failed",
            String.format("Order %s failed permanently: %s",
                order.getId(), exceptionMessage),
            AlertSeverity.HIGH
        );

        // Could also send to external system for manual review
        manualReviewService.submitForReview(order, exceptionMessage);
    }
}

// Repository for tracking failed messages
@Entity
@Table(name = "failed_orders")
public class FailedOrder {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    private String orderId;
    private String originalTopic;

    @Column(columnDefinition = "TEXT")
    private String payload;

    @Column(columnDefinition = "TEXT")
    private String errorMessage;

    @Column(columnDefinition = "TEXT")
    private String stackTrace;

    private Instant failedAt;
    private String status; // PENDING_REVIEW, IN_PROGRESS, RESOLVED, IGNORED

    // Manual intervention tracking
    private String assignedTo;
    private Instant reviewedAt;
    private String resolution;
}

// Service for reprocessing failed messages
@Service
public class FailedOrderReprocessingService {

    @Autowired
    private KafkaTemplate<String, Order> kafkaTemplate;

    @Autowired
    private FailedOrderRepository repository;

    public void reprocessOrder(Long failedOrderId) {
        FailedOrder failedOrder = repository.findById(failedOrderId)
            .orElseThrow(() -> new NotFoundException("Failed order not found"));

        // Send back to original topic for reprocessing
        kafkaTemplate.send(
            failedOrder.getOriginalTopic(),
            failedOrder.getPayload()
        );

        // Update status
        failedOrder.setStatus("REPROCESSING");
        failedOrder.setReprocessedAt(Instant.now());
        repository.save(failedOrder);

        log.info("Reprocessing failed order {}", failedOrder.getOrderId());
    }
}
```

### Good Code Example (Python - DLQ Implementation)

```python
from kafka import KafkaConsumer, KafkaProducer
import json
import time
from datetime import datetime
import traceback

# Configure producer for DLQ
dlq_producer = KafkaProducer(
    bootstrap_servers='localhost:9092',
    value_serializer=lambda v: json.dumps(v).encode('utf-8')
)

def send_to_dlq(message, error, retry_count, original_topic):
    """Send failed message to DLQ with metadata"""
    dlq_message = {
        'original_topic': original_topic,
        'original_partition': message.partition,
        'original_offset': message.offset,
        'original_timestamp': message.timestamp,
        'payload': message.value,
        'error_message': str(error),
        'stack_trace': traceback.format_exc(),
        'retry_count': retry_count,
        'failed_at': datetime.utcnow().isoformat(),
        'headers': {k: v.decode() for k, v in message.headers} if message.headers else {}
    }

    # Send to DLQ topic
    dlq_topic = f"{original_topic}-dlt"
    dlq_producer.send(dlq_topic, value=dlq_message)

    # Log for monitoring
    print(f"Sent to DLQ: topic={original_topic}, "
          f"offset={message.offset}, error={error}")

    # Store in database for tracking
    store_failed_message_in_db(dlq_message)

    # Send alert
    send_alert(
        severity='HIGH',
        message=f"Message failed permanently: {error}",
        details=dlq_message
    )

def store_failed_message_in_db(dlq_message):
    """Store failed message in database for investigation"""
    # Insert into failed_messages table
    db.execute("""
        INSERT INTO failed_messages
        (original_topic, payload, error_message, stack_trace,
         retry_count, failed_at, status)
        VALUES (?, ?, ?, ?, ?, ?, 'PENDING_REVIEW')
    """, (
        dlq_message['original_topic'],
        json.dumps(dlq_message['payload']),
        dlq_message['error_message'],
        dlq_message['stack_trace'],
        dlq_message['retry_count'],
        dlq_message['failed_at']
    ))

def send_alert(severity, message, details):
    """Send alert to monitoring system"""
    # Send to Slack, PagerDuty, etc.
    alerting_service.send(
        severity=severity,
        title="Kafka Message Failed",
        message=message,
        details=details
    )

def process_with_dlq(message, original_topic):
    """Process message with DLQ fallback"""
    max_retries = 3

    for attempt in range(max_retries):
        try:
            # Try to process
            result = external_service.process(message.value)
            return result

        except Exception as e:
            if attempt == max_retries - 1:
                # Max retries - send to DLQ
                send_to_dlq(
                    message=message,
                    error=e,
                    retry_count=max_retries,
                    original_topic=original_topic
                )
                return None

            # Retry with backoff
            delay = min(2 ** attempt, 30)
            time.sleep(delay)

# Main consumer
consumer = KafkaConsumer(
    'orders',
    bootstrap_servers='localhost:9092',
    group_id='order-processor',
    value_deserializer=lambda m: json.loads(m.decode('utf-8'))
)

for message in consumer:
    process_with_dlq(message, 'orders')

# DLQ monitoring consumer
def monitor_dlq():
    """Monitor DLQ for issues"""
    dlq_consumer = KafkaConsumer(
        'orders-dlt',
        bootstrap_servers='localhost:9092',
        group_id='dlq-monitor',
        value_deserializer=lambda m: json.loads(m.decode('utf-8'))
    )

    for message in dlq_consumer:
        dlq_data = message.value

        # Log DLQ message
        print(f"DLQ message detected: {dlq_data['error_message']}")

        # Update metrics
        metrics.increment('dlq.messages', tags={
            'topic': dlq_data['original_topic'],
            'error_type': classify_error(dlq_data['error_message'])
        })

        # Check if automatic reprocessing is possible
        if is_retriable_after_fix(dlq_data):
            schedule_reprocessing(dlq_data)

# Reprocessing service
def reprocess_failed_message(failed_message_id):
    """Reprocess a failed message from database"""
    # Retrieve from database
    failed_msg = db.get_failed_message(failed_message_id)

    # Send back to original topic
    producer = KafkaProducer(
        bootstrap_servers='localhost:9092',
        value_serializer=lambda v: json.dumps(v).encode('utf-8')
    )

    producer.send(
        failed_msg['original_topic'],
        value=failed_msg['payload']
    )

    # Update database
    db.execute("""
        UPDATE failed_messages
        SET status = 'REPROCESSING', reprocessed_at = ?
        WHERE id = ?
    """, (datetime.utcnow(), failed_message_id))

    print(f"Reprocessing message {failed_message_id}")
```

### Good Code Example (Java - DLQ Dashboard and Management)

```java
@RestController
@RequestMapping("/api/failed-orders")
public class FailedOrderController {

    @Autowired
    private FailedOrderRepository repository;

    @Autowired
    private FailedOrderReprocessingService reprocessingService;

    @GetMapping
    public Page<FailedOrder> getFailedOrders(
            @RequestParam(defaultValue = "0") int page,
            @RequestParam(defaultValue = "50") int size,
            @RequestParam(required = false) String status) {

        if (status != null) {
            return repository.findByStatus(status, PageRequest.of(page, size));
        }
        return repository.findAll(PageRequest.of(page, size));
    }

    @GetMapping("/stats")
    public FailedOrderStats getStats() {
        return FailedOrderStats.builder()
            .totalFailed(repository.count())
            .pendingReview(repository.countByStatus("PENDING_REVIEW"))
            .inProgress(repository.countByStatus("IN_PROGRESS"))
            .resolved(repository.countByStatus("RESOLVED"))
            .failuresByTopic(repository.countByTopic())
            .failuresByErrorType(repository.countByErrorType())
            .build();
    }

    @PostMapping("/{id}/reprocess")
    public ResponseEntity<String> reprocessOrder(@PathVariable Long id) {
        try {
            reprocessingService.reprocessOrder(id);
            return ResponseEntity.ok("Order queued for reprocessing");
        } catch (Exception e) {
            return ResponseEntity.badRequest()
                .body("Failed to reprocess: " + e.getMessage());
        }
    }

    @PostMapping("/reprocess-batch")
    public ResponseEntity<BatchReprocessResult> reprocessBatch(
            @RequestBody List<Long> ids) {

        BatchReprocessResult result = new BatchReprocessResult();

        for (Long id : ids) {
            try {
                reprocessingService.reprocessOrder(id);
                result.addSuccess(id);
            } catch (Exception e) {
                result.addFailure(id, e.getMessage());
            }
        }

        return ResponseEntity.ok(result);
    }

    @PutMapping("/{id}/assign")
    public ResponseEntity<FailedOrder> assignToUser(
            @PathVariable Long id,
            @RequestParam String assignee) {

        FailedOrder order = repository.findById(id)
            .orElseThrow(() -> new NotFoundException("Order not found"));

        order.setAssignedTo(assignee);
        order.setStatus("IN_PROGRESS");
        order.setReviewedAt(Instant.now());

        return ResponseEntity.ok(repository.save(order));
    }
}
```

### Detection Hints

- No DLT topic configured in Kafka topics list
- Failed messages either lost or blocking partitions
- No visibility into failing messages
- Logs show errors but no downstream handling
- No alerting on permanent failures
- No mechanism for reprocessing failed messages
- Application crashes or hangs on persistent errors

**Code Smells:**
- No `@DltHandler` annotation
- No `.dltTopicSuffix()` in configuration
- No DLQ producer or topic
- Empty catch blocks after max retries
- No database table for failed messages
- No alerting on failures

**Configuration Issues:**
- No DLT topic in topic list
- No DLQ consumer or monitoring
- No retry → DLT flow configured

**Operational Issues:**
- Cannot investigate production failures
- No way to reprocess failed messages
- Lost business data from failed messages
- Difficult debugging in production

---

## Summary

These eight anti-patterns represent the most common and impactful mistakes in Kafka retry and resilience strategies:

1. **Retry Inside Consumer Poll Loop** - Blocks entire partition, causes rebalancing
2. **No Exponential Backoff** - Creates retry storms, prevents recovery
3. **No Jitter** - Causes thundering herd, synchronized traffic spikes
4. **Infinite Retries Without Circuit Breaker** - Poison pill messages, resource exhaustion
5. **Retrying Non-Retriable Errors** - Wastes resources, delays error handling
6. **No Distinction Between Transient and Permanent Failures** - Inefficient retry logic
7. **Ignoring max.poll.interval.ms** - Causes rebalancing, duplicate processing
8. **Missing Dead Letter Queue** - Lost messages, no recovery mechanism

### Best Practices Summary

- **Always use non-blocking retry** via separate retry topics
- **Implement exponential backoff with jitter** (recommended: base=1s, multiplier=2, max=60s, ±20% jitter)
- **Classify exceptions** as transient (retriable) vs permanent (non-retriable)
- **Set retry limits** (recommended: 3-5 attempts)
- **Configure circuit breakers** for downstream service failures
- **Always implement DLQ** for permanently failed messages
- **Monitor and alert** on DLQ messages
- **Configure max.poll.interval.ms** appropriately (processing time + retry time + buffer)
- **Test failure scenarios** to ensure retry logic works correctly

### Key Metrics to Monitor

- Consumer lag
- Rebalance rate
- Retry attempt count
- DLQ message rate
- Processing time vs max.poll.interval.ms
- Error rates by type (transient vs permanent)
- Circuit breaker state transitions

---

## Sources

This knowledge base was compiled from:

- [AWS Builders Library - Timeouts, Retries, and Backoff with Jitter](https://aws.amazon.com/builders-library/timeouts-retries-and-backoff-with-jitter/)
- [Lydtech Consulting - Kafka Consumer Non-Blocking Retry Pattern](https://www.lydtechconsulting.com/blog-kafka-non-blocking-retry.html)
- [Lydtech Consulting - Kafka Consumer Retry](https://www.lydtechconsulting.com/blog/kafka-consumer-retry)
- [CodeStudy - Kafka Consumer Poll Exceptions Guide](https://www.codestudy.net/blog/kafka-consumer-poll-exceptions/)
- [Baeldung - Implementing Retry in Kafka Consumer](https://www.baeldung.com/spring-retry-kafka-consumer)
- [Adservio - Kafka Patterns and Anti-Patterns](https://www.adservio.fr/post/kafka-patterns-and-anti-patterns)
- [Spring Kafka Documentation - Retry Topics](https://docs.spring.io/spring-kafka/reference/retrytopic.html)
- [Confluent - Kafka Connect Error Handling and DLQ](https://www.confluent.io/blog/kafka-connect-deep-dive-error-handling-dead-letter-queues/)
- [Confluent - Apache Kafka Dead Letter Queue Guide](https://www.confluent.io/learn/kafka-dead-letter-queue/)
- [Kai Waehner - Error Handling via DLQ in Apache Kafka](https://www.kai-waehner.de/blog/2022/05/30/error-handling-via-dead-letter-queue-in-apache-kafka/)
- [Baeldung - Dead Letter Queue for Kafka with Spring](https://www.baeldung.com/kafka-spring-dead-letter-queue)
- [MoldStud - Retry Strategies for Kafka Consumer Errors](https://moldstud.com/articles/p-the-importance-of-retry-mechanisms-in-kafka-consumer-error-management)
- [Apache Kafka KIP-580 - Exponential Backoff for Kafka Clients](https://cwiki.apache.org/confluence/display/KAFKA/KIP-580:+Exponential+Backoff+for+Kafka+Clients)
- [Confluent - Kafka Consumer Configuration Reference](https://docs.confluent.io/platform/current/installation/configuration/consumer-configs.html)
- [Medium - Mastering Kafka Consumer Configurations](https://medium.com/@raphy.26.007/mastering-kafka-consumer-configurations-understanding-max-poll-interval-ms-and-beyon-9eec493be744)
- [Strimzi - Optimizing Kafka Consumers](https://strimzi.io/blog/2021/01/07/consumer-tuning/)
- [AWS re:Post - Troubleshoot MSK Consumer Group Rebalancing](https://repost.aws/knowledge-center/msk-consumer-group-rebalance)
- Industry best practices and real-world production incidents
