# Retry Patterns and Distributed Systems Resilience

This document describes common anti-patterns and best practices for implementing retries, timeouts, and backoff strategies in distributed systems. These patterns are critical for building resilient services that can handle transient failures without causing cascading outages.

## Anti-Pattern: Retry Storm (Thundering Herd)

### Description
A retry storm occurs when multiple clients retry failed requests too frequently or indefinitely, preventing a struggling service from recovering. When a service becomes unavailable, aggressive retry behavior from many clients simultaneously can overwhelm the service during its recovery phase, intensifying the original problem and causing cascading failures.

### Bad Code Example

```csharp
// ANTI-PATTERN: Infinite retry loop
public async Task<string> GetDataFromServer()
{
    while(true)  // Never gives up, keeps hammering the service
    {
        var result = await httpClient.GetAsync($"http://{hostName}:8080/api/data");
        if (result.IsSuccessStatusCode) break;
        // No delay between retries - immediately retries on failure
    }
    return await result.Content.ReadAsStringAsync();
}
```

**Problems:**
- Infinite loop with no exit condition
- No delay between retry attempts
- Doesn't distinguish between transient and permanent failures
- Multiple clients doing this simultaneously create a "storm" of requests
- Service cannot recover under continuous load

### Good Code Example

```csharp
// GOOD: Limited retries with exponential backoff
public async Task<string> GetDataFromServer()
{
    int maxRetries = 3;
    int retryCount = 0;
    int baseDelayMs = 100;

    while(retryCount < maxRetries)
    {
        try
        {
            var result = await httpClient.GetAsync($"http://{hostName}:8080/api/data");

            if (result.IsSuccessStatusCode)
            {
                return await result.Content.ReadAsStringAsync();
            }

            // Check for Retry-After header
            if (result.Headers.RetryAfter != null)
            {
                await Task.Delay(result.Headers.RetryAfter.Delta.Value);
                retryCount++;
                continue;
            }

            // Don't retry on client errors (4xx)
            if ((int)result.StatusCode >= 400 && (int)result.StatusCode < 500)
            {
                throw new Exception($"Client error: {result.StatusCode}");
            }
        }
        catch (HttpRequestException ex)
        {
            retryCount++;
            if (retryCount >= maxRetries)
            {
                throw new Exception("Max retries exceeded", ex);
            }

            // Exponential backoff with jitter
            int delayMs = baseDelayMs * (int)Math.Pow(2, retryCount);
            int jitter = Random.Shared.Next(0, delayMs / 2);
            await Task.Delay(delayMs + jitter);
        }
    }

    throw new Exception("Failed after all retries");
}
```

### Key Takeaways
- **Limit retry attempts**: Never retry indefinitely; set a maximum retry count (typically 3-5 attempts)
- **Implement exponential backoff**: Gradually increase delay between retries (e.g., 100ms, 200ms, 400ms, 800ms)
- **Add jitter**: Randomize delays to prevent synchronized retries from multiple clients
- **Honor Retry-After headers**: Respect server guidance on when to retry
- **Distinguish error types**: Don't retry on client errors (4xx) that won't succeed on retry
- **Use timeout limits**: Don't retry for longer than the business requirement allows
- **Consider circuit breaker pattern**: Stop retrying when a service is clearly down

## Pattern: Exponential Backoff with Full Jitter

### Description
Exponential backoff increases the delay between successive retry attempts exponentially, reducing load on struggling services. Full jitter adds maximum randomization to prevent multiple clients from retrying in lockstep, spreading load more evenly over time.

### Bad Code Example

```python
# ANTI-PATTERN: Fixed delay retries
def fetch_data(url):
    max_retries = 5
    for attempt in range(max_retries):
        try:
            response = requests.get(url)
            return response.json()
        except RequestException:
            time.sleep(1)  # Always waits exactly 1 second
            # Problem: All clients retry at the same intervals
    raise Exception("Failed after retries")
```

**Problems:**
- Fixed delay means all clients retry synchronously
- Creates predictable traffic spikes every second
- Doesn't adapt to service recovery time
- No jitter to distribute load

### Good Code Example

