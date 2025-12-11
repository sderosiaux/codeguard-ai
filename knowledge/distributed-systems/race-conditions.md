# Race Conditions: Patterns and Anti-Patterns

Race conditions occur when multiple threads or processes access shared resources concurrently without proper synchronization, leading to unpredictable behavior, data corruption, or security vulnerabilities. This guide covers common race condition patterns, anti-patterns, and their solutions.

---

## 1. Write Skew (Database Transactions)

### Description
Write skew occurs when concurrent transactions read the same data, make independent decisions based on stale information, and write conflicting updates. Each transaction succeeds individually, but their combined effect violates business constraints.

### Bad Code Example

```sql
-- Two transactions running concurrently
-- Business rule: At least one doctor must be on-call per shift

-- Transaction A (Doctor Jack):
SELECT COUNT(*) FROM shifts WHERE shift_id = 1 AND on_call = TRUE;  -- Returns 2
UPDATE shifts SET on_call = FALSE WHERE doctor_name = 'Jack' AND shift_id = 1;

-- Transaction B (Doctor John) running at the same time:
SELECT COUNT(*) FROM shifts WHERE shift_id = 1 AND on_call = TRUE;  -- Returns 2
UPDATE shifts SET on_call = FALSE WHERE doctor_name = 'John' AND shift_id = 1;

-- Result: 0 doctors on-call (constraint violated!)
```

### Good Code Example - Serializable Isolation

```sql
-- Using PostgreSQL Serializable Isolation
CREATE OR REPLACE FUNCTION update_on_call_status_with_serializable_isolation(
    shift_id_to_update INT,
    doctor_name_to_update TEXT,
    on_call_to_update BOOLEAN)
RETURNS VOID AS $$
DECLARE
    on_call_count INT;
BEGIN
    SELECT COUNT(*) INTO on_call_count FROM shifts s
    WHERE s.shift_id = shift_id_to_update AND s.on_call = TRUE;

    IF on_call_to_update = FALSE AND on_call_count = 1 THEN
        RAISE EXCEPTION 'Cannot set on_call to FALSE. At least one doctor must be on call';
    ELSE
        UPDATE shifts s SET on_call = on_call_to_update
        WHERE s.shift_id = shift_id_to_update AND s.doctor_name = doctor_name_to_update;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- In application code (Go example):
tx, err := db.BeginTxx(ctx, &sql.TxOptions{Isolation: sql.LevelSerializable})
```

### Good Code Example - Advisory Locks

```sql
CREATE OR REPLACE FUNCTION update_on_call_status_with_advisory_lock(
    shift_id_to_update INT,
    doctor_name_to_update TEXT,
    on_call_to_update BOOLEAN)
RETURNS VOID AS $$
DECLARE
    on_call_count INT;
BEGIN
    -- Acquire transaction-level advisory lock
    IF NOT pg_try_advisory_xact_lock(shift_id_to_update) THEN
        RAISE EXCEPTION 'Could not acquire advisory lock for shift_id: %', shift_id_to_update;
    END IF;

    SELECT COUNT(*) INTO on_call_count FROM shifts s
    WHERE s.shift_id = shift_id_to_update AND s.on_call = TRUE;

    IF on_call_to_update = FALSE AND on_call_count = 1 THEN
        RAISE EXCEPTION 'Cannot set on_call to FALSE. At least one doctor must be on call';
    ELSE
        UPDATE shifts s SET on_call = on_call_to_update
        WHERE s.shift_id = shift_id_to_update AND s.doctor_name = doctor_name_to_update;
    END IF;
END;
$$ LANGUAGE plpgsql;
```

### Key Takeaway
Use **Serializable transaction isolation** for automatic conflict detection (requires retry logic) or **advisory locks** for explicit application-controlled locking. Advisory locks prevent conflicts proactively and offer more predictable performance.

---

## 2. UPSERT Race Conditions (Database)

### Description
In PostgreSQL, the classic "SELECT then INSERT" pattern creates race conditions where concurrent requests both find no row, then both attempt to INSERT, causing primary key violations. Even using `ON CONFLICT DO NOTHING` can be problematic when you need the resulting row.

### Bad Code Example

