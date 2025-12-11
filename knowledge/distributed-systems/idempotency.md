# Idempotency Patterns and Anti-Patterns

## Introduction

Idempotency is a critical property for building robust distributed systems where an operation can be performed multiple times with the same result as performing it once. This is essential because networks are inherently unreliable, messages can be duplicated, and clients must retry failed requests without knowing if they succeeded. This document captures key patterns and anti-patterns for implementing idempotent systems.

---

## Anti-Pattern: Non-Idempotent Foreign State Mutations

### Description
Making synchronous changes to external systems (payment processors, email services, DNS records) without safeguards creates a critical vulnerability. Once you "push data into a system beyond your own boundaries," you cannot use transaction rollback for recovery. If a request fails partway through—after charging a customer but before recording the charge locally—the client cannot safely retry without risking duplicate charges or orphaned transactions.

### Bad Code Example
```python
def create_ride(user_id, payment_info):
    # Create ride in local database
    ride = db.create_ride(user_id=user_id)

    # Call external payment API - DANGER: no idempotency protection
    charge = stripe.charge.create(
        amount=2000,
        currency='usd',
        customer=payment_info['customer_id']
    )

    # Store charge ID - if this fails, we've charged but have no record
    ride.charge_id = charge.id
    db.save(ride)

    # Send receipt email - another foreign mutation
    email_service.send_receipt(user_id, charge.id)

    return ride
```

**Problem**: If the request fails after the Stripe charge but before saving `charge_id`, a retry will double-charge the customer.

### Good Code Example
```python
def create_ride(user_id, payment_info, idempotency_key):
    # Check if we've already processed this request
    key_record = db.get_idempotency_key(idempotency_key)
    if key_record and key_record.response_body:
        # Already completed - return cached result
        return key_record.response_body

    if not key_record:
        # Create tracking record in transaction
        key_record = db.create_idempotency_key(
            key=idempotency_key,
            recovery_point='started',
            request_params={'user_id': user_id, 'payment_info': payment_info}
        )

    # Resume from last recovery point
    if key_record.recovery_point == 'started':
        # Atomic phase 1: Create ride
        with db.transaction():
            ride = db.create_ride(user_id=user_id)
            key_record.update(recovery_point='ride_created', ride_id=ride.id)

    if key_record.recovery_point == 'ride_created':
        # Foreign mutation 1: Charge with idempotency
        ride = db.get_ride(key_record.ride_id)
        charge = stripe.charge.create(
            {'amount': 2000, 'currency': 'usd', 'customer': payment_info['customer_id']},
            idempotency_key=f"rocket-rides-{idempotency_key}"
        )

        # Atomic phase 2: Store charge ID
        with db.transaction():
            ride.charge_id = charge.id
            db.save(ride)
            key_record.update(recovery_point='charge_created')

    if key_record.recovery_point == 'charge_created':
        # Foreign mutation 2: Queue email (idempotent job)
        job_queue.enqueue('send_receipt', user_id=user_id, charge_id=ride.charge_id)

        # Mark complete and cache response
        with db.transaction():
            result = {'ride_id': ride.id, 'charge_id': ride.charge_id}
            key_record.update(recovery_point='finished', response_body=result)

    return key_record.response_body
```

### Key Takeaway
Use idempotency keys to track request progress through atomic phases. Each phase commits locally before making foreign mutations, and recovery points enable safe retries from the last successful state. Always pass idempotency keys to downstream services that support them.

---

## Anti-Pattern: Double Processing Messages

### Description
In message-driven systems with at-least-once delivery guarantees, consumers can receive the same message multiple times. A non-idempotent consumer that performs state mutations (like debiting an account) without tracking processed message IDs will produce incorrect results when messages are duplicated.

### Bad Code Example
```javascript
// Non-idempotent message handler
async function handleAccountDebited(message) {
  const { accountId, amount, messageId } = message;

  // DANGER: No duplicate detection
  const account = await db.getAccount(accountId);
  account.balance -= amount;
  await db.saveAccount(account);

  console.log(`Debited ${amount} from account ${accountId}`);
}

// If this message is delivered twice, balance is debited twice
```

**Problem**: Processing an `AccountDebited` message multiple times subtracts the amount repeatedly, resulting in an incorrect final balance.

