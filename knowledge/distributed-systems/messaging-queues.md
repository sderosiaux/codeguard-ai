# Message Queues: Ordering, Delivery, and Processing Patterns

This document describes common anti-patterns and best practices for implementing message queues, handling ordering guarantees, delivery semantics, and distributed messaging in microservices architectures. These patterns are critical for building reliable, high-performance event-driven systems.

## Anti-Pattern: Assuming Message Ordering Across Partitions

### Description
A common mistake is assuming that messages will be processed in global order across multiple partitions or queue instances. Most distributed message queues (Kafka, AWS SQS standard queues, RabbitMQ with multiple consumers) only guarantee ordering within a single partition or message group, not across the entire queue.

### Bad Code Example

```python
# ANTI-PATTERN: Assuming global ordering in standard SQS
def process_order_events():
    sqs = boto3.client('sqs')
    queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/orders'

    while True:
        messages = sqs.receive_message(QueueUrl=queue_url, MaxNumberOfMessages=10)

        for msg in messages.get('Messages', []):
            event = json.loads(msg['Body'])
            # WRONG: Assumes events arrive in order
            if event['type'] == 'ORDER_CREATED':
                create_order(event['order_id'])
            elif event['type'] == 'ORDER_SHIPPED':
                ship_order(event['order_id'])  # May arrive before ORDER_CREATED!
```

**Problems:**
- Standard SQS provides at-least-once delivery with best-effort ordering only
- Messages can arrive out of order
- Race conditions when ORDER_SHIPPED arrives before ORDER_CREATED
- Multiple consumers receive messages in parallel without coordination
- No partition key to group related messages

### Good Code Example

```python
# GOOD: Use FIFO queue with message groups for ordering
def process_order_events():
    sqs = boto3.client('sqs')
    # Note: .fifo suffix required for FIFO queues
    queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/orders.fifo'

    while True:
        messages = sqs.receive_message(
            QueueUrl=queue_url,
            MaxNumberOfMessages=10,
            WaitTimeSeconds=20  # Long polling
        )

        for msg in messages.get('Messages', []):
            event = json.loads(msg['Body'])
            order_id = event['order_id']

            # Process with idempotency check
            if is_already_processed(event['event_id']):
                sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=msg['ReceiptHandle'])
                continue

            # Process events - guaranteed in order for same order_id
            if event['type'] == 'ORDER_CREATED':
                create_order(order_id)
            elif event['type'] == 'ORDER_SHIPPED':
                ship_order(order_id)

            # Mark as processed
            mark_processed(event['event_id'])
            sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=msg['ReceiptHandle'])

# When publishing, use MessageGroupId for ordering
def publish_order_event(event):
    sqs.send_message(
        QueueUrl='https://sqs.us-east-1.amazonaws.com/123456789/orders.fifo',
        MessageBody=json.dumps(event),
        MessageGroupId=event['order_id'],  # Ensures same order_id messages are ordered
        MessageDeduplicationId=event['event_id']  # Prevents duplicates
    )
```

### Key Takeaways
- **Use FIFO queues** when ordering is critical (AWS SQS FIFO, Kafka partitions)
- **Implement message grouping**: Use MessageGroupId (SQS) or partition keys (Kafka) to group related messages
- **Design for idempotency**: Even with FIFO, implement deduplication checks
- **Understand throughput tradeoffs**: FIFO queues have lower throughput (300 TPS in SQS vs unlimited in standard)
- **Consider event versioning**: Include timestamps or sequence numbers in messages for ordering validation
- **Don't assume global ordering**: Only messages within the same partition/group are ordered

## Anti-Pattern: Not Implementing Idempotent Message Handlers

### Description
Message brokers that guarantee at-least-once delivery can deliver the same message multiple times, especially during network failures or consumer crashes. Handlers that are not idempotent can cause duplicate processing, leading to double charges, duplicate records, or inconsistent state.

### Bad Code Example

```csharp
// ANTI-PATTERN: Non-idempotent payment processing
public async Task ProcessPaymentMessage(Message msg)
{
    var payment = JsonSerializer.Deserialize<Payment>(msg.Body);

    // WRONG: No duplicate check - may charge customer twice
    await paymentGateway.ChargeCard(payment.CustomerId, payment.Amount);

    await database.ExecuteAsync(
        "INSERT INTO payments (id, customer_id, amount, status) VALUES (@Id, @CustomerId, @Amount, 'COMPLETED')",
        payment
    );

    await queueClient.CompleteMessageAsync(msg);
}
```

**Problems:**
- No check if message already processed
- Credit card charged multiple times on retry
- Duplicate database records created
- No transactional boundary between payment and database insert
- External service call sits outside any transaction

### Good Code Example