```sql
-- Anti-pattern: Read + Write Without Conflict Handling
SELECT id FROM customers WHERE customer_id = '1796b892-c988-4f96-8eb8-a7f6f965d266';
-- If no result, then:
INSERT INTO customers(customer_id) VALUES('1796b892-c988-4f96-8eb8-a7f6f965d266') RETURNING id;
-- Concurrent requests both see "no row" and both try to INSERT -> constraint violation!
```

```sql
-- Broken fix: ON CONFLICT DO NOTHING doesn't return the row
INSERT INTO customers(customer_id) VALUES('1796b892-c988-4f96-8eb8-a7f6f965d266')
ON CONFLICT DO NOTHING RETURNING id;
-- When conflict occurs, RETURNING returns empty result!
```

```sql
-- Anti-pattern: Unnecessary UPDATE
INSERT INTO customers(customer_id) VALUES('1796b892-c988-4f96-8eb8-a7f6f965d266')
ON CONFLICT (customer_id) DO UPDATE SET customer_id = excluded.customer_id RETURNING id;
-- Problems: Updates unchanged rows, fires triggers, write-locks records, alters xmin/xmax
```

### Good Code Example - Insert First, Read Later

```sql
-- Solution 1: Separate insert and select
INSERT INTO customers(customer_id) VALUES('1796b892-c988-4f96-8eb8-a7f6f965d266')
ON CONFLICT DO NOTHING;
SELECT id FROM customers WHERE customer_id = '1796b892-c988-4f96-8eb8-a7f6f965d266';
```

### Good Code Example - CTE Approach

```sql
-- Solution 2: Using CTE (Common Table Expression)
WITH search AS (
    SELECT id FROM customers WHERE customer_id = '1796b892-c988-4f96-8eb8-a7f6f965d266' LIMIT 1
),
add AS (
    INSERT INTO customers (customer_id)
    SELECT '1796b892-c988-4f96-8eb8-a7f6f965d266'
    WHERE NOT EXISTS(SELECT id FROM search)
    RETURNING id
)
SELECT id FROM add UNION ALL SELECT id FROM search;
```

### Good Code Example - Advisory Locks

```sql
-- Solution 3: Advisory locks for guaranteed atomicity
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('1796b892-c988-4f96-8eb8-a7f6f965d266'));
SELECT id FROM customers WHERE customer_id = '1796b892-c988-4f96-8eb8-a7f6f965d266';
-- If not found:
INSERT INTO customers(customer_id) VALUES('1796b892-c988-4f96-8eb8-a7f6f965d266') RETURNING id;
COMMIT;
```

### Key Takeaway
Never rely on "SELECT then INSERT" without conflict handling. Use `INSERT ... ON CONFLICT` followed by a separate `SELECT`, or use CTEs to atomically handle both cases. For critical operations, use advisory locks to ensure complete atomicity.

---

## 3. Lost Update Anomaly (Database)

### Description
A lost update occurs when one transaction's update is overwritten by a concurrent transaction because both read the same initial value before either writes. Transaction A reads row R, Transaction B writes to R and commits, then Transaction A writes to R and commits, effectively overwriting B's update.

### Bad Code Example

```sql
-- Transaction A (running with READ COMMITTED isolation)
BEGIN;
SELECT balance FROM accounts WHERE id = 123;  -- Reads $1000
-- ... computation ...
UPDATE accounts SET balance = 900 WHERE id = 123;  -- Deducts $100
COMMIT;

-- Transaction B (running concurrently)
BEGIN;
SELECT balance FROM accounts WHERE id = 123;  -- Also reads $1000
-- ... computation ...
UPDATE accounts SET balance = 500 WHERE id = 123;  -- Deducts $500
COMMIT;

-- Result: One update is lost! Balance should be $400, but it's $500 or $900
```

### Good Code Example - Serializable Isolation (CockroachDB)

```sql
-- CockroachDB uses SERIALIZABLE isolation by default
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
SELECT balance FROM accounts WHERE id = 123;
UPDATE accounts SET balance = balance - 100 WHERE id = 123;
COMMIT;
-- If conflict detected, transaction aborts with RETRY_WRITE_TOO_OLD error
-- Application must retry the transaction
```

### Good Code Example - SELECT FOR UPDATE