### Good Code Example (PROCESSED_MESSAGES Table)
```javascript
async function handleAccountDebited(message) {
  const { accountId, amount, messageId, subscriberId } = message;

  const transaction = await db.beginTransaction();

  try {
    // Try to insert message ID - this acts as a lock
    await transaction.execute(
      `INSERT INTO processed_messages (subscriber_id, message_id, processed_at)
       VALUES (?, ?, NOW())`,
      [subscriberId, messageId]
    );

    // Only execute if insert succeeded (not a duplicate)
    const account = await transaction.getAccount(accountId);
    account.balance -= amount;
    await transaction.saveAccount(account);

    await transaction.commit();
    console.log(`Debited ${amount} from account ${accountId}`);

  } catch (error) {
    if (error.code === 'DUPLICATE_KEY') {
      // Already processed - safe to ignore
      console.log(`Duplicate message ${messageId} - skipping`);
      await transaction.rollback();
    } else {
      await transaction.rollback();
      throw error;
    }
  }
}
```

### Good Code Example (Business Entity Storage)
```sql
-- Store message ID directly in the domain table
CREATE TABLE accounts (
    id BIGINT PRIMARY KEY,
    balance DECIMAL(15,2),
    last_processed_message_id VARCHAR(100) UNIQUE
);
```

```javascript
async function handleAccountDebited(message) {
  const { accountId, amount, messageId } = message;

  const transaction = await db.beginTransaction();

  try {
    const account = await transaction.getAccountForUpdate(accountId);

    // Check if this message was already processed
    if (account.lastProcessedMessageId === messageId) {
      console.log(`Duplicate message ${messageId} - skipping`);
      await transaction.rollback();
      return;
    }

    // Process the message
    account.balance -= amount;
    account.lastProcessedMessageId = messageId;
    await transaction.saveAccount(account);

    await transaction.commit();
    console.log(`Debited ${amount} from account ${accountId}`);

  } catch (error) {
    await transaction.rollback();
    throw error;
  }
}
```

### Key Takeaway
Always track processed message IDs to detect and discard duplicates. Use either a dedicated `PROCESSED_MESSAGES` table with composite primary key `(subscriber_id, message_id)` or embed message IDs in business entities. The database constraint provides atomic duplicate detection within transactions.

---

## Anti-Pattern: Missing Retry Logic with Exponential Backoff

### Description
Clients that retry failed requests immediately or with fixed delays can overwhelm recovering servers (thundering herd problem) or waste resources retrying operations that need time to recover. Without exponential backoff and jitter, retry storms can make outages worse.

### Bad Code Example
```python
def create_charge_with_bad_retry(amount, customer_id):
    max_retries = 5

    for attempt in range(max_retries):
        try:
            return stripe.charge.create(
                amount=amount,
                currency='usd',
                customer=customer_id
            )
        except NetworkError:
            # DANGER: Fixed 1-second delay causes synchronized retries
            time.sleep(1)
            if attempt == max_retries - 1:
                raise
```

**Problem**: All clients retry at the same fixed interval, creating synchronized traffic spikes that can overwhelm a recovering service.

### Good Code Example
```python
import random
import time

def create_charge_with_smart_retry(amount, customer_id, idempotency_key):
    max_retries = 5
    base_delay = 1.0  # Start with 1 second

    for attempt in range(max_retries):
        try:
            return stripe.charge.create(
                {'amount': amount, 'currency': 'usd', 'customer': customer_id},
                idempotency_key=idempotency_key
            )
        except NetworkError as e:
            if attempt == max_retries - 1:
                raise

            # Exponential backoff: wait time doubles each attempt
            exponential_delay = base_delay * (2 ** attempt)

            # Jitter: randomize delay to prevent thundering herd
            jittered_delay = exponential_delay * (0.5 + random.random() * 0.5)

            print(f"Attempt {attempt + 1} failed, retrying in {jittered_delay:.2f}s")
            time.sleep(jittered_delay)
```

### Key Takeaway
Always implement exponential backoff (wait times increase as `2^n`) with jitter (random variation) when retrying failed requests. This respects server resources during recovery and prevents synchronized retry storms. Always use idempotency keys to make retries safe.

---

## Anti-Pattern: Using Non-ACID Datastores for Idempotency