```csharp
// GOOD: Idempotent consumer with inbox pattern
public async Task ProcessPaymentMessage(Message msg)
{
    var payment = JsonSerializer.Deserialize<Payment>(msg.Body);
    var messageId = msg.MessageId;

    using var transaction = await database.BeginTransactionAsync();

    try
    {
        // Check if already processed (inbox pattern)
        var exists = await database.ExecuteScalarAsync<bool>(
            "SELECT COUNT(*) > 0 FROM processed_messages WHERE message_id = @MessageId",
            new { MessageId = messageId }
        );

        if (exists)
        {
            // Already processed - just acknowledge
            await queueClient.CompleteMessageAsync(msg);
            return;
        }

        // Insert into inbox table first (same transaction)
        await database.ExecuteAsync(
            "INSERT INTO processed_messages (message_id, received_at, payload) VALUES (@MessageId, @ReceivedAt, @Payload)",
            new { MessageId = messageId, ReceivedAt = DateTime.UtcNow, Payload = msg.Body }
        );

        // Check if payment already exists
        var paymentExists = await database.ExecuteScalarAsync<bool>(
            "SELECT COUNT(*) > 0 FROM payments WHERE id = @Id",
            new { payment.Id }
        );

        if (!paymentExists)
        {
            // Use idempotency key for external call
            await paymentGateway.ChargeCard(
                payment.CustomerId,
                payment.Amount,
                idempotencyKey: payment.Id  // Gateway will deduplicate
            );

            await database.ExecuteAsync(
                "INSERT INTO payments (id, customer_id, amount, status) VALUES (@Id, @CustomerId, @Amount, 'COMPLETED')",
                payment
            );
        }

        await transaction.CommitAsync();
        await queueClient.CompleteMessageAsync(msg);
    }
    catch (Exception ex)
    {
        await transaction.RollbackAsync();
        // Message will be redelivered
        throw;
    }
}
```

### Key Takeaways
- **Store processed message IDs**: Use inbox pattern with PROCESSED_MESSAGES table
- **Single transaction boundary**: Record message ID and business logic in same transaction
- **Use idempotency keys for external services**: Pass unique keys to third-party APIs
- **Apply selectively**: Only use where duplicate processing causes real harm (financial, data consistency)
- **Lazy vs eager approach**: Store message ID when handler completes successfully (simpler to reason about)
- **Don't confuse with duplicate detection**: Server-generated keys conflate "retry" with "duplicate business operation"

## Anti-Pattern: Ignoring Visibility Timeout Configuration

### Description
Visibility timeout determines how long a message remains invisible after being received by a consumer. Setting it too short causes premature redelivery while the original consumer is still processing. Setting it too long delays retry when a consumer crashes.

### Bad Code Example

```javascript
// ANTI-PATTERN: Default visibility timeout with long processing
const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

async function processMessages() {
    const params = {
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/tasks',
        MaxNumberOfMessages: 1,
        // WRONG: Using default 30 second visibility timeout
    };

    while (true) {
        const data = await sqs.receiveMessage(params).promise();

        for (const msg of data.Messages || []) {
            // Processing takes 2-3 minutes
            await processLargeDataset(msg.Body);  // 120+ seconds
            await performMLInference(msg.Body);   // 60 seconds
            await uploadResults(msg.Body);        // 30 seconds

            // By now, message is already visible again!
            // Another consumer may have picked it up
            await sqs.deleteMessage({
                QueueUrl: params.QueueUrl,
                ReceiptHandle: msg.ReceiptHandle
            }).promise();
        }
    }
}
```

**Problems:**
- Default visibility timeout (30 seconds) too short for actual processing time (3+ minutes)
- Message becomes visible again while still being processed
- Multiple consumers process the same message simultaneously
- Duplicate processing and wasted resources
- DeleteMessage fails if visibility timeout expired

### Good Code Example

```javascript
// GOOD: Configure visibility timeout and extend as needed
const AWS = require('aws-sdk');
const sqs = new AWS.SQS();

async function processMessages() {
    const VISIBILITY_TIMEOUT = 300; // 5 minutes initial
    const EXTEND_THRESHOLD = 60;     // Extend with 60s remaining
    const EXTEND_BY = 120;           // Add 2 more minutes

    const params = {
        QueueUrl: 'https://sqs.us-east-1.amazonaws.com/123456789/tasks',
        MaxNumberOfMessages: 1,
        VisibilityTimeout: VISIBILITY_TIMEOUT,
        WaitTimeSeconds: 20  // Long polling
    };

    while (true) {
        const data = await sqs.receiveMessage(params).promise();

        for (const msg of data.Messages || []) {
            let visibilityDeadline = Date.now() + (VISIBILITY_TIMEOUT * 1000);

            try {
                // Start processing with timeout extension
                const extendInterval = setInterval(async () => {
                    const timeRemaining = visibilityDeadline - Date.now();

                    if (timeRemaining < EXTEND_THRESHOLD * 1000) {
                        await sqs.changeMessageVisibility({
                            QueueUrl: params.QueueUrl,
                            ReceiptHandle: msg.ReceiptHandle,
                            VisibilityTimeout: EXTEND_BY
                        }).promise();

                        visibilityDeadline = Date.now() + (EXTEND_BY * 1000);
                        console.log(`Extended visibility timeout by ${EXTEND_BY}s`);
                    }
                }, 30000);  // Check every 30 seconds

                await processLargeDataset(msg.Body);
                await performMLInference(msg.Body);
                await uploadResults(msg.Body);

                clearInterval(extendInterval);

                // Delete after successful processing
                await sqs.deleteMessage({
                    QueueUrl: params.QueueUrl,
                    ReceiptHandle: msg.ReceiptHandle
                }).promise();

            } catch (error) {
                clearInterval(extendInterval);
                console.error('Processing failed:', error);
                // Message will become visible again for retry
            }
        }
    }
}
```