```python
# GOOD: Exponential backoff with full jitter
import random
import time

def fetch_data_with_backoff(url):
    max_retries = 5
    base_delay = 0.1  # 100ms base delay
    max_delay = 10.0  # Cap maximum delay at 10 seconds

    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=5)
            return response.json()
        except RequestException as e:
            if attempt == max_retries - 1:
                raise Exception("Max retries exceeded") from e

            # Exponential backoff: 2^attempt * base_delay
            exponential_delay = min(base_delay * (2 ** attempt), max_delay)

            # Full jitter: random value between 0 and exponential_delay
            jittered_delay = random.uniform(0, exponential_delay)

            time.sleep(jittered_delay)

    raise Exception("Failed after retries")
```

### Alternative: Decorrelated Jitter

```python
# GOOD: Decorrelated jitter (adaptive approach)
def fetch_with_decorrelated_jitter(url):
    max_retries = 5
    base_delay = 0.1
    max_delay = 10.0
    previous_delay = base_delay

    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=5)
            return response.json()
        except RequestException as e:
            if attempt == max_retries - 1:
                raise Exception("Max retries exceeded") from e

            # Decorrelated jitter: next delay depends on previous delay
            # Adapts better to actual system conditions
            delay = random.uniform(base_delay, previous_delay * 3)
            delay = min(delay, max_delay)

            time.sleep(delay)
            previous_delay = delay

    raise Exception("Failed after retries")
```

### Key Takeaways
- **Exponential backoff**: Multiply delay by 2 (or similar factor) for each retry attempt
- **Cap maximum delay**: Prevent delays from growing too large (e.g., cap at 10-30 seconds)
- **Full jitter**: Choose random delay between 0 and maximum exponential delay
- **Decorrelated jitter**: Each retry's delay depends on the previous delay, creating adaptive behavior
- **Benefits**: Spreads client retry attempts over time, reducing load spikes during service recovery

## Pattern: Timeout Configuration

### Description
Timeouts prevent resource exhaustion by setting maximum wait times on requests. Without proper timeouts, failed or slow services can consume client resources indefinitely, leading to cascading failures. Timeouts must be set based on realistic service performance expectations.

### Bad Code Example

```javascript
// ANTI-PATTERN: No timeout or infinite timeout
async function fetchUserData(userId) {
    // No timeout specified - could wait forever
    const response = await fetch(`https://api.example.com/users/${userId}`);
    return response.json();
}

// ANTI-PATTERN: Timeout too short for realistic latency
async function fetchWithTinyTimeout(userId) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 50); // 50ms is unrealistic

    try {
        const response = await fetch(`https://api.example.com/users/${userId}`, {
            signal: controller.signal
        });
        return response.json();
    } finally {
        clearTimeout(timeoutId);
    }
}
```

**Problems:**
- No timeout can cause threads/connections to hang indefinitely
- Too-short timeout causes false failures and unnecessary retries
- Doesn't account for realistic network and service latency
- Can cause connection pool exhaustion

### Good Code Example

```javascript
// GOOD: Reasonable timeout based on service SLA
async function fetchUserDataWithTimeout(userId) {
    const controller = new AbortController();
    // Set timeout based on p99.9 latency + safety margin
    // If service p99.9 is 500ms, set timeout to 2-3x that
    const timeoutMs = 1500;
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(`https://api.example.com/users/${userId}`, {
            signal: controller.signal
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        return response.json();
    } catch (error) {
        if (error.name === 'AbortError') {
            throw new Error(`Request timeout after ${timeoutMs}ms`);
        }
        throw error;
    } finally {
        clearTimeout(timeoutId);
    }
}

// GOOD: Timeout with retry logic
async function fetchWithTimeoutAndRetry(userId) {
    const maxRetries = 3;
    const timeoutMs = 1500;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

        try {
            const response = await fetch(`https://api.example.com/users/${userId}`, {
                signal: controller.signal
            });
            clearTimeout(timeoutId);

            if (response.ok) {
                return response.json();
            }

            // Don't retry on client errors
            if (response.status >= 400 && response.status < 500) {
                throw new Error(`Client error: ${response.status}`);
            }
        } catch (error) {
            clearTimeout(timeoutId);

            if (attempt === maxRetries - 1) {
                throw new Error(`Failed after ${maxRetries} attempts: ${error.message}`);
            }

            // Exponential backoff with jitter
            const baseDelay = 100;
            const exponentialDelay = baseDelay * Math.pow(2, attempt);
            const jitter = Math.random() * exponentialDelay;
            await new Promise(resolve => setTimeout(resolve, exponentialDelay + jitter));
        }
    }
}
```

### Key Takeaways
- **Always set timeouts**: Never leave requests without timeout limits
- **Base on realistic latency**: Use p99.9 latency + safety margin (2-3x)
- **Consider downstream chains**: If your service calls others, account for cumulative latency
- **Use library defaults wisely**: Well-tested client libraries often have sensible timeout defaults
- **Combine with retries**: Timeout + retry provides robust failure handling
- **Log timeout occurrences**: Track timeouts to identify performance issues

## Pattern: Circuit Breaker

### Description
The circuit breaker pattern prevents retry storms by stopping requests to a failing service, giving it time to recover. It acts like an electrical circuit breaker: when failures exceed a threshold, the circuit "opens" and rejects requests immediately without attempting them. After a timeout period, it allows test requests to check if the service has recovered.

### States
- **Closed**: Normal operation, requests pass through
- **Open**: Service is failing, requests are rejected immediately
- **Half-Open**: Testing if service has recovered, limited requests allowed

### Code Example

```python
# GOOD: Circuit breaker implementation
import time
from enum import Enum
from datetime import datetime, timedelta