### Description
Implementing idempotency patterns requires ACID guarantees to create atomic phases—groups of operations that either all succeed or all fail together. Without proper transactions, every database operation becomes equivalent to a foreign state mutation, making safe recovery impossible.

### Bad Code Example
```javascript
// Using MongoDB (non-ACID) for idempotency - DANGEROUS
async function processPayment(userId, amount, idempotencyKey) {
  // Check idempotency key
  const existingKey = await mongodb.collection('idempotency_keys')
    .findOne({ key: idempotencyKey });

  if (existingKey) {
    return existingKey.response;
  }

  // DANGER: No transaction support - these are separate operations
  await mongodb.collection('idempotency_keys').insertOne({
    key: idempotencyKey,
    status: 'processing'
  });

  const charge = await stripe.charge.create({ amount, customer: userId });

  // DANGER: If this fails, key exists but no charge recorded
  await mongodb.collection('charges').insertOne({
    userId,
    chargeId: charge.id,
    amount
  });

  // DANGER: If this fails, we've processed but client sees failure
  await mongodb.collection('idempotency_keys').updateOne(
    { key: idempotencyKey },
    { $set: { status: 'completed', response: { chargeId: charge.id } } }
  );

  return { chargeId: charge.id };
}
```

**Problem**: Without ACID transactions, partial failures leave the system in an inconsistent state. The idempotency key might exist but be incomplete, making retry logic impossible to implement correctly.

### Good Code Example
```sql
-- Use PostgreSQL with SERIALIZABLE isolation
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;

-- Upsert idempotency key atomically
INSERT INTO idempotency_keys (key, recovery_point, request_params)
VALUES ($1, 'started', $2)
ON CONFLICT (key) DO NOTHING
RETURNING *;

-- All operations in this transaction commit or rollback together
INSERT INTO charges (user_id, amount) VALUES ($3, $4) RETURNING id;

UPDATE idempotency_keys
SET recovery_point = 'charge_created', charge_id = $5
WHERE key = $1;

COMMIT;
```

```python
def process_payment_with_acid(user_id, amount, idempotency_key):
    with db.transaction(isolation='SERIALIZABLE'):
        # All these operations are atomic
        key_record = db.upsert_idempotency_key(
            key=idempotency_key,
            recovery_point='started',
            request_params={'user_id': user_id, 'amount': amount}
        )

        if key_record.recovery_point == 'finished':
            return key_record.response_body

        charge_id = db.create_charge(user_id=user_id, amount=amount)

        key_record.update(
            recovery_point='charge_created',
            charge_id=charge_id
        )

        # Transaction commits - all or nothing

    # Make foreign mutation only after local state committed
    stripe_charge = stripe.charge.create(
        {'amount': amount, 'customer': user_id},
        idempotency_key=f"app-{idempotency_key}"
    )

    with db.transaction():
        key_record.update(
            recovery_point='finished',
            stripe_charge_id=stripe_charge.id,
            response_body={'charge_id': stripe_charge.id}
        )

    return key_record.response_body
```

### Key Takeaway
Use ACID-compliant databases (PostgreSQL, MySQL) for implementing idempotency patterns. Non-ACID stores make atomic phases impossible, turning every operation into an unsafe foreign mutation. SERIALIZABLE isolation level provides the strongest guarantees for concurrent idempotency key access.

---

## Anti-Pattern: Not Caching Idempotent Responses

### Description
After successfully processing a request, failing to cache and return the response for subsequent requests with the same idempotency key forces clients to receive errors or forces re-execution of expensive operations. The server must store results to make retries truly safe.

### Bad Code Example
```python
def create_order(user_id, items, idempotency_key):
    # Check if request is in progress
    existing = db.get_idempotency_key(idempotency_key)
    if existing:
        # DANGER: Returns error instead of cached result
        raise ConflictError("Request already in progress")

    # Process order
    db.insert_idempotency_key(idempotency_key, status='processing')
    order = process_order(user_id, items)

    # DANGER: Key exists but response not cached
    db.update_idempotency_key(idempotency_key, status='completed')

    return order
```

**Problem**: Client retries receive `409 Conflict` even after successful completion, or worse, the operation executes again if the key is deleted.