### Key Takeaways
- **Set visibility timeout > max processing time**: Start with realistic estimate (e.g., 5-15 minutes)
- **Implement heartbeat/extension**: Use ChangeMessageVisibility to extend timeout for long-running tasks
- **Monitor actual processing times**: Adjust based on CloudWatch metrics
- **Use dead letter queues**: Configure MaxReceiveCount for messages that repeatedly fail
- **Consider Lambda timeout alignment**: For Lambda consumers, set visibility timeout > Lambda timeout
- **Batch processing considerations**: For batch operations, calculate timeout × batch size

## Anti-Pattern: Short Polling Instead of Long Polling

### Description
Short polling repeatedly calls ReceiveMessage with immediate returns, resulting in many empty responses, higher costs, and increased latency. Long polling waits for messages to arrive (up to 20 seconds in SQS), significantly reducing empty responses and API calls.

### Bad Code Example

```python
# ANTI-PATTERN: Short polling with tight loop
import boto3
import time

sqs = boto3.client('sqs')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/events'

while True:
    # WRONG: WaitTimeSeconds not set - defaults to 0 (short polling)
    response = sqs.receive_message(
        QueueUrl=queue_url,
        MaxNumberOfMessages=10
    )

    messages = response.get('Messages', [])

    if not messages:
        time.sleep(0.1)  # Tiny delay before polling again
        continue  # Empty response - wasted API call

    for msg in messages:
        process_message(msg)
        sqs.delete_message(QueueUrl=queue_url, ReceiptHandle=msg['ReceiptHandle'])
```

**Problems:**
- Generates thousands of empty ReceiveMessage calls per hour
- Higher AWS costs (charged per request)
- Increased latency to detect new messages
- Unnecessary network traffic
- CPU cycles wasted on polling

### Good Code Example

```python
# GOOD: Long polling with appropriate wait time
import boto3

sqs = boto3.client('sqs')
queue_url = 'https://sqs.us-east-1.amazonaws.com/123456789/events'

while True:
    response = sqs.receive_message(
        QueueUrl=queue_url,
        MaxNumberOfMessages=10,
        WaitTimeSeconds=20,  # Long polling - wait up to 20 seconds
        AttributeNames=['All'],
        MessageAttributeNames=['All']
    )

    messages = response.get('Messages', [])

    # Process all received messages
    for msg in messages:
        try:
            process_message(msg)
            sqs.delete_message(
                QueueUrl=queue_url,
                ReceiptHandle=msg['ReceiptHandle']
            )
        except Exception as e:
            print(f"Failed to process message: {e}")
            # Message will become visible again after visibility timeout

# Alternative: Configure long polling at queue level
# Then WaitTimeSeconds parameter is optional
sqs.set_queue_attributes(
    QueueUrl=queue_url,
    Attributes={
        'ReceiveMessageWaitTimeSeconds': '20'
    }
)
```

### Key Takeaways
- **Always use long polling**: Set WaitTimeSeconds=20 (maximum for SQS)
- **Configure at queue level**: Set ReceiveMessageWaitTimeSeconds attribute for all consumers
- **Reduces costs**: Up to 10x fewer API calls
- **Lower latency**: Messages delivered faster than short polling with delays
- **Works with batch operations**: Combine with MaxNumberOfMessages=10 for efficiency
- **No downside**: Long polling is strictly better than short polling

## Anti-Pattern: Not Using Dead Letter Queues

### Description
Messages can fail processing for many reasons: malformed data, external service unavailability, bugs in consumer code. Without a Dead Letter Queue (DLQ), failed messages are either lost or endlessly retried, blocking the queue and preventing successful messages from being processed.

### Bad Code Example