```sql
-- Using pessimistic locking
BEGIN;
SELECT balance FROM accounts WHERE id = 123 FOR UPDATE;
UPDATE accounts SET balance = balance - 100 WHERE id = 123;
COMMIT;
-- Other transactions wait until this transaction completes
```

### Good Code Example - Atomic Operations

```sql
-- Best approach: Make the operation atomic
UPDATE accounts SET balance = balance - 100 WHERE id = 123;
-- No separate SELECT needed; the update is atomic
```

### Key Takeaway
Use **SERIALIZABLE isolation** for automatic conflict detection (requires retry logic), **SELECT FOR UPDATE** for pessimistic locking, or best of all, **atomic UPDATE operations** that don't require a separate read. CockroachDB's internal retry mechanism under READ COMMITTED provides limited protection for individual statements but not across multiple statements.

---

## 4. Read-Modify-Write (Java)

### Description
The read-modify-write pattern occurs when multiple threads read a shared variable, modify it based on the old value, and write it back. Thread interleaving causes updates to be lost because threads read stale values.

### Bad Code Example

```java
public class Counter {
    private int count = 0;

    public void increment() {
        this.count = this.count + 1;  // Not atomic!
    }

    public int getCount() {
        return count;
    }
}

// Usage with multiple threads
Counter counter = new Counter();
ExecutorService executor = Executors.newFixedThreadPool(10);
for (int i = 0; i < 100; i++) {
    executor.submit(() -> counter.increment());
}
executor.shutdown();
System.out.println(counter.getCount());  // Expected 100, but might be 95, 87, etc.
```

**Why it fails:**
```
Thread A: Read count (0) -> Add 1 -> Write (1)
Thread B: Read count (0) -> Add 1 -> Write (1)
Result: count = 1 instead of 2
```

### Good Code Example - Synchronized

```java
public class Counter {
    private int count = 0;

    public synchronized void increment() {
        this.count = this.count + 1;
    }

    public synchronized int getCount() {
        return count;
    }
}
```

### Good Code Example - AtomicInteger

```java
import java.util.concurrent.atomic.AtomicInteger;

public class Counter {
    private final AtomicInteger count = new AtomicInteger(0);

    public void increment() {
        count.incrementAndGet();  // Atomic operation
    }

    public int getCount() {
        return count.get();
    }
}
```

### Key Takeaway
Use **synchronized methods/blocks** for complex operations or **AtomicInteger/AtomicLong** for simple atomic operations. AtomicInteger is faster (non-blocking) but only works for single operations. Synchronized is required for multi-step operations.

---

## 5. Check-Then-Act (Java)

### Description
The check-then-act pattern occurs when threads check a condition, then act based on that check. Problems arise when the condition changes after the check but before the action executes.

### Bad Code Example

```java
public class DonutStorage {
    private int donutsNumber;

    public int getDonutsNumber() { return donutsNumber; }
    public void setDonutsNumber(int n) { this.donutsNumber = n; }
}

public class Consumer {
    private final DonutStorage storage;

    public int consume(int requested) {
        int available = storage.getDonutsNumber();

        // Check-then-act race condition!
        if (requested > available) {
            storage.setDonutsNumber(0);
            return available;
        }

        storage.setDonutsNumber(available - requested);
        return requested;
    }
}
```

**Why it fails:**
```
Thread A: Check (15 > 10? No) -> [Thread B executes] -> Act (set to 5)
Thread B: Check (10 > 10? No) -> Act (set to 5)
Result: Both threads succeeded but consumed 20 total from 15 available!
```

### Good Code Example - Synchronized Block

```java
public class Consumer {
    private final DonutStorage storage;

    public int consume(int requested) {
        synchronized (storage) {
            int available = storage.getDonutsNumber();

            if (requested > available) {
                storage.setDonutsNumber(0);
                return available;
            }

            storage.setDonutsNumber(available - requested);
            return requested;
        }
    }
}
```

### Good Code Example - AtomicInteger with compareAndSet

```java
import java.util.concurrent.atomic.AtomicInteger;

public class DonutStorage {
    private final AtomicInteger donutsNumber;

    public DonutStorage(int initial) {
        this.donutsNumber = new AtomicInteger(initial);
    }

    public int consume(int requested) {
        while (true) {
            int current = donutsNumber.get();
            int consumed = Math.min(requested, current);
            int next = current - consumed;

            // Atomically update only if value hasn't changed
            if (donutsNumber.compareAndSet(current, next)) {
                return consumed;
            }
            // Retry if value changed
        }
    }
}
```