class CircuitState(Enum):
    CLOSED = "closed"
    OPEN = "open"
    HALF_OPEN = "half_open"

class CircuitBreaker:
    def __init__(
        self,
        failure_threshold=5,      # Open after 5 failures
        recovery_timeout=60,       # Try again after 60 seconds
        half_open_max_calls=3      # Test with 3 calls in half-open
    ):
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls

        self.failure_count = 0
        self.last_failure_time = None
        self.state = CircuitState.CLOSED
        self.half_open_calls = 0

    def call(self, func, *args, **kwargs):
        if self.state == CircuitState.OPEN:
            # Check if recovery timeout has elapsed
            if self._should_attempt_reset():
                self.state = CircuitState.HALF_OPEN
                self.half_open_calls = 0
            else:
                raise Exception("Circuit breaker is OPEN - service unavailable")

        if self.state == CircuitState.HALF_OPEN:
            if self.half_open_calls >= self.half_open_max_calls:
                raise Exception("Circuit breaker HALF_OPEN - max test calls reached")
            self.half_open_calls += 1

        try:
            result = func(*args, **kwargs)
            self._on_success()
            return result
        except Exception as e:
            self._on_failure()
            raise e

    def _should_attempt_reset(self):
        if self.last_failure_time is None:
            return True
        return time.time() - self.last_failure_time >= self.recovery_timeout

    def _on_success(self):
        if self.state == CircuitState.HALF_OPEN:
            # Enough successful test calls, close the circuit
            self.state = CircuitState.CLOSED
        self.failure_count = 0

    def _on_failure(self):
        self.failure_count += 1
        self.last_failure_time = time.time()

        if self.state == CircuitState.HALF_OPEN:
            # Failed during testing, reopen circuit
            self.state = CircuitState.OPEN
            self.half_open_calls = 0
        elif self.failure_count >= self.failure_threshold:
            # Too many failures, open circuit
            self.state = CircuitState.OPEN

# Usage example
circuit_breaker = CircuitBreaker(
    failure_threshold=5,
    recovery_timeout=60,
    half_open_max_calls=3
)

def fetch_external_api():
    response = requests.get("https://api.example.com/data", timeout=2)
    response.raise_for_status()
    return response.json()

# Wrap calls with circuit breaker
try:
    data = circuit_breaker.call(fetch_external_api)
    print("Data retrieved successfully")
except Exception as e:
    print(f"Circuit breaker prevented call or call failed: {e}")