```java
// ANTI-PATTERN: No DLQ, endless retry on permanent failures
@Service
public class OrderProcessor {

    @SqsListener("orders-queue")
    public void processOrder(String messageBody) {
        try {
            Order order = objectMapper.readValue(messageBody, Order.class);

            // WRONG: Malformed JSON or invalid data will retry forever
            validateOrder(order);  // Throws on invalid data

            // WRONG: External service permanently down
            paymentService.charge(order.getPaymentToken());

            inventoryService.reserveItems(order.getItems());

        } catch (Exception e) {
            // Message visibility expires, becomes available again
            // Will retry indefinitely, blocking queue
            log.error("Failed to process order", e);
            throw new RuntimeException(e);  // Triggers retry
        }
    }
}
```

**Problems:**
- Messages with permanent failures retry forever
- Blocks queue processing capacity
- No visibility into failing messages
- Cannot distinguish transient from permanent failures
- Wastes compute resources on unprocessable messages
- No way to debug or fix problematic messages

### Good Code Example

```java
// GOOD: DLQ configured with appropriate retry limits
@Service
public class OrderProcessor {

    // Configure DLQ at queue creation/infrastructure level:
    // MaxReceiveCount: 3 (try 3 times before moving to DLQ)
    // RedrivePolicy points to orders-dlq

    @SqsListener("orders-queue")
    public void processOrder(Message message, @Header("ApproximateReceiveCount") int receiveCount) {
        String messageBody = message.getPayload();

        try {
            Order order = objectMapper.readValue(messageBody, Order.class);

            // Validate early - permanent failures should fail fast
            validateOrder(order);

            // Transient failures - will retry up to MaxReceiveCount
            paymentService.charge(order.getPaymentToken());
            inventoryService.reserveItems(order.getItems());

            log.info("Order processed successfully: {}", order.getId());

        } catch (JsonProcessingException | ValidationException e) {
            // Permanent failure - log and let it go to DLQ
            log.error("Invalid order format, will move to DLQ after max retries: {}", messageBody, e);
            throw new RuntimeException("Permanent failure", e);

        } catch (PaymentException | InventoryException e) {
            // Transient failure - may succeed on retry
            if (receiveCount >= 3) {
                log.error("Max retries reached, sending to DLQ: {}", order.getId(), e);
            } else {
                log.warn("Transient failure (attempt {}), will retry: {}", receiveCount, order.getId(), e);
            }
            throw new RuntimeException("Transient failure", e);
        }
    }

    // Separate consumer for DLQ messages
    @SqsListener("orders-dlq")
    public void handleDlqMessage(String messageBody,
                                  @Header("DeadLetterReason") String reason,
                                  @Header("MessageId") String messageId) {

        log.error("Message {} in DLQ. Reason: {}. Body: {}", messageId, reason, messageBody);

        // Send alert to operations team
        alertService.sendAlert("Order processing failed", messageId, reason);

        // Store for manual review
        failedMessageRepository.save(new FailedMessage(messageId, reason, messageBody));
    }
}

// Infrastructure code (e.g., Terraform, CloudFormation)
// Create DLQ
resource "aws_sqs_queue" "orders_dlq" {
  name = "orders-dlq"
  message_retention_seconds = 1209600  // 14 days
}

// Main queue with DLQ configuration
resource "aws_sqs_queue" "orders" {
  name = "orders-queue"
  visibility_timeout_seconds = 300

  redrive_policy = jsonencode({
    deadLetterTargetArn = aws_sqs_queue.orders_dlq.arn
    maxReceiveCount     = 3  // Move to DLQ after 3 failed attempts
  })
}
```

### Key Takeaways
- **Always configure DLQ**: Set MaxReceiveCount (typically 3-5) for automatic transfer
- **Distinguish failure types**: Fail fast on permanent errors, retry transient failures
- **Monitor DLQ depth**: Set up CloudWatch alarms for messages in DLQ
- **Implement DLQ processing**: Create separate consumer or manual review process
- **Log detailed context**: Include DeadLetterReason, timestamps, message ID for debugging
- **Retention policy**: Set longer retention in DLQ (14 days) for investigation
- **Manual reprocessing**: Build tools to resubmit fixed messages from DLQ to main queue

## Anti-Pattern: False Sharing in Concurrent Queue Implementations

### Description
In high-performance queue implementations, false sharing occurs when multiple threads access different variables that reside on the same CPU cache line (typically 64 bytes). Updates from one thread invalidate the entire cache line, forcing other threads to reload from main memory, causing severe performance degradation.

### Bad Code Example

```java
// ANTI-PATTERN: Queue head and tail on same cache line
public class NaiveRingBuffer<T> {
    private final T[] buffer;
    private volatile long head = 0;  // Written by consumers
    private volatile long tail = 0;  // Written by producers
    private final int capacity;

    // WRONG: head and tail are adjacent in memory
    // Consumer updating head invalidates producer's tail cache line
    // Producer updating tail invalidates consumer's head cache line

    public boolean offer(T element) {
        long currentTail = tail;
        long nextTail = currentTail + 1;

        if (nextTail - head > capacity) {
            return false;  // Queue full
        }

        buffer[(int)(currentTail % capacity)] = element;
        tail = nextTail;  // Cache line invalidation!
        return true;
    }

    public T poll() {
        long currentHead = head;

        if (currentHead >= tail) {
            return null;  // Queue empty
        }

        T element = buffer[(int)(currentHead % capacity)];
        head = currentHead + 1;  // Cache line invalidation!
        return element;
    }
}
```