### Key Takeaway
Always synchronize the entire check-then-act sequence. Use **synchronized blocks** for simplicity or **compareAndSet** loops for lock-free algorithms. Never separate the check and the action across unsynchronized code.

---

## 6. Limit Overrun (Security)

### Description
Limit overrun race conditions enable attackers to exceed business logic limits (single-use coupons, rate limits, balance checks) by sending concurrent requests that all pass validation before any updates occur.

### Bad Code Example

```python
# Pseudo-code for promotional code redemption
def redeem_promo_code(user_id, promo_code):
    # Check if code already used
    if db.query("SELECT used FROM promo_codes WHERE code = ?", promo_code).used:
        return "Code already used"

    # Apply discount
    apply_discount(user_id, promo_code)

    # Mark as used
    db.execute("UPDATE promo_codes SET used = TRUE WHERE code = ?", promo_code)

    return "Discount applied"

# Attack: Send 10 concurrent requests with same promo code
# All pass the "used" check before any marks it used
# Result: Discount applied 10 times!
```

### Bad Code Example - Insufficient MFA Check

```python
# Pseudo-code showing hidden multi-step sequence vulnerability
def login(username, password):
    user = authenticate(username, password)
    session['userid'] = user.userid  # Session now valid!

    if user.mfa_enabled:
        session['enforce_mfa'] = True
        send_mfa_code(user)
        redirect_to_mfa_page()

    # Race window: Session is valid but MFA not yet enforced
    # Attacker can hit authenticated endpoints during this window
```

### Good Code Example - Database Constraints

```sql
-- Create unique constraint
ALTER TABLE promo_code_usage ADD CONSTRAINT unique_user_code UNIQUE (user_id, promo_code);

-- Insert usage record atomically
INSERT INTO promo_code_usage (user_id, promo_code, used_at)
VALUES (?, ?, NOW())
ON CONFLICT (user_id, promo_code) DO NOTHING
RETURNING id;

-- Only apply discount if insert succeeded (id returned)
```

### Good Code Example - Atomic State Changes

```python
# Use single atomic database transaction
def redeem_promo_code(user_id, promo_code):
    with db.transaction():
        # Use SELECT FOR UPDATE to lock the row
        code = db.query(
            "SELECT * FROM promo_codes WHERE code = ? FOR UPDATE",
            promo_code
        )

        if code.used:
            return "Code already used"

        # Apply discount and mark as used in same transaction
        apply_discount(user_id, promo_code)
        db.execute("UPDATE promo_codes SET used = TRUE WHERE code = ?", promo_code)

    return "Discount applied"
```

### Good Code Example - Session Consistency

```python
def login(username, password):
    user = authenticate(username, password)

    if user.mfa_enabled:
        # Don't create valid session until MFA completes
        session['pending_userid'] = user.userid
        session['mfa_required'] = True
        send_mfa_code(user)
        redirect_to_mfa_page()
    else:
        session['userid'] = user.userid
        session['authenticated'] = True
```

### Key Takeaway
Never trust application-level checks for security limits. Use **database uniqueness constraints**, **SELECT FOR UPDATE** with transactions, or **atomic operations** to enforce business rules. Eliminate intermediate states where sessions or resources are partially valid.

---

## 7. Partial Construction Race Conditions (Security)

### Description
Objects created through multiple steps expose exploitable intermediate states. Attackers inject empty/null values that match uninitialized database states, bypassing security checks.

### Bad Code Example

```python
# User registration in multiple steps
def register_user(username, email):
    # Step 1: Create user record
    user_id = db.execute(
        "INSERT INTO users (username, email) VALUES (?, ?) RETURNING id",
        username, email
    )

    # Race window: User exists but has no API key yet!

    # Step 2: Generate and assign API key
    api_key = generate_api_key()
    db.execute(
        "UPDATE users SET api_key = ? WHERE id = ?",
        api_key, user_id
    )

    return user_id

# Attacker exploits the race window:
# GET /api/user/info?user=victim&api_key=
# Empty api_key matches the uninitialized state!
```