```

### Key Takeaways
- **Prevents retry storms**: Stops sending requests to failing services automatically
- **Fast failure**: Returns errors immediately when circuit is open, no wasted resources
- **Automatic recovery testing**: Half-open state tests if service has recovered
- **Configurable thresholds**: Tune failure count, timeout, and test request limits
- **Complements retries**: Use circuit breaker around retry logic for comprehensive protection
- **Service-level isolation**: Prevents cascading failures across microservices

## Pattern: Idempotent API Design

### Description
Idempotent operations produce the same result regardless of how many times they're executed. Designing APIs as idempotent makes retries safe, preventing duplicate side effects like multiple charges or duplicate data insertion.

### Bad Code Example

```javascript
// ANTI-PATTERN: Non-idempotent operation
app.post('/api/orders', async (req, res) => {
    const { userId, items, total } = req.body;

    // Problem: If client retries, this creates duplicate orders
    const order = await db.orders.create({
        userId,
        items,
        total,
        status: 'pending'
    });

    // Problem: Multiple charges if request is retried
    await paymentService.charge(userId, total);

    res.json({ orderId: order.id });
});
```

**Problems:**
- Network timeout could cause client to retry
- Each retry creates a new order in database
- Customer gets charged multiple times
- No way to distinguish duplicate requests from new ones

### Good Code Example

```javascript
// GOOD: Idempotent operation with idempotency key
app.post('/api/orders', async (req, res) => {
    const { userId, items, total } = req.body;
    const idempotencyKey = req.headers['idempotency-key'];

    if (!idempotencyKey) {
        return res.status(400).json({
            error: 'Idempotency-Key header required'
        });
    }

    // Check if we've already processed this request
    const existingOrder = await db.orders.findOne({
        where: { idempotencyKey }
    });

    if (existingOrder) {
        // Return the same response as before - idempotent!
        return res.json({ orderId: existingOrder.id });
    }

    // Use transaction to ensure atomicity
    const order = await db.transaction(async (transaction) => {
        // Create order with idempotency key
        const newOrder = await db.orders.create({
            userId,
            items,
            total,
            status: 'pending',
            idempotencyKey
        }, { transaction });

        // Payment service should also handle idempotency
        await paymentService.charge(userId, total, idempotencyKey);

        return newOrder;
    });

    res.json({ orderId: order.id });
});
```

### Client-Side Usage

```javascript
// Client generates idempotency key
import { v4 as uuidv4 } from 'uuid';

async function createOrderWithRetry(orderData) {
    const idempotencyKey = uuidv4(); // Generate once per logical request
    const maxRetries = 3;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch('/api/orders', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Idempotency-Key': idempotencyKey // Same key for all retries
                },
                body: JSON.stringify(orderData)
            });

            if (response.ok) {
                return response.json();
            }

            // Don't retry on client errors
            if (response.status >= 400 && response.status < 500) {
                throw new Error(`Client error: ${response.status}`);
            }
        } catch (error) {
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Exponential backoff
            const delay = 100 * Math.pow(2, attempt);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}
```

### Key Takeaways
- **Use idempotency keys**: Unique client-generated IDs (UUIDs) to identify logical requests
- **Store keys with operations**: Save idempotency keys in database to detect duplicates
- **Return cached responses**: If key already processed, return the original response
- **HTTP methods**: GET, PUT, DELETE are naturally idempotent; POST usually isn't
- **Time-bound keys**: Consider expiring old idempotency keys (e.g., after 24 hours)
- **Safe retries**: Idempotent APIs allow aggressive retry strategies without side effects

## Service-Side Protection Patterns

### Description
Services should implement protections to handle excessive client requests and communicate their state effectively. These patterns prevent client retry storms from overwhelming backend systems.

### Pattern: Rate Limiting and Throttling

```python
# GOOD: Rate limiting with Retry-After header
from flask import Flask, request, jsonify
from datetime import datetime, timedelta
import redis

app = Flask(__name__)
redis_client = redis.Redis(host='localhost', port=6379, db=0)

def rate_limit(max_requests=100, window_seconds=60):
    def decorator(func):
        def wrapper(*args, **kwargs):
            # Identify client (use API key, IP, or user ID)
            client_id = request.headers.get('X-API-Key') or request.remote_addr
            key = f"rate_limit:{client_id}"

            # Get current request count
            current = redis_client.get(key)

            if current and int(current) >= max_requests:
                # Calculate when limit resets
                ttl = redis_client.ttl(key)
                retry_after = max(ttl, 1)

                return jsonify({
                    'error': 'Rate limit exceeded',
                    'retry_after_seconds': retry_after
                }), 429, {'Retry-After': str(retry_after)}

            # Increment counter
            pipe = redis_client.pipeline()
            pipe.incr(key)
            pipe.expire(key, window_seconds)
            pipe.execute()

            return func(*args, **kwargs)

        wrapper.__name__ = func.__name__
        return wrapper
    return decorator