**Problems:**
- Head and tail pointers share same cache line
- Every update causes cache invalidation on other cores
- Can see 50%+ CPU cycles spent on memory stalls
- Performance degrades with more cores (more cache coherency traffic)
- Throughput much lower than theoretical maximum

### Good Code Example

```java
// GOOD: Cache line padding to prevent false sharing (LMAX Disruptor pattern)
public class PaddedRingBuffer<T> {
    // Cache line padding for head sequence
    protected long p1, p2, p3, p4, p5, p6, p7;
    protected volatile long head = 0;  // Consumer sequence
    protected long p9, p10, p11, p12, p13, p14, p15;

    // Cache line padding for tail sequence
    protected long p16, p17, p18, p19, p20, p21, p22;
    protected volatile long tail = 0;  // Producer sequence
    protected long p24, p25, p26, p27, p28, p29, p30;

    private final T[] buffer;
    private final int capacity;
    private final int indexMask;  // capacity - 1 for fast modulo

    public PaddedRingBuffer(int capacity) {
        // Capacity must be power of 2
        if ((capacity & (capacity - 1)) != 0) {
            throw new IllegalArgumentException("Capacity must be power of 2");
        }
        this.capacity = capacity;
        this.indexMask = capacity - 1;
        this.buffer = (T[]) new Object[capacity];
    }

    public boolean offer(T element) {
        long currentTail = tail;
        long nextTail = currentTail + 1;

        // Use cached head value (stale is OK, just conservative)
        if (nextTail - head > capacity) {
            // Reload fresh head value only when needed
            if (nextTail - getHead() > capacity) {
                return false;  // Queue truly full
            }
        }

        buffer[(int)(currentTail & indexMask)] = element;  // Fast modulo
        tail = nextTail;  // Only invalidates tail's cache line
        return true;
    }

    public T poll() {
        long currentHead = head;

        // Use cached tail value
        if (currentHead >= getTail()) {
            return null;  // Queue empty
        }

        T element = buffer[(int)(currentHead & indexMask)];
        head = currentHead + 1;  // Only invalidates head's cache line
        return element;
    }

    private long getHead() {
        return head;  // Volatile read
    }

    private long getTail() {
        return tail;  // Volatile read
    }
}
```

### Key Takeaways
- **Pad critical fields**: Separate frequently-updated fields by 64+ bytes (typical cache line size)
- **Use powers of 2**: Enables fast bitwise modulo operations (& instead of %)
- **Single writer pattern**: Minimize write contention on shared state
- **Pre-allocate buffer**: Eliminates allocation and GC overhead
- **Batch operations**: Process multiple elements per volatile write
- **LMAX Disruptor**: Study this pattern for highest performance (25M+ msgs/sec, <50ns latency)
- **Java 9+ @Contended**: Use annotation for automatic padding

## Pattern: Event Sourcing for Message Ordering and Recovery

### Description
Event sourcing stores all changes as a sequence of immutable events in an append-only log. This provides perfect ordering guarantees, complete audit trail, and ability to reconstruct any state by replaying events. Particularly powerful when combined with in-memory processing.

### Good Code Example