### Bad Code Example - Parameter Injection

```php
// PHP vulnerability with array parameters
$api_key = $_GET['api_key'];  // Expects string

// Normal: api_key=abc123
// Attack: api_key[]=  (creates empty array)

// Database query
$user = db->query("SELECT * FROM users WHERE api_key = ?", $api_key);
// When api_key is NULL in DB and $api_key is empty array, condition might match!
```

### Good Code Example - Atomic Creation

```python
def register_user(username, email):
    # Create user with API key in single atomic operation
    api_key = generate_api_key()

    user_id = db.execute(
        "INSERT INTO users (username, email, api_key) VALUES (?, ?, ?) RETURNING id",
        username, email, api_key
    )

    return user_id

# No intermediate state exists
```

### Good Code Example - Proper Validation

```python
def get_user_info(user_id, api_key):
    # Strict validation
    if not api_key or not isinstance(api_key, str) or len(api_key) < 32:
        raise ValueError("Invalid API key format")

    # Explicit NULL check in query
    user = db.query(
        "SELECT * FROM users WHERE id = ? AND api_key = ? AND api_key IS NOT NULL",
        user_id, api_key
    )

    return user
```

### Good Code Example - Database Constraints

```sql
-- Prevent NULL API keys at database level
ALTER TABLE users ALTER COLUMN api_key SET NOT NULL;
ALTER TABLE users ADD CONSTRAINT api_key_min_length CHECK (length(api_key) >= 32);

-- Use DEFAULT for immediate initialization
ALTER TABLE users ALTER COLUMN api_key SET DEFAULT gen_random_uuid()::text;
```

### Key Takeaway
Never create security-critical objects in multiple steps. Use **atomic creation** with all required fields, enforce **NOT NULL constraints** in the database, and perform **strict input validation** to reject empty/null values. Explicitly check for NULL in queries when comparing security tokens.

---

## 8. Message Passing (Rust - Safe Pattern)

### Description
Rust's ownership system prevents race conditions through message passing. When a thread sends a value through a channel, ownership transfers to the receiving thread, making it impossible to access the value from the sending thread afterward. This eliminates shared mutable state.

### Bad Code Example (Won't Compile)

```rust
use std::sync::mpsc;
use std::thread;

fn main() {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let val = String::from("hello");
        tx.send(val).unwrap();
        println!("Sent: {}", val);  // ERROR: val was moved!
    });

    let received = rx.recv().unwrap();
    println!("Got: {}", received);
}

// Compiler error:
// error[E0382]: borrow of moved value: `val`
// value moved here when sent through channel
```

### Good Code Example - Single Producer

```rust
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn main() {
    let (tx, rx) = mpsc::channel();

    thread::spawn(move || {
        let messages = vec![
            String::from("hello"),
            String::from("from"),
            String::from("the"),
            String::from("thread"),
        ];

        for msg in messages {
            tx.send(msg).unwrap();  // Ownership transferred
            thread::sleep(Duration::from_millis(100));
        }
    });

    // Iterate over received messages
    for received in rx {
        println!("Got: {}", received);
    }
}

// Output:
// Got: hello
// Got: from
// Got: the
// Got: thread
```

### Good Code Example - Multiple Producers

```rust
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

fn main() {
    let (tx, rx) = mpsc::channel();
    let tx1 = tx.clone();  // Clone transmitter for second thread

    thread::spawn(move || {
        let messages = vec![
            String::from("hi"),
            String::from("from"),
            String::from("thread1"),
        ];

        for msg in messages {
            tx1.send(msg).unwrap();
            thread::sleep(Duration::from_secs(1));
        }
    });

    thread::spawn(move || {
        let messages = vec![
            String::from("more"),
            String::from("messages"),
            String::from("from"),
            String::from("thread2"),
        ];

        for msg in messages {
            tx.send(msg).unwrap();
            thread::sleep(Duration::from_secs(1));
        }
    });

    for received in rx {
        println!("Got: {}", received);
    }
}
```

### Key Takeaway
Rust's message passing with **ownership transfer** eliminates race conditions at compile time. The type system enforces that only one thread owns data at any moment, preventing simultaneous mutable access. Use **mpsc channels** (multiple producer, single consumer) for safe concurrent communication without locks.