@app.route('/api/data')
@rate_limit(max_requests=100, window_seconds=60)
def get_data():
    return jsonify({'data': 'some data'})
```

### Pattern: Gateway Layer with Circuit Breaker

```yaml
# API Gateway configuration example (conceptual)
apiVersion: v1
kind: Service
metadata:
  name: api-gateway
spec:
  resilience:
    circuitBreaker:
      enabled: true
      failureThreshold: 10
      timeout: 30s
      halfOpenRequests: 3

    rateLimiting:
      enabled: true
      requestsPerSecond: 1000
      burstSize: 2000

    bulkhead:
      maxConcurrentRequests: 100
      maxQueuedRequests: 50

    healthCheck:
      path: /health
      interval: 10s
      timeout: 3s
      unhealthyThreshold: 3
      healthyThreshold: 2
```

### Pattern: Graceful Degradation

```python
# GOOD: Graceful degradation with fallback
async def get_user_recommendations(user_id):
    circuit_breaker = get_circuit_breaker('recommendations')

    try:
        # Try to get personalized recommendations
        recommendations = await circuit_breaker.call(
            recommendation_service.get_personalized,
            user_id,
            timeout=2.0
        )
        return recommendations
    except Exception as e:
        # Service unavailable - use fallback
        logger.warning(f"Recommendation service unavailable: {e}")

        # Return popular/trending items instead
        return await cache.get_popular_items(limit=10)

async def get_user_profile(user_id):
    try:
        # Try database with timeout
        profile = await db.users.find_one(
            {'id': user_id},
            timeout=1.0
        )
        return profile
    except TimeoutError:
        # Database slow - try cache
        cached_profile = await cache.get(f"user:{user_id}")
        if cached_profile:
            return cached_profile

        # Return minimal profile to keep system functional
        return {
            'id': user_id,
            'name': 'User',
            'status': 'Profile temporarily unavailable'
        }
```

### Key Takeaways
- **Rate limiting**: Prevent abuse and protect backend from excessive load
- **Retry-After headers**: Tell clients explicitly when to retry
- **Gateway layer**: Centralize resilience patterns (circuit breaker, rate limiting, bulkhead)
- **Health checks**: Expose service health for load balancers and orchestrators
- **Graceful degradation**: Provide fallback responses when dependencies fail
- **Bulkhead pattern**: Isolate connection pools to prevent cascade failures
- **Request prioritization**: Handle critical requests even under high load

## Summary: Building Resilient Distributed Systems

### Client-Side Best Practices
1. **Limited retries**: 3-5 attempts maximum, not infinite loops
2. **Exponential backoff**: Multiply delay by 2 each attempt
3. **Jitter**: Randomize delays to prevent synchronized retries
4. **Timeouts**: Set based on p99.9 latency + safety margin
5. **Idempotency keys**: Make retries safe by preventing duplicate side effects
6. **Circuit breakers**: Stop sending requests to known-failing services
7. **Respect server signals**: Honor Retry-After headers and error codes
8. **Error classification**: Don't retry permanent failures (4xx errors)

### Service-Side Best Practices
1. **Rate limiting**: Protect against excessive load
2. **Retry-After headers**: Guide client retry timing
3. **Gateway layer**: Implement centralized resilience patterns
4. **Health endpoints**: Expose service status for monitoring
5. **Graceful degradation**: Provide fallback responses
6. **Bulkhead isolation**: Prevent failure propagation
7. **Load shedding**: Drop non-critical requests under extreme load

### Anti-Patterns to Avoid
- Infinite retry loops without backoff
- Fixed delay retries (no jitter)
- Missing or unrealistic timeouts
- Retrying on client errors (4xx)
- Non-idempotent operations without protection
- No circuit breakers between services
- Ignoring server retry signals

### Testing Resilience
- Test with artificial delays and failures
- Verify backoff and jitter behavior
- Test timeout handling
- Verify idempotency with duplicate requests
- Test circuit breaker state transitions
- Load test under degraded conditions

These patterns work together to create resilient systems that gracefully handle failures, protect struggling services from overload, and provide the best possible user experience even when dependencies fail.