```csharp
// Event store as source of truth
public class OrderEventStore
{
    private readonly IEventStore eventStore;

    // Append events to log - never update or delete
    public async Task AppendEvent(string streamId, IEvent @event)
    {
        await eventStore.AppendToStreamAsync(
            streamId,
            ExpectedVersion.Any,
            new EventData(
                eventId: Guid.NewGuid(),
                type: @event.GetType().Name,
                isJson: true,
                data: Encoding.UTF8.GetBytes(JsonSerializer.Serialize(@event)),
                metadata: null
            )
        );
    }

    // Reconstruct state by replaying events
    public async Task<Order> GetOrderState(string orderId)
    {
        var streamId = $"order-{orderId}";
        var events = await eventStore.ReadStreamEventsForwardAsync(streamId, 0, 4096);

        var order = new Order { Id = orderId };

        foreach (var @event in events.Events)
        {
            var eventType = Type.GetType(@event.Event.EventType);
            var eventData = JsonSerializer.Deserialize(
                Encoding.UTF8.GetString(@event.Event.Data),
                eventType
            );

            // Apply event to rebuild state
            order.Apply((IEvent)eventData);
        }

        return order;
    }
}

// Domain model applies events
public class Order
{
    public string Id { get; set; }
    public OrderStatus Status { get; set; }
    public List<OrderItem> Items { get; set; } = new();
    public decimal TotalAmount { get; set; }

    // Apply events to update state
    public void Apply(IEvent @event)
    {
        switch (@event)
        {
            case OrderCreatedEvent e:
                Status = OrderStatus.Created;
                Items = e.Items;
                TotalAmount = e.TotalAmount;
                break;

            case OrderPaymentReceivedEvent e:
                Status = OrderStatus.PaymentReceived;
                break;

            case OrderShippedEvent e:
                Status = OrderStatus.Shipped;
                break;

            case OrderCancelledEvent e:
                Status = OrderStatus.Cancelled;
                break;
        }
    }
}

// Business logic processor (single-threaded for determinism)
public class OrderProcessor
{
    private readonly Dictionary<string, Order> inMemoryState = new();
    private readonly OrderEventStore eventStore;

    public async Task ProcessCommand(ICommand command)
    {
        IEvent[] events;

        // Generate events based on command
        switch (command)
        {
            case CreateOrderCommand cmd:
                events = new IEvent[] { new OrderCreatedEvent(cmd.OrderId, cmd.Items) };
                break;
            case ConfirmPaymentCommand cmd:
                events = new IEvent[] { new OrderPaymentReceivedEvent(cmd.OrderId) };
                break;
            // ... other commands
            default:
                throw new InvalidOperationException("Unknown command");
        }

        // Persist events first (durable)
        foreach (var @event in events)
        {
            await eventStore.AppendEvent($"order-{command.OrderId}", @event);
        }

        // Update in-memory state
        if (!inMemoryState.TryGetValue(command.OrderId, out var order))
        {
            order = new Order { Id = command.OrderId };
            inMemoryState[command.OrderId] = order;
        }

        foreach (var @event in events)
        {
            order.Apply(@event);
        }
    }

    // Restore state on startup by replaying events
    public async Task RestoreState()
    {
        var allEvents = await eventStore.ReadAllEventsForwardAsync(Position.Start);

        foreach (var @event in allEvents.Events)
        {
            var streamId = @event.OriginalStreamId;
            var orderId = streamId.Replace("order-", "");

            if (!inMemoryState.ContainsKey(orderId))
            {
                inMemoryState[orderId] = new Order { Id = orderId };
            }

            var eventData = JsonSerializer.Deserialize<IEvent>(
                Encoding.UTF8.GetString(@event.Event.Data)
            );

            inMemoryState[orderId].Apply(eventData);
        }
    }
}
```

### Key Takeaways
- **Append-only log**: Never update or delete events, only append new ones
- **Deterministic replay**: Same events in same order always produce same state
- **Single-threaded processing**: Eliminates concurrency issues, ensures ordering
- **In-memory state**: Fast processing (6M+ orders/sec per LMAX architecture)
- **Durable events**: Journal events to disk/distributed log for durability
- **Temporal queries**: Query state at any point in time by replaying to that point
- **Debugging**: Reproduce production issues in development by replaying events
- **Works well with CQRS**: Event-sourced write side, separate read models

## Pattern: Exactly-Once Delivery with Transactional Outbox

### Description
Achieving exactly-once message delivery requires coordinating database updates and message publishing in a single atomic operation. The transactional outbox pattern writes messages to a database table in the same transaction as business data, then a separate process reliably publishes them to the message queue.

### Good Code Example

```python
# Application writes to outbox table in same transaction
class OrderService:
    def create_order(self, order_data):
        with db.transaction() as txn:
            # Insert business data
            order_id = txn.execute("""
                INSERT INTO orders (customer_id, total_amount, status)
                VALUES (%(customer_id)s, %(total_amount)s, 'PENDING')
                RETURNING id
            """, order_data).fetchone()[0]

            # Insert message into outbox (same transaction)
            event = {
                'event_type': 'OrderCreated',
                'order_id': order_id,
                'customer_id': order_data['customer_id'],
                'timestamp': datetime.utcnow().isoformat()
            }

            txn.execute("""
                INSERT INTO outbox (id, event_type, payload, created_at)
                VALUES (%(id)s, %(event_type)s, %(payload)s, NOW())
            """, {
                'id': str(uuid.uuid4()),
                'event_type': 'OrderCreated',
                'payload': json.dumps(event)
            })

            # Both or neither - guaranteed by transaction
            txn.commit()

        return order_id

# Separate outbox publisher process
class OutboxPublisher:
    def __init__(self, db_pool, message_queue):
        self.db = db_pool
        self.queue = message_queue

    def poll_and_publish(self):
        while True:
            with self.db.transaction() as txn:
                # Lock and fetch batch of unpublished messages
                messages = txn.execute("""
                    SELECT id, event_type, payload
                    FROM outbox
                    WHERE published_at IS NULL
                    ORDER BY created_at
                    LIMIT 100
                    FOR UPDATE SKIP LOCKED
                """).fetchall()

                for msg in messages:
                    try:
                        # Publish to message queue
                        self.queue.publish(
                            routing_key=msg['event_type'],
                            body=msg['payload'],
                            properties={'message_id': msg['id']}
                        )

                        # Mark as published
                        txn.execute("""
                            UPDATE outbox
                            SET published_at = NOW()
                            WHERE id = %(id)s
                        """, {'id': msg['id']})

                    except Exception as e:
                        # Log error, will retry on next poll
                        logger.error(f"Failed to publish {msg['id']}: {e}")
                        txn.rollback()
                        break

                txn.commit()

            time.sleep(0.1)  # Poll interval

# Database schema
"""
CREATE TABLE outbox (
    id UUID PRIMARY KEY,
    event_type VARCHAR(255) NOT NULL,
    payload JSONB NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    published_at TIMESTAMP,
    INDEX idx_unpublished (published_at, created_at) WHERE published_at IS NULL
);
"""
```