---

## 9. Time-Sensitive Token Generation (Security)

### Description
Using timestamps or predictable values instead of cryptographic randomness for security tokens enables attackers to generate colliding tokens by synchronizing requests.

### Bad Code Example

```python
import time

def generate_password_reset_token(user_id):
    # Vulnerable: Uses timestamp as token
    timestamp = int(time.time() * 1000)  # Millisecond precision
    token = f"{user_id}-{timestamp}"

    db.execute(
        "INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, NOW())",
        user_id, token
    )

    return token

# Attack: Send simultaneous reset requests for different users
# Tokens might collide: "123-1638360000000" and "456-1638360000000"
# Attacker can use victim's token by guessing the timestamp
```

### Bad Code Example - Weak Random

```python
import random

def generate_session_id():
    # Vulnerable: Predictable PRNG
    random.seed(int(time.time()))
    return random.randint(100000, 999999)

# Attacker can predict next session IDs by knowing approximate time
```

### Good Code Example - Cryptographic Randomness

```python
import secrets

def generate_password_reset_token(user_id):
    # Secure: Cryptographically random token
    token = secrets.token_urlsafe(32)  # 32 bytes = 256 bits

    db.execute(
        "INSERT INTO reset_tokens (user_id, token, created_at) VALUES (?, ?, NOW())",
        user_id, token
    )

    return token

def generate_session_id():
    # Secure: Cryptographically random
    return secrets.token_hex(16)  # 16 bytes = 128 bits
```

### Good Code Example - UUID v4

```python
import uuid

def generate_api_key():
    # Secure: Random UUID (Version 4)
    return str(uuid.uuid4())

# Example: "550e8400-e29b-41d4-a716-446655440000"
```

### Key Takeaway
Never use timestamps, sequential IDs, or weak random number generators for security tokens. Use **cryptographically secure random generators** like `secrets.token_urlsafe()` in Python, `SecureRandom` in Java, or `crypto.randomBytes()` in Node.js. Ensure tokens have sufficient entropy (at least 128 bits).

---

## Testing and Detection

### Single-Packet Attack Technique
Modern race condition testing uses HTTP/2 multiplexing to send 20-30 requests in a single TCP packet, ensuring near-simultaneous arrival (median spread: 1ms, standard deviation: 0.3ms).

### Detection Methodology
1. **Predict**: Identify security-critical endpoints with collision potential
2. **Probe**: Compare sequential vs parallel request behavior
3. **Prove**: Remove unnecessary requests and replicate consistently

### Tools
- Burp Suite Repeater (HTTP/2 single-packet attack)
- Turbo Intruder (Python-based complex attack scripting)
- Custom concurrent request generators

---

## Summary: Prevention Best Practices

### Database Level
- Use **SERIALIZABLE isolation** for automatic conflict detection
- Employ **advisory locks** for explicit atomicity
- Leverage **uniqueness constraints** and **CHECK constraints**
- Prefer **atomic UPDATE** operations over SELECT + UPDATE
- Use **SELECT FOR UPDATE** for pessimistic locking
- Design tables with **NOT NULL** constraints on security-critical fields

### Application Level (Java)
- Use **synchronized** methods/blocks for complex operations
- Use **AtomicInteger/AtomicLong** for simple counters
- Prefer **java.util.concurrent** utilities over manual synchronization
- Avoid check-then-act patterns without synchronization

### Security Level
- Eliminate multi-step object creation sequences
- Use **cryptographically secure random** token generation
- Validate input types and reject NULL/empty security tokens
- Design single-step state transitions (no intermediate valid states)
- Implement database-level constraints, not just app-level checks

### Architecture Level
- Follow Rust's principle: "Share memory by communicating" (message passing)
- Design stateless APIs where possible
- Use idempotency keys for retryable operations
- Implement comprehensive monitoring and anomaly detection

---

## References and Further Reading

This knowledge base was compiled from multiple authoritative sources on race conditions, concurrency, and security:

- PostgreSQL transaction isolation and advisory locks
- CockroachDB serializable transaction documentation
- Java concurrency patterns and thread safety
- Rust ownership and message passing model
- Web security race condition exploitation techniques
- Database UPSERT concurrency best practices