### Good Code Example
```python
def create_order(user_id, items, idempotency_key):
    # Check for existing key with cached response
    existing = db.get_idempotency_key(idempotency_key)

    if existing and existing.response_body:
        # Return cached result immediately
        return existing.response_body

    if existing and existing.locked_at:
        # Another request is processing - return conflict
        raise ConflictError("Request in progress", retry_after=5)

    # Create new tracking record
    with db.transaction():
        key_record = db.insert_idempotency_key(
            key=idempotency_key,
            locked_at=datetime.now(),
            request_params={'user_id': user_id, 'items': items},
            recovery_point='started'
        )

    # Process order through atomic phases
    order = process_order_with_recovery(user_id, items, key_record)

    # Cache the response for future retries
    with db.transaction():
        key_record.update(
            recovery_point='finished',
            response_code=200,
            response_body={'order_id': order.id, 'total': order.total}
        )

    return key_record.response_body

# Cleanup old keys after 24-72 hours
def reap_old_keys():
    db.delete_idempotency_keys(
        older_than=datetime.now() - timedelta(hours=72)
    )
```

### Key Takeaway
Always cache the response (status code and body) when finalizing an idempotency key. Subsequent requests with the same key should receive the cached response immediately. Implement a reaper process to delete old keys (24-72 hours) to prevent unbounded storage growth while ensuring clients have time to retry.

---

## Anti-Pattern: Not Handling Concurrent Requests to Same Key

### Description
When two clients simultaneously send requests with the same idempotency key, the system must handle the race condition properly. Without proper locking or serialization, both requests might process concurrently, or one might fail with an unhelpful error.

### Bad Code Example
```python
def handle_payment(amount, customer_id, idempotency_key):
    # DANGER: Race condition - both requests might pass this check
    existing = db.get_idempotency_key(idempotency_key)
    if existing:
        return existing.response

    # DANGER: Both requests create keys and process payment
    db.insert_idempotency_key(idempotency_key)
    charge = stripe.charge.create(amount=amount, customer=customer_id)

    return {'charge_id': charge.id}
```

**Problem**: Two concurrent requests with the same key both pass the existence check and create duplicate charges.

### Good Code Example
```python
def handle_payment(amount, customer_id, idempotency_key):
    try:
        # Use database constraint and SERIALIZABLE isolation for atomic check-and-set
        with db.transaction(isolation='SERIALIZABLE'):
            key_record = db.execute("""
                INSERT INTO idempotency_keys
                (key, locked_at, request_params, recovery_point)
                VALUES (?, NOW(), ?, 'started')
                ON CONFLICT (key) DO NOTHING
                RETURNING *
            """, idempotency_key, {'amount': amount, 'customer': customer_id})

            if not key_record:
                # Key already exists - fetch it
                key_record = db.get_idempotency_key(idempotency_key)

                if key_record.response_body:
                    # Completed - return cached response
                    return key_record.response_body
                else:
                    # In progress - return 409 with retry guidance
                    raise ConflictError(
                        message="Request with this idempotency key is being processed",
                        retry_after_seconds=2
                    )

            # We won the race - process the request
            charge = stripe.charge.create(
                {'amount': amount, 'customer': customer_id},
                idempotency_key=f"app-{idempotency_key}"
            )

            result = {'charge_id': charge.id}
            key_record.update(
                recovery_point='finished',
                response_code=200,
                response_body=result
            )

            return result

    except SerializationFailure:
        # Concurrent transaction conflict - return 409
        raise ConflictError(
            message="Concurrent request detected",
            retry_after_seconds=1
        )
```

### Key Takeaway
Use `SERIALIZABLE` transaction isolation and unique database constraints to handle concurrent requests atomically. Return `409 Conflict` (not `500 Internal Server Error`) for concurrent attempts, signaling to clients that retry is appropriate. Include a `Retry-After` header to guide backoff timing.

---

## Pattern: Recovery Point Progression

### Description
Track request execution progress through named recovery points, allowing interrupted requests to resume from the last successful phase rather than restarting from the beginning. Each recovery point represents a stable state where all prior operations have committed.