### Key Takeaways
- **Atomic write**: Business data and outbox entry in same database transaction
- **Separate publisher**: Independent process polls outbox and publishes messages
- **At-least-once from outbox**: Publisher may retry, consumers must be idempotent
- **FOR UPDATE SKIP LOCKED**: Enables multiple publisher instances without conflicts
- **Monitoring**: Track outbox depth, publishing lag, failed publications
- **Cleanup**: Archive or delete old published messages periodically
- **Alternative**: Use CDC (Change Data Capture) to stream outbox table to message queue

## Anti-Pattern: Blocking Operations in Event Handlers

### Description
Performing synchronous blocking calls (HTTP requests, database queries, file I/O) inside message handlers can exhaust thread pools, increase latency, and reduce throughput. Event handlers should be fast, non-blocking, and offload heavy work to background processes.

### Bad Code Example

```javascript
// ANTI-PATTERN: Blocking operations in message handler
const amqp = require('amqplib');

async function startConsumer() {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    const queue = 'user-registrations';

    await channel.assertQueue(queue);
    channel.prefetch(1);  // Process one at a time

    channel.consume(queue, async (msg) => {
        const user = JSON.parse(msg.content.toString());

        // WRONG: Multiple blocking HTTP calls in sequence
        // This blocks the event loop, prevents other messages from processing
        await sendWelcomeEmail(user);           // 2 seconds
        await createUserInCRM(user);            // 3 seconds
        await provisionCloudResources(user);    // 5 seconds
        await generateAnalyticsProfile(user);   // 2 seconds
        await notifySlackChannel(user);         // 1 second

        // Total: 13 seconds per message!
        // With prefetch=1, throughput is ~0.077 messages/second

        channel.ack(msg);
    });
}
```

**Problems:**
- Sequential blocking operations take 13+ seconds per message
- Extremely low throughput (0.077 msg/sec with prefetch=1)
- Thread/event loop blocked waiting for I/O
- Cannot process other messages concurrently
- Single point of failure (one slow operation delays everything)

### Good Code Example

```javascript
// GOOD: Publish events for async processing
const amqp = require('amqplib');

async function startConsumer() {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();
    const registrationQueue = 'user-registrations';

    await channel.assertQueue(registrationQueue);
    channel.prefetch(10);  // Process 10 concurrently

    channel.consume(registrationQueue, async (msg) => {
        const user = JSON.parse(msg.content.toString());

        try {
            // Store user in database (fast)
            await db.execute(
                'INSERT INTO users (id, email, name) VALUES ($1, $2, $3)',
                [user.id, user.email, user.name]
            );

            // Publish separate events for each background task
            // These will be processed by specialized workers
            const events = [
                { type: 'SendWelcomeEmail', userId: user.id },
                { type: 'CreateCRMRecord', userId: user.id },
                { type: 'ProvisionResources', userId: user.id },
                { type: 'GenerateAnalytics', userId: user.id },
                { type: 'NotifySlack', userId: user.id }
            ];

            for (const event of events) {
                await channel.publish(
                    'user-events',
                    event.type,
                    Buffer.from(JSON.stringify(event)),
                    { persistent: true }
                );
            }

            // Fast acknowledgment (< 100ms total)
            channel.ack(msg);

        } catch (error) {
            console.error('Failed to process registration:', error);
            channel.nack(msg, false, true);  // Requeue
        }
    });
}

// Separate specialized workers for each task type
async function startEmailWorker() {
    const connection = await amqp.connect('amqp://localhost');
    const channel = await connection.createChannel();

    await channel.assertExchange('user-events', 'topic');
    const queue = await channel.assertQueue('email-tasks', { durable: true });
    await channel.bindQueue(queue.queue, 'user-events', 'SendWelcomeEmail');

    channel.prefetch(5);  // Process 5 emails concurrently

    channel.consume(queue.queue, async (msg) => {
        const event = JSON.parse(msg.content.toString());

        try {
            await sendWelcomeEmail(event.userId);
            channel.ack(msg);
        } catch (error) {
            console.error('Email failed:', error);
            channel.nack(msg, false, false);  // Send to DLQ
        }
    });
}

// Similar workers for CRM, provisioning, analytics, notifications...
```

### Key Takeaways
- **Keep handlers fast**: Aim for <100ms processing time
- **Publish don't block**: Emit events for async processing instead of doing work inline
- **Specialized workers**: Create dedicated consumers for different task types
- **Concurrent processing**: Use prefetch/concurrency settings appropriately
- **Fail fast**: Quick validation, defer heavy work
- **Monitor queue depth**: Track backlog for each task type
- **Scale independently**: Each worker type can scale based on its load

## Pattern: Message Batching for Throughput

### Description
Processing messages individually incurs per-message overhead (network round-trips, acknowledgments, commits). Batching multiple messages together significantly improves throughput at the cost of slightly higher latency.

### Good Code Example

```go
// Batch message processing in Go
package main

import (
    "context"
    "github.com/aws/aws-sdk-go-v2/service/sqs"
    "time"
)

type BatchProcessor struct {
    sqsClient *sqs.Client
    queueURL  string
    batchSize int
    flushInterval time.Duration
}

func (bp *BatchProcessor) Start(ctx context.Context) {
    ticker := time.NewTicker(bp.flushInterval)
    defer ticker.Stop()

    batch := make([]*sqs.Message, 0, bp.batchSize)

    for {
        select {
        case <-ctx.Done():
            // Process remaining messages on shutdown
            if len(batch) > 0 {
                bp.processBatch(batch)
            }
            return

        case <-ticker.C:
            // Flush batch on interval even if not full
            if len(batch) > 0 {
                bp.processBatch(batch)
                batch = batch[:0]
            }

        default:
            // Receive up to 10 messages (SQS max)
            result, err := bp.sqsClient.ReceiveMessage(ctx, &sqs.ReceiveMessageInput{
                QueueUrl:            &bp.queueURL,
                MaxNumberOfMessages: 10,
                WaitTimeSeconds:     20,
            })

            if err != nil {
                continue
            }

            batch = append(batch, result.Messages...)

            // Process when batch is full
            if len(batch) >= bp.batchSize {
                bp.processBatch(batch)
                batch = batch[:0]
            }
        }
    }
}

func (bp *BatchProcessor) processBatch(messages []*sqs.Message) {
    // Bulk insert to database
    values := make([]interface{}, 0, len(messages)*3)
    placeholders := make([]string, 0, len(messages))

    for i, msg := range messages {
        values = append(values, msg.MessageId, msg.Body, time.Now())
        placeholders = append(placeholders, fmt.Sprintf("($%d, $%d, $%d)", i*3+1, i*3+2, i*3+3))
    }

    query := fmt.Sprintf(
        "INSERT INTO events (id, payload, processed_at) VALUES %s",
        strings.Join(placeholders, ", "),
    )

    _, err := db.Exec(query, values...)
    if err != nil {
        // Handle error - maybe process individually
        return
    }

    // Batch delete from queue
    entries := make([]types.DeleteMessageBatchRequestEntry, len(messages))
    for i, msg := range messages {
        entries[i] = types.DeleteMessageBatchRequestEntry{
            Id:            aws.String(fmt.Sprintf("%d", i)),
            ReceiptHandle: msg.ReceiptHandle,
        }
    }

    _, err = bp.sqsClient.DeleteMessageBatch(context.Background(), &sqs.DeleteMessageBatchInput{
        QueueUrl: &bp.queueURL,
        Entries:  entries,
    })
}
```

### Key Takeaways
- **Receive in batches**: Use MaxNumberOfMessages=10 (SQS limit)
- **Process together**: Bulk database operations (INSERT, UPDATE in single query)
- **Delete in batches**: Use DeleteMessageBatch (up to 10 messages)
- **Flush interval**: Don't wait forever for full batch (e.g., 1-5 seconds)
- **Error handling**: Process individually on batch failure for partial success
- **Monitoring**: Track batch sizes, flush frequency, throughput improvements
- **Typical gains**: 5-10x throughput improvement for high-volume queues

---

## Summary: Message Queue Design Principles

1. **Understand delivery guarantees**: Choose between at-most-once, at-least-once, or exactly-once based on requirements
2. **Design for idempotency**: Always assume messages can be delivered multiple times
3. **Configure appropriate timeouts**: Visibility timeout, processing timeout, and message TTL
4. **Use long polling**: Reduces costs and latency compared to short polling
5. **Implement dead letter queues**: Handle poison messages and enable debugging
6. **Batch operations**: Improve throughput by processing multiple messages together
7. **Monitor queue metrics**: Depth, age, processing time, DLQ size, throughput
8. **Order only when needed**: FIFO queues have lower throughput than standard queues
9. **Keep handlers fast**: Offload heavy work to specialized workers
10. **Test failure scenarios**: Simulate network failures, timeouts, duplicates, out-of-order delivery