### Implementation Example
```python
class RecoveryPoints:
    STARTED = 'started'
    USER_CREATED = 'user_created'
    PAYMENT_CHARGED = 'payment_charged'
    EMAIL_QUEUED = 'email_queued'
    FINISHED = 'finished'

def process_signup(email, payment_info, idempotency_key):
    key_record = db.get_or_create_idempotency_key(idempotency_key)

    if key_record.response_body:
        return key_record.response_body

    # Resume from last recovery point
    if key_record.recovery_point == RecoveryPoints.STARTED:
        with db.transaction():
            user = db.create_user(email=email)
            key_record.update(
                recovery_point=RecoveryPoints.USER_CREATED,
                user_id=user.id
            )

    if key_record.recovery_point == RecoveryPoints.USER_CREATED:
        user = db.get_user(key_record.user_id)
        charge = stripe.charge.create(
            {'amount': 5000, 'customer': payment_info['customer_id']},
            idempotency_key=f"signup-{idempotency_key}"
        )

        with db.transaction():
            user.stripe_charge_id = charge.id
            db.save(user)
            key_record.update(recovery_point=RecoveryPoints.PAYMENT_CHARGED)

    if key_record.recovery_point == RecoveryPoints.PAYMENT_CHARGED:
        user = db.get_user(key_record.user_id)
        job_queue.enqueue('welcome_email', user_id=user.id)

        with db.transaction():
            key_record.update(recovery_point=RecoveryPoints.EMAIL_QUEUED)

    if key_record.recovery_point == RecoveryPoints.EMAIL_QUEUED:
        result = {'user_id': key_record.user_id, 'status': 'success'}
        with db.transaction():
            key_record.update(
                recovery_point=RecoveryPoints.FINISHED,
                response_body=result
            )
        return result
```

### Key Takeaway
Structure complex operations as a state machine of recovery points. Each point represents completion of an atomic phase. On retry, check the current recovery point and skip completed phases, resuming from where execution stopped. This prevents duplicate foreign mutations while ensuring forward progress.

---

## Pattern: Background Completion Processes

### Description
Implement automated processes that detect and complete abandoned requests, ensuring the system is self-healing rather than requiring manual intervention when clients disconnect or fail to retry.

### Implementation Example
```python
# Completer: Finds incomplete requests and pushes them forward
def completer_job():
    while True:
        # Find keys locked for more than 5 minutes that aren't finished
        abandoned_keys = db.execute("""
            SELECT * FROM idempotency_keys
            WHERE recovery_point != 'finished'
            AND locked_at < NOW() - INTERVAL '5 minutes'
            LIMIT 100
        """)

        for key_record in abandoned_keys:
            try:
                # Resume processing from recovery point
                resume_request(key_record)
            except Exception as e:
                log.error(f"Failed to complete key {key_record.id}: {e}")

        time.sleep(60)  # Run every minute

# Reaper: Cleans up old completed keys
def reaper_job():
    while True:
        deleted = db.execute("""
            DELETE FROM idempotency_keys
            WHERE recovery_point = 'finished'
            AND locked_at < NOW() - INTERVAL '72 hours'
        """)

        log.info(f"Reaped {deleted} old idempotency keys")
        time.sleep(3600)  # Run hourly

# Enqueuer: Moves staged jobs to queue after transaction commits
def enqueuer_job():
    while True:
        staged_jobs = db.execute("""
            SELECT * FROM staged_jobs
            WHERE queued_at IS NULL
            AND created_at < NOW() - INTERVAL '30 seconds'
            LIMIT 1000
        """)

        for job in staged_jobs:
            try:
                job_queue.enqueue(job.job_name, **job.params)
                db.execute(
                    "UPDATE staged_jobs SET queued_at = NOW() WHERE id = ?",
                    job.id
                )
            except Exception as e:
                log.error(f"Failed to enqueue job {job.id}: {e}")

        time.sleep(10)  # Run every 10 seconds
```

### Key Takeaway
Don't rely solely on client retries. Implement background processes for passive safety: Completer pushes abandoned requests to completion, Reaper prevents unbounded key storage, and Enqueuer ensures jobs reach the queue even after transaction failures. These processes make the system self-healing.

---

## Summary: Three Principles for Idempotent Systems

1. **Handle failures consistently**: Clients must implement retry logic with exponential backoff and jitter
2. **Handle failures safely**: Use idempotency keys to enable safe request retries without duplicate effects
3. **Handle failures responsibly**: Respect server resources with proper backoff, and design systems to complete work passively without human intervention

By following these patterns and avoiding the anti-patterns, you can build distributed systems that gracefully handle the inevitable failures of network communication while maintaining data consistency and correctness.
