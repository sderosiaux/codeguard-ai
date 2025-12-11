# Error Handling Patterns in Distributed Systems

This document covers common error handling anti-patterns and their correct implementations across distributed systems.

---

## 1. Swallowed Exceptions

### Description
Exceptions that are caught but not properly handled, logged, or propagated lose critical error information. This makes debugging impossible and hides system failures from monitoring.

### Bad Examples

**Java - Error Lost in Logging**
```java
try {
    processPayment(order);
} catch (Exception e) {
    log.warn("Payment processing issue"); // Exception details lost
}
```

**JavaScript - Empty Catch Block**
```javascript
async function fetchUserData(userId) {
    try {
        return await api.getUser(userId);
    } catch (error) {
        // Silent failure - error completely swallowed
    }
}
```

**Java - CompletableFuture Swallowing**
```java
CompletableFuture<String> future = fetchDataAsync()
    .exceptionally(ex -> {
        log.debug("Fetch failed"); // Error swallowed, no propagation
        return null;
    });
```

**Python - Generic Exception Handler**
```python
try:
    result = expensive_computation()
except Exception:
    pass  # Error silently swallowed
```

### Good Examples

**Java - Proper Error Handling with Context**
```java
try {
    processPayment(order);
} catch (PaymentException e) {
    log.error("Payment processing failed for order {}: {}",
              order.getId(), e.getMessage(), e);
    throw new ServiceException("Payment failed", e);
}
```

**JavaScript - Proper Async Error Propagation**
```javascript
async function fetchUserData(userId) {
    try {
        return await api.getUser(userId);
    } catch (error) {
        logger.error(`Failed to fetch user ${userId}`, { error, userId });
        throw new UserFetchError(`User ${userId} not found`, { cause: error });
    }
}
```

**Java - CompletableFuture with Proper Error Handling**
```java
CompletableFuture<String> future = fetchDataAsync()
    .exceptionally(ex -> {
        log.error("Async fetch failed", ex);
        metrics.incrementError("fetch_failure");
        throw new CompletionException("Fetch operation failed", ex);
    });
```

**Python - Specific Exception Handling**
```python
try:
    result = expensive_computation()
except ComputationError as e:
    logger.error(f"Computation failed: {e}", exc_info=True)
    metrics.increment("computation_errors")
    raise ServiceError("Computation unavailable") from e
```

### Key Takeaway
Always log exceptions with full context (stack trace, operation details) and either handle them meaningfully or propagate them. Never silently swallow errors.

---

## 2. Resource Leaks

### Description
Resources (memory, connections, file handles) that are not properly released when errors occur accumulate over time, leading to memory leaks, connection pool exhaustion, and eventual system failure.

### Bad Examples

**Java - Netty ByteBuf Leak**
```java
public void processMessage(ByteBuf message) {
    if (message.readableBytes() < HEADER_SIZE) {
        throw new InvalidMessageException("Message too short");
        // ByteBuf never released - memory leak
    }
    String data = message.toString(StandardCharsets.UTF_8);
    message.release();
}
```

**Python - Connection Not Closed on Error**
```python
def fetch_data(query):
    conn = get_database_connection()
    cursor = conn.cursor()
    cursor.execute(query)
    if not cursor.rowcount:
        raise NoDataError("No results found")  # Connection leaked
    return cursor.fetchall()
```

**TypeScript - Event Listener Leak**
```typescript
class DataStreamer {
    subscribe(callback: (data: any) => void) {
        const ws = new WebSocket(this.url);
        ws.addEventListener('message', callback);

        if (!this.isValidConnection(ws)) {
            throw new Error("Invalid connection");
            // Listener never removed - memory leak
        }
    }
}
```

**Go - File Handle Leak**
```go
func readConfig(path string) ([]byte, error) {
    file, err := os.Open(path)
    if err != nil {
        return nil, err
    }

    info, err := file.Stat()
    if err != nil {
        return nil, err  // File handle leaked
    }

    return io.ReadAll(file)  // Also leaked on ReadAll error
}
```

### Good Examples

**Java - Proper ByteBuf Management**
```java
public void processMessage(ByteBuf message) {
    try {
        if (message.readableBytes() < HEADER_SIZE) {
            throw new InvalidMessageException("Message too short");
        }
        String data = message.toString(StandardCharsets.UTF_8);
        processData(data);
    } finally {
        message.release(); // Always released, even on exception
    }
}
```

**Python - Connection Management with Context Manager**
```python
def fetch_data(query):
    with get_database_connection() as conn:
        with conn.cursor() as cursor:
            cursor.execute(query)
            if not cursor.rowcount:
                raise NoDataError("No results found")
            return cursor.fetchall()
    # Connection and cursor automatically closed, even on exception
```

**TypeScript - Proper Cleanup**
```typescript
class DataStreamer {
    subscribe(callback: (data: any) => void): () => void {
        const ws = new WebSocket(this.url);

        const handler = (event: MessageEvent) => callback(event.data);
        ws.addEventListener('message', handler);

        try {
            if (!this.isValidConnection(ws)) {
                throw new Error("Invalid connection");
            }
        } catch (error) {
            ws.removeEventListener('message', handler);
            ws.close();
            throw error;
        }

        // Return cleanup function
        return () => {
            ws.removeEventListener('message', handler);
            ws.close();
        };
    }
}
```

**Go - Defer for Cleanup**
```go
func readConfig(path string) ([]byte, error) {
    file, err := os.Open(path)
    if err != nil {
        return nil, err
    }
    defer file.Close()  // Ensures cleanup on all paths

    info, err := file.Stat()
    if err != nil {
        return nil, err  // File will be closed by defer
    }

    return io.ReadAll(file)  // File closed even if ReadAll fails
}
```

### Key Takeaway
Use language-specific resource management patterns (try-finally, defer, context managers, try-with-resources) to ensure resources are always released, regardless of success or failure.

---

## 3. Incomplete Cleanup

### Description
Cleanup code that doesn't run reliably or can itself throw exceptions, leading to resource leaks and inconsistent system state.

### Bad Examples

**Java - Cleanup Before Exception**
```java
public void processFile(String path) {
    FileInputStream fis = new FileInputStream(path);
    BufferedReader reader = new BufferedReader(new InputStreamReader(fis));

    try {
        String line = reader.readLine();
        processLine(line);
    } finally {
        reader.close();  // If this throws, fis never closed
        fis.close();
    }
}
```

**Python - Finally Block Can Throw**
```python
def process_records(db_connection, records):
    try:
        for record in records:
            db_connection.insert(record)
    finally:
        db_connection.close()  # Can throw, preventing further cleanup
        cleanup_temp_files()   # Never reached if close() throws
```

**TypeScript - Partial Cleanup**
```typescript
async function uploadFiles(files: File[]) {
    const uploads: Promise<void>[] = [];

    for (const file of files) {
        const stream = createReadStream(file.path);
        uploads.push(uploadToS3(stream));
    }

    try {
        await Promise.all(uploads);
    } catch (error) {
        // Streams not closed on error - partial cleanup
        throw error;
    }
}
```

**Go - Missing Cleanup on Early Return**
```go
func processData(ctx context.Context) error {
    mutex.Lock()

    if !isReady() {
        return errors.New("not ready")  // Mutex never unlocked
    }

    defer mutex.Unlock()
    return doWork(ctx)
}
```

### Good Examples

**Java - Try-With-Resources**
```java
public void processFile(String path) {
    try (FileInputStream fis = new FileInputStream(path);
         BufferedReader reader = new BufferedReader(new InputStreamReader(fis))) {

        String line = reader.readLine();
        processLine(line);

    } // Both resources closed in reverse order, even if close() throws
}
```

**Python - Nested Try-Finally**
```python
def process_records(db_connection, records):
    try:
        for record in records:
            db_connection.insert(record)
    finally:
        try:
            db_connection.close()
        except Exception as e:
            logger.error(f"Error closing connection: {e}")
        finally:
            try:
                cleanup_temp_files()
            except Exception as e:
                logger.error(f"Error cleaning temp files: {e}")
```

**TypeScript - Comprehensive Cleanup**
```typescript
async function uploadFiles(files: File[]) {
    const streams: fs.ReadStream[] = [];

    try {
        const uploads = files.map(file => {
            const stream = createReadStream(file.path);
            streams.push(stream);
            return uploadToS3(stream);
        });

        await Promise.all(uploads);
    } catch (error) {
        throw error;
    } finally {
        // Always cleanup all streams
        await Promise.allSettled(
            streams.map(stream =>
                new Promise(resolve => stream.close(resolve))
            )
        );
    }
}
```

**Go - Immediate Defer**
```go
func processData(ctx context.Context) error {
    mutex.Lock()
    defer mutex.Unlock()  // Defer immediately after acquiring resource

    if !isReady() {
        return errors.New("not ready")  // Mutex unlocked via defer
    }

    return doWork(ctx)
}
```

### Key Takeaway
Place cleanup in finally/defer blocks immediately after resource acquisition. Handle exceptions in cleanup code to prevent cascading failures. Use language features like try-with-resources when available.

---

## 4. Indefinite vs Definite Errors

### Description
Timeouts and network errors are indefinite - you don't know if the operation succeeded or failed. Treating them as definite failures can cause duplicate operations, data inconsistency, or incorrect retries.

### Bad Examples

**Java - Timeout Treated as Failure**
```java
public void submitOrder(Order order) {
    try {
        paymentService.charge(order.getAmount());
        orderRepository.save(order);
    } catch (TimeoutException e) {
        // WRONG: We don't know if payment succeeded
        order.setStatus(OrderStatus.FAILED);
        orderRepository.save(order);
    }
}
```

**Python - Retrying Potentially Successful Operation**
```python
@retry(stop=stop_after_attempt(3))
def transfer_money(from_account, to_account, amount):
    try:
        api.transfer(from_account, to_account, amount)
    except requests.Timeout:
        # WRONG: Retrying may cause duplicate transfers
        raise
```

**TypeScript - Network Error as Definite Failure**
```typescript
async function createUser(userData: UserData) {
    try {
        await userService.create(userData);
        await emailService.sendWelcome(userData.email);
    } catch (error) {
        if (error.code === 'ECONNRESET') {
            // WRONG: User might have been created
            throw new Error("User creation failed");
        }
    }
}
```

**Go - Assuming Operation Failed**
```go
func publishEvent(event Event) error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    err := publisher.Publish(ctx, event)
    if err == context.DeadlineExceeded {
        // WRONG: Event might have been published
        return fmt.Errorf("publish failed: %w", err)
    }
    return err
}
```

### Good Examples

**Java - Idempotency and Status Check**
```java
public void submitOrder(Order order) {
    try {
        String idempotencyKey = order.getIdempotencyKey();
        paymentService.charge(order.getAmount(), idempotencyKey);
        orderRepository.save(order);
    } catch (TimeoutException e) {
        // Mark as UNKNOWN and schedule reconciliation
        order.setStatus(OrderStatus.PAYMENT_PENDING);
        orderRepository.save(order);
        schedulePaymentStatusCheck(order.getId());
        throw new IndefiniteErrorException("Payment status unknown", e);
    } catch (PaymentDeclinedException e) {
        // This is definite - payment definitely failed
        order.setStatus(OrderStatus.FAILED);
        orderRepository.save(order);
        throw e;
    }
}
```

**Python - Idempotent Operations**
```python
def transfer_money(from_account, to_account, amount, idempotency_key):
    """
    Use idempotency key to make operation safe to retry.
    Server will deduplicate based on key.
    """
    try:
        api.transfer(
            from_account=from_account,
            to_account=to_account,
            amount=amount,
            idempotency_key=idempotency_key
        )
    except requests.Timeout as e:
        # Safe to retry - server will deduplicate
        logger.warning(f"Transfer timeout (key: {idempotency_key}), will retry")
        raise TransferIndefiniteError("Transfer status unknown") from e
    except requests.HTTPError as e:
        if e.response.status_code == 400:
            # Definite error - bad request won't succeed
            raise TransferDefiniteError("Invalid transfer request") from e
        raise
```

**TypeScript - Distinguish Error Types**
```typescript
enum ErrorType {
    DEFINITE,   // Operation definitely failed
    INDEFINITE, // Unknown if operation succeeded
}

async function createUser(userData: UserData): Promise<User> {
    try {
        const user = await userService.create(userData);
        await emailService.sendWelcome(userData.email);
        return user;
    } catch (error) {
        if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
            // Indefinite: check if user exists before retrying
            const existingUser = await userService.findByEmail(userData.email);
            if (existingUser) {
                return existingUser; // Already created
            }
            throw new IndefiniteError("User creation status unknown", error);
        }

        if (error.status === 400) {
            // Definite: validation error won't succeed
            throw new DefiniteError("Invalid user data", error);
        }

        throw error;
    }
}
```

**Go - Status Verification**
```go
type ErrorClassification int

const (
    Indefinite ErrorClassification = iota  // Don't know if succeeded
    Retriable                              // Failed but can retry
    Fatal                                  // Failed, don't retry
)

func publishEvent(event Event) error {
    ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
    defer cancel()

    err := publisher.Publish(ctx, event)
    if err == nil {
        return nil
    }

    classification := classifyError(err)

    switch classification {
    case Indefinite:
        // Check if event was published
        published, checkErr := publisher.CheckStatus(event.ID)
        if checkErr != nil {
            return fmt.Errorf("publish status unknown: %w", err)
        }
        if published {
            return nil // Already published
        }
        return fmt.Errorf("publish incomplete: %w", err)

    case Retriable:
        return fmt.Errorf("publish failed (retriable): %w", err)

    case Fatal:
        return fmt.Errorf("publish failed (fatal): %w", err)
    }

    return err
}

func classifyError(err error) ErrorClassification {
    if errors.Is(err, context.DeadlineExceeded) {
        return Indefinite
    }
    if errors.Is(err, syscall.ECONNREFUSED) {
        return Retriable
    }
    return Fatal
}
```

### Key Takeaway
Use idempotency keys and status verification for operations with indefinite errors (timeouts, network failures). Never assume an operation failed just because you didn't get a response. Distinguish between definite failures (validation errors) and indefinite errors (timeouts).

---

## 5. Missing Retry Logic

### Description
Transient failures in distributed systems are common. Missing or incorrect retry logic causes unnecessary failures, while naive retry implementations can create retry storms that make outages worse.

### Bad Examples

**Java - No Retry**
```java
public User fetchUser(String userId) {
    try {
        return httpClient.get("/users/" + userId);
    } catch (IOException e) {
        // Transient network error treated as permanent
        throw new UserNotFoundException("User not found", e);
    }
}
```

**Python - Retry Storm (No Backoff)**
```python
def call_api(endpoint):
    max_attempts = 100
    for attempt in range(max_attempts):
        try:
            return requests.get(endpoint, timeout=1)
        except requests.Timeout:
            continue  # Immediate retry - thundering herd
    raise Exception("API unavailable")
```

**TypeScript - No Jitter**
```typescript
async function fetchData(url: string, maxRetries = 3) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await axios.get(url);
        } catch (error) {
            const delay = Math.pow(2, i) * 1000;  // No jitter
            await sleep(delay);
            // All clients retry at same time - retry storm
        }
    }
    throw new Error("Max retries exceeded");
}
```

**Go - Retrying Fatal Errors**
```go
func processPayment(amount int) error {
    for i := 0; i < 5; i++ {
        err := paymentAPI.Charge(amount)
        if err != nil {
            time.Sleep(time.Second * time.Duration(i))
            continue  // Retries even on validation errors
        }
        return nil
    }
    return errors.New("payment failed after retries")
}
```

### Good Examples

**Java - Exponential Backoff with Jitter**
```java
public User fetchUser(String userId) {
    int maxRetries = 3;
    int baseDelayMs = 100;

    for (int attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return httpClient.get("/users/" + userId);
        } catch (IOException e) {
            if (attempt == maxRetries - 1) {
                throw new ServiceException("Failed to fetch user", e);
            }

            // Exponential backoff with jitter
            int delayMs = baseDelayMs * (1 << attempt);
            int jitter = ThreadLocalRandom.current().nextInt(delayMs / 2);
            int totalDelay = delayMs + jitter;

            log.warn("Fetch failed (attempt {}/{}), retrying in {}ms",
                     attempt + 1, maxRetries, totalDelay, e);

            try {
                Thread.sleep(totalDelay);
            } catch (InterruptedException ie) {
                Thread.currentThread().interrupt();
                throw new ServiceException("Retry interrupted", ie);
            }
        }
    }
    throw new ServiceException("Unreachable");
}
```

**Python - Smart Retry with Backoff**
```python
import random
import time
from typing import TypeVar, Callable

T = TypeVar('T')

def retry_with_backoff(
    func: Callable[[], T],
    max_attempts: int = 3,
    base_delay: float = 0.1,
    max_delay: float = 10.0,
    retriable_exceptions: tuple = (requests.Timeout, requests.ConnectionError)
) -> T:
    """
    Retry with exponential backoff and jitter.
    """
    for attempt in range(max_attempts):
        try:
            return func()
        except retriable_exceptions as e:
            if attempt == max_attempts - 1:
                raise

            # Exponential backoff with jitter
            delay = min(base_delay * (2 ** attempt), max_delay)
            jitter = random.uniform(0, delay * 0.3)
            total_delay = delay + jitter

            logger.warning(
                f"Attempt {attempt + 1}/{max_attempts} failed, "
                f"retrying in {total_delay:.2f}s: {e}"
            )
            time.sleep(total_delay)
        except requests.HTTPError as e:
            # Don't retry 4xx errors (client errors)
            if 400 <= e.response.status_code < 500:
                raise
            # Retry 5xx errors (server errors)
            if attempt == max_attempts - 1:
                raise
            time.sleep(base_delay * (2 ** attempt))

    raise Exception("Unreachable")

def call_api(endpoint: str):
    return retry_with_backoff(
        lambda: requests.get(endpoint, timeout=5),
        max_attempts=3
    )
```

**TypeScript - Retry with Circuit Breaker**
```typescript
interface RetryConfig {
    maxAttempts: number;
    baseDelayMs: number;
    maxDelayMs: number;
    retriableStatusCodes: Set<number>;
}

class RetryableHTTPClient {
    private failureCount = 0;
    private circuitOpen = false;
    private circuitOpenUntil = 0;

    private readonly CIRCUIT_THRESHOLD = 5;
    private readonly CIRCUIT_TIMEOUT = 60000; // 1 minute

    async fetchWithRetry<T>(
        url: string,
        config: RetryConfig = {
            maxAttempts: 3,
            baseDelayMs: 100,
            maxDelayMs: 5000,
            retriableStatusCodes: new Set([408, 429, 500, 502, 503, 504])
        }
    ): Promise<T> {
        // Circuit breaker check
        if (this.circuitOpen && Date.now() < this.circuitOpenUntil) {
            throw new Error("Circuit breaker open - service unavailable");
        }

        for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
            try {
                const response = await axios.get<T>(url, { timeout: 5000 });

                // Success - reset circuit breaker
                this.failureCount = 0;
                this.circuitOpen = false;

                return response.data;
            } catch (error) {
                const isLastAttempt = attempt === config.maxAttempts - 1;

                // Don't retry non-retriable errors
                if (axios.isAxiosError(error)) {
                    const status = error.response?.status;
                    if (status && !config.retriableStatusCodes.has(status)) {
                        throw error;
                    }
                }

                if (isLastAttempt) {
                    this.recordFailure();
                    throw error;
                }

                // Exponential backoff with jitter
                const delay = Math.min(
                    config.baseDelayMs * Math.pow(2, attempt),
                    config.maxDelayMs
                );
                const jitter = Math.random() * delay * 0.3;
                const totalDelay = delay + jitter;

                console.warn(
                    `Request failed (attempt ${attempt + 1}/${config.maxAttempts}), ` +
                    `retrying in ${totalDelay.toFixed(0)}ms`
                );

                await new Promise(resolve => setTimeout(resolve, totalDelay));
            }
        }

        throw new Error("Unreachable");
    }

    private recordFailure() {
        this.failureCount++;
        if (this.failureCount >= this.CIRCUIT_THRESHOLD) {
            this.circuitOpen = true;
            this.circuitOpenUntil = Date.now() + this.CIRCUIT_TIMEOUT;
            console.error("Circuit breaker opened due to repeated failures");
        }
    }
}
```

**Go - Retry with Context**
```go
type RetryConfig struct {
    MaxAttempts int
    BaseDelay   time.Duration
    MaxDelay    time.Duration
}

func RetryWithBackoff(ctx context.Context, config RetryConfig, operation func() error) error {
    var lastErr error

    for attempt := 0; attempt < config.MaxAttempts; attempt++ {
        // Check context cancellation
        if err := ctx.Err(); err != nil {
            return fmt.Errorf("operation cancelled: %w", err)
        }

        lastErr = operation()

        if lastErr == nil {
            return nil // Success
        }

        // Classify error
        if !isRetriable(lastErr) {
            return fmt.Errorf("non-retriable error: %w", lastErr)
        }

        if attempt == config.MaxAttempts-1 {
            break // Last attempt failed
        }

        // Calculate delay with exponential backoff and jitter
        delay := config.BaseDelay * time.Duration(1<<uint(attempt))
        if delay > config.MaxDelay {
            delay = config.MaxDelay
        }

        jitter := time.Duration(rand.Int63n(int64(delay) / 3))
        totalDelay := delay + jitter

        log.Printf("Attempt %d/%d failed: %v, retrying in %v",
            attempt+1, config.MaxAttempts, lastErr, totalDelay)

        // Sleep with context awareness
        select {
        case <-ctx.Done():
            return fmt.Errorf("retry cancelled: %w", ctx.Err())
        case <-time.After(totalDelay):
            // Continue to next attempt
        }
    }

    return fmt.Errorf("operation failed after %d attempts: %w",
        config.MaxAttempts, lastErr)
}

func isRetriable(err error) bool {
    // Network errors are retriable
    var netErr net.Error
    if errors.As(err, &netErr) && netErr.Temporary() {
        return true
    }

    // Timeout errors are retriable
    if errors.Is(err, context.DeadlineExceeded) {
        return true
    }

    // Application-specific retriable errors
    var retriableErr *RetriableError
    return errors.As(err, &retriableErr)
}

type RetriableError struct {
    Message string
    Cause   error
}

func (e *RetriableError) Error() string {
    return e.Message
}

func (e *RetriableError) Unwrap() error {
    return e.Cause
}

// Usage example
func fetchUserWithRetry(ctx context.Context, userID string) (*User, error) {
    var user *User

    err := RetryWithBackoff(ctx, RetryConfig{
        MaxAttempts: 3,
        BaseDelay:   100 * time.Millisecond,
        MaxDelay:    5 * time.Second,
    }, func() error {
        var err error
        user, err = userAPI.Get(userID)
        return err
    })

    return user, err
}
```

### Key Takeaway
Implement retry logic with exponential backoff and jitter for transient failures. Only retry retriable errors (network issues, timeouts, 5xx). Never retry client errors (4xx) or operations without idempotency. Consider circuit breakers to prevent cascading failures.

---

## 6. Shutdown Issues

### Description
Improper shutdown sequences can leave resources in inconsistent states, cause deadlocks, or lose in-flight work. Systems must gracefully drain work and release resources in the correct order.

### Bad Examples

**Java - Incomplete Shutdown**
```java
public class DataProcessor {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);
    private final BlockingQueue<Task> queue = new LinkedBlockingQueue<>();

    public void shutdown() {
        executor.shutdown();  // Doesn't wait for tasks to complete
        // Queue not drained - pending tasks lost
    }
}
```

**Python - Deadlock During Shutdown**
```python
class WorkerPool:
    def __init__(self):
        self.lock = threading.Lock()
        self.workers = []
        self.running = True

    def shutdown(self):
        with self.lock:  # Acquires lock
            self.running = False
            for worker in self.workers:
                worker.join()  # Worker might be waiting for lock - deadlock!
```

**TypeScript - No Graceful Drain**
```typescript
class HTTPServer {
    private server: http.Server;

    shutdown() {
        this.server.close();  // Immediately closes, killing active requests
        process.exit(0);      // No time for cleanup
    }
}
```

**Go - Thread Pool Not Terminated**
```go
type Worker struct {
    jobs    chan Job
    workers int
    wg      sync.WaitGroup
}

func (w *Worker) Shutdown() {
    close(w.jobs)  // Closes channel but doesn't wait for workers
    // Workers might still be processing - resources leaked
}
```

### Good Examples

**Java - Proper Shutdown Sequence**
```java
public class DataProcessor implements AutoCloseable {
    private final ExecutorService executor = Executors.newFixedThreadPool(10);
    private final BlockingQueue<Task> queue = new LinkedBlockingQueue<>();
    private volatile boolean shutdown = false;

    @Override
    public void close() {
        shutdown = true;

        // 1. Stop accepting new work
        queue.clear();

        // 2. Initiate graceful shutdown
        executor.shutdown();

        try {
            // 3. Wait for existing tasks (with timeout)
            if (!executor.awaitTermination(30, TimeUnit.SECONDS)) {
                log.warn("Executor didn't terminate gracefully, forcing shutdown");

                // 4. Force shutdown remaining tasks
                List<Runnable> unfinished = executor.shutdownNow();
                log.error("Forced shutdown, {} tasks not completed", unfinished.size());

                // 5. Wait a bit more for forced termination
                if (!executor.awaitTermination(10, TimeUnit.SECONDS)) {
                    log.error("Executor did not terminate after forced shutdown");
                }
            }
        } catch (InterruptedException e) {
            log.error("Shutdown interrupted", e);
            executor.shutdownNow();
            Thread.currentThread().interrupt();
        }

        log.info("DataProcessor shutdown complete");
    }
}
```

**Python - Deadlock-Free Shutdown**
```python
import threading
import logging
from typing import List

class WorkerPool:
    def __init__(self, num_workers: int):
        self.lock = threading.Lock()
        self.workers: List[threading.Thread] = []
        self.running = True
        self.shutdown_event = threading.Event()

        for i in range(num_workers):
            worker = threading.Thread(target=self._worker_loop, args=(i,))
            worker.start()
            self.workers.append(worker)

    def _worker_loop(self, worker_id: int):
        while not self.shutdown_event.is_set():
            try:
                # Do work (check shutdown_event periodically)
                self._do_work(worker_id)
            except Exception as e:
                logging.error(f"Worker {worker_id} error: {e}")

    def shutdown(self, timeout: float = 30.0):
        """
        Graceful shutdown without deadlocks.
        """
        # 1. Signal all workers to stop (no lock needed)
        self.shutdown_event.set()

        # 2. Wait for all workers to finish
        for i, worker in enumerate(self.workers):
            worker.join(timeout=timeout)
            if worker.is_alive():
                logging.warning(f"Worker {i} did not stop within {timeout}s")

        # 3. Clear worker list (now safe to acquire lock)
        with self.lock:
            self.workers.clear()

        logging.info("WorkerPool shutdown complete")

    def _do_work(self, worker_id: int):
        # Simulated work with shutdown checks
        if self.shutdown_event.wait(timeout=0.1):  # Check every 100ms
            return
        # Do actual work here
```

**TypeScript - Graceful HTTP Server Shutdown**
```typescript
import http from 'http';
import { promisify } from 'util';

class GracefulHTTPServer {
    private server: http.Server;
    private connections = new Set<net.Socket>();
    private isShuttingDown = false;

    constructor(private app: express.Application) {
        this.server = http.createServer(app);

        // Track all connections
        this.server.on('connection', (conn) => {
            this.connections.add(conn);
            conn.on('close', () => {
                this.connections.delete(conn);
            });
        });

        // Reject new requests during shutdown
        this.app.use((req, res, next) => {
            if (this.isShuttingDown) {
                res.setHeader('Connection', 'close');
                res.status(503).send('Server is shutting down');
            } else {
                next();
            }
        });
    }

    listen(port: number): Promise<void> {
        return new Promise((resolve) => {
            this.server.listen(port, () => {
                console.log(`Server listening on port ${port}`);
                resolve();
            });
        });
    }

    async shutdown(timeoutMs: number = 30000): Promise<void> {
        console.log('Starting graceful shutdown...');
        this.isShuttingDown = true;

        // 1. Stop accepting new connections
        await promisify(this.server.close.bind(this.server))();

        // 2. Wait for existing requests to complete (with timeout)
        const shutdownPromise = new Promise<void>((resolve) => {
            const checkInterval = setInterval(() => {
                if (this.connections.size === 0) {
                    clearInterval(checkInterval);
                    resolve();
                }
            }, 100);
        });

        const timeoutPromise = new Promise<void>((resolve) => {
            setTimeout(() => {
                console.warn(
                    `Shutdown timeout reached, ${this.connections.size} ` +
                    `connections still active`
                );
                resolve();
            }, timeoutMs);
        });

        await Promise.race([shutdownPromise, timeoutPromise]);

        // 3. Force close remaining connections
        for (const conn of this.connections) {
            conn.destroy();
        }

        console.log('Server shutdown complete');
    }
}

// Usage with signal handling
const server = new GracefulHTTPServer(app);
await server.listen(3000);

let isShuttingDown = false;

async function handleShutdown(signal: string) {
    if (isShuttingDown) {
        console.log('Force shutdown');
        process.exit(1);
    }

    isShuttingDown = true;
    console.log(`Received ${signal}, starting graceful shutdown`);

    try {
        await server.shutdown(30000);
        await db.close();
        console.log('Cleanup complete');
        process.exit(0);
    } catch (error) {
        console.error('Error during shutdown:', error);
        process.exit(1);
    }
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));
```

**Go - Complete Worker Shutdown**
```go
type Worker struct {
    jobs       chan Job
    numWorkers int
    wg         sync.WaitGroup
    shutdown   chan struct{}
    once       sync.Once
}

func NewWorker(numWorkers int) *Worker {
    w := &Worker{
        jobs:       make(chan Job, 100),
        numWorkers: numWorkers,
        shutdown:   make(chan struct{}),
    }

    // Start workers
    for i := 0; i < numWorkers; i++ {
        w.wg.Add(1)
        go w.worker(i)
    }

    return w
}

func (w *Worker) worker(id int) {
    defer w.wg.Done()

    for {
        select {
        case job, ok := <-w.jobs:
            if !ok {
                log.Printf("Worker %d: job channel closed, exiting", id)
                return
            }

            // Process job
            if err := job.Execute(); err != nil {
                log.Printf("Worker %d: job failed: %v", id, err)
            }

        case <-w.shutdown:
            log.Printf("Worker %d: shutdown signal received, draining jobs", id)
            // Drain remaining jobs
            for job := range w.jobs {
                if err := job.Execute(); err != nil {
                    log.Printf("Worker %d: job failed during drain: %v", id, err)
                }
            }
            return
        }
    }
}

func (w *Worker) Submit(job Job) error {
    select {
    case <-w.shutdown:
        return errors.New("worker pool is shutting down")
    case w.jobs <- job:
        return nil
    }
}

func (w *Worker) Shutdown(ctx context.Context) error {
    // Ensure shutdown only happens once
    w.once.Do(func() {
        log.Println("Initiating worker pool shutdown")

        // 1. Signal workers to start draining
        close(w.shutdown)

        // 2. Stop accepting new jobs
        close(w.jobs)
    })

    // 3. Wait for all workers to finish (with context timeout)
    done := make(chan struct{})
    go func() {
        w.wg.Wait()
        close(done)
    }()

    select {
    case <-done:
        log.Println("All workers stopped gracefully")
        return nil
    case <-ctx.Done():
        return fmt.Errorf("shutdown timeout: %w", ctx.Err())
    }
}

// Usage example
func main() {
    worker := NewWorker(5)

    // Submit jobs
    for i := 0; i < 100; i++ {
        job := Job{ID: i}
        if err := worker.Submit(job); err != nil {
            log.Printf("Failed to submit job: %v", err)
        }
    }

    // Graceful shutdown with timeout
    shutdownCtx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
    defer cancel()

    if err := worker.Shutdown(shutdownCtx); err != nil {
        log.Printf("Shutdown error: %v", err)
        os.Exit(1)
    }

    log.Println("Clean shutdown complete")
}
```

### Key Takeaway
Implement graceful shutdown in the correct order: stop accepting new work, drain existing work with timeout, force terminate remaining tasks if needed, and wait for all resources to be released. Handle shutdown signals properly and avoid deadlocks by not holding locks during waits.

---

## 7. Error in Error Handler

### Description
Exception handlers that themselves throw exceptions can create recursive error loops, make problems worse, or completely crash the application. Error handling code must be bulletproof.

### Bad Examples

**Java - Exception Handler Throws**
```java
public void processMessage(Message msg) {
    try {
        handleMessage(msg);
    } catch (Exception e) {
        // This can throw IOException, crashing the handler
        logToFile("Error: " + e.getMessage());
        throw new RuntimeException("Processing failed", e);
    }
}
```

**Python - Recursive Error Loop**
```python
def process_request(request):
    try:
        return handle_request(request)
    except Exception as e:
        # error_handler might throw, causing infinite recursion
        return error_handler(request, e)

def error_handler(request, error):
    # This might fail and call error_handler again
    log_to_database(error)
    return process_request(request)  # Recursive call
```

**TypeScript - Logging Failure Crashes**
```typescript
async function executeTask(task: Task) {
    try {
        await task.execute();
    } catch (error) {
        // Network failure in logging crashes the entire handler
        await logger.logToRemote(error);
        throw new Error("Task failed");
    }
}
```

**Go - Panic in Defer**
```go
func processData(data []byte) error {
    defer func() {
        if r := recover(); r != nil {
            // This can panic if formatting fails
            log.Fatal(fmt.Sprintf("Panic: %v", r))
        }
    }()

    return process(data)
}
```

### Good Examples

**Java - Defensive Error Handling**
```java
public void processMessage(Message msg) {
    try {
        handleMessage(msg);
    } catch (Exception e) {
        // Error handling that cannot fail
        try {
            log.error("Message processing failed: {}", msg.getId(), e);
            metrics.incrementErrorCount("message_processing");
        } catch (Exception logError) {
            // Last resort: system error stream
            System.err.println("CRITICAL: Error handler failed: " + logError.getMessage());
            System.err.println("Original error: " + e.getMessage());
            e.printStackTrace(System.err);
        }

        throw new RuntimeException("Processing failed", e);
    }
}
```

**Python - Break Recursion**
```python
def process_request(request, is_retry=False):
    try:
        return handle_request(request)
    except Exception as e:
        if is_retry:
            # Already in error handler, don't recurse
            logger.error(f"Error handler failed: {e}", exc_info=True)
            return {"error": "Internal server error"}

        return error_handler(request, e)

def error_handler(request, error):
    """
    Error handler that doesn't recurse and handles its own failures.
    """
    try:
        # Try to log to database
        log_to_database(error)
    except Exception as log_error:
        # Logging failed, use fallback
        try:
            logger.error(f"Database logging failed: {log_error}", exc_info=True)
        except Exception:
            # Even fallback logging failed, nothing we can do
            pass

    # Return error response (don't recurse)
    return {
        "error": "Request processing failed",
        "request_id": request.id,
        "message": str(error)
    }
```

**TypeScript - Fallback Error Handling**
```typescript
interface ErrorHandlingStrategy {
    primary: (error: Error) => Promise<void>;
    fallback: (error: Error) => void;
    lastResort: (error: Error) => void;
}

async function executeTask(task: Task) {
    try {
        await task.execute();
    } catch (error) {
        await handleErrorSafely(error, {
            primary: async (err) => {
                // Try remote logging first
                await logger.logToRemote(err);
            },
            fallback: (err) => {
                // Remote failed, use local logging
                console.error('Task execution failed:', err);
                fs.appendFileSync('/var/log/app.log',
                    `${new Date().toISOString()} ERROR: ${err.message}\n`
                );
            },
            lastResort: (err) => {
                // Everything failed, at least log to console
                console.error('CRITICAL: All error handlers failed');
                console.error('Original error:', err);
            }
        });

        throw new Error(`Task ${task.id} failed`);
    }
}

async function handleErrorSafely(
    error: Error,
    strategy: ErrorHandlingStrategy
): Promise<void> {
    try {
        await strategy.primary(error);
    } catch (primaryError) {
        try {
            strategy.fallback(error);
        } catch (fallbackError) {
            try {
                strategy.lastResort(error);
            } catch (lastResortError) {
                // Absolutely nothing worked - give up gracefully
                // Don't throw or crash here
            }
        }
    }
}
```

**Go - Panic Recovery with Safeguards**
```go
func processData(data []byte) (err error) {
    // Recover from panics, but don't panic in recovery
    defer func() {
        if r := recover(); r != nil {
            // Build error message safely
            var panicErr error
            switch x := r.(type) {
            case string:
                panicErr = errors.New(x)
            case error:
                panicErr = x
            default:
                panicErr = fmt.Errorf("unknown panic: %v", r)
            }

            // Log without panicking
            safeLog(fmt.Sprintf("Recovered from panic: %v", panicErr))

            // Set named return value
            err = fmt.Errorf("panic during processing: %w", panicErr)
        }
    }()

    return process(data)
}

func safeLog(message string) {
    // Multi-level fallback logging that never panics
    defer func() {
        if r := recover(); r != nil {
            // Even logging failed, write to stderr
            fmt.Fprintf(os.Stderr, "CRITICAL: Logging failed: %v\n", r)
            fmt.Fprintf(os.Stderr, "Original message: %s\n", message)
        }
    }()

    // Try normal logging
    if logger != nil {
        logger.Error(message)
    } else {
        // Fallback to stderr
        fmt.Fprintf(os.Stderr, "ERROR: %s\n", message)
    }
}

// Example: HTTP handler with safe error handling
func handleRequest(w http.ResponseWriter, r *http.Request) {
    defer func() {
        if r := recover(); r != nil {
            // Recover from panic without panicking
            safeLog(fmt.Sprintf("Handler panic: %v", r))

            // Try to send error response
            safeWriteError(w, http.StatusInternalServerError, "Internal server error")
        }
    }()

    // Handle request...
}

func safeWriteError(w http.ResponseWriter, code int, message string) {
    defer func() {
        if r := recover(); r != nil {
            // Even writing error response failed
            safeLog(fmt.Sprintf("Failed to write error response: %v", r))
        }
    }()

    w.WriteHeader(code)
    w.Write([]byte(message))
}
```

### Key Takeaway
Error handlers must never throw exceptions themselves. Use multiple layers of fallback error handling (remote logging -> local logging -> stderr). Break potential recursion loops by tracking whether you're already in an error handler. Make panic recovery and logging bulletproof.

---

## 8. Wrong Error Classification

### Description
Incorrectly classifying errors leads to retrying operations that will never succeed, giving up on recoverable failures, or returning misleading error codes to clients.

### Bad Examples

**Java - Fatal Error Retried**
```java
public User createUser(UserRequest request) {
    int retries = 3;
    for (int i = 0; i < retries; i++) {
        try {
            return userService.create(request);
        } catch (ValidationException e) {
            // WRONG: Validation errors won't be fixed by retrying
            log.warn("User creation failed, retrying...", e);
            Thread.sleep(1000);
        }
    }
    throw new ServiceException("Failed to create user");
}
```

**Python - Retriable Error Treated as Fatal**
```python
def fetch_user_data(user_id):
    try:
        response = api_client.get(f'/users/{user_id}')
        return response.json()
    except requests.ConnectionError as e:
        # WRONG: Network errors are transient, should retry
        raise UserNotFoundError(f"User {user_id} does not exist") from e
```

**TypeScript - Wrong HTTP Status Code**
```typescript
app.post('/api/orders', async (req, res) => {
    try {
        const order = await orderService.create(req.body);
        res.json(order);
    } catch (error) {
        // WRONG: Returns 500 for all errors, including validation
        res.status(500).json({ error: error.message });
    }
});
```

**Go - Not Distinguishing Error Types**
```go
func processPayment(ctx context.Context, amount int) error {
    err := paymentGateway.Charge(ctx, amount)
    if err != nil {
        // WRONG: All errors treated the same
        return fmt.Errorf("payment failed: %w", err)
    }
    return nil
}
```

### Good Examples

**Java - Proper Error Classification**
```java
public enum ErrorType {
    RETRIABLE,    // Can retry (network issues, rate limits)
    FATAL,        // Don't retry (validation, auth failures)
    INDEFINITE    // Unknown outcome (timeout)
}

public class ErrorClassifier {
    public static ErrorType classify(Exception e) {
        // Validation and auth errors are fatal
        if (e instanceof ValidationException ||
            e instanceof AuthenticationException) {
            return ErrorType.FATAL;
        }

        // Timeouts are indefinite
        if (e instanceof TimeoutException) {
            return ErrorType.INDEFINITE;
        }

        // Network and rate limit errors are retriable
        if (e instanceof IOException ||
            e instanceof RateLimitException) {
            return ErrorType.RETRIABLE;
        }

        // HTTP errors
        if (e instanceof HttpException) {
            int status = ((HttpException) e).getStatusCode();
            if (status >= 400 && status < 500) {
                return ErrorType.FATAL;  // Client errors
            }
            if (status >= 500) {
                return ErrorType.RETRIABLE;  // Server errors
            }
        }

        // Unknown errors treated as retriable by default
        return ErrorType.RETRIABLE;
    }
}

public User createUser(UserRequest request) {
    int maxRetries = 3;

    for (int attempt = 0; attempt < maxRetries; attempt++) {
        try {
            return userService.create(request);
        } catch (Exception e) {
            ErrorType errorType = ErrorClassifier.classify(e);

            switch (errorType) {
                case FATAL:
                    log.error("User creation failed with fatal error: {}",
                             e.getMessage(), e);
                    throw new ServiceException("Invalid user request", e);

                case INDEFINITE:
                    log.warn("User creation timeout, checking status...");
                    // Check if user was created
                    User existing = userService.findByEmail(request.getEmail());
                    if (existing != null) {
                        return existing;
                    }
                    // Fall through to retry

                case RETRIABLE:
                    if (attempt == maxRetries - 1) {
                        throw new ServiceException("User creation failed after retries", e);
                    }
                    log.warn("User creation failed (attempt {}/{}), retrying: {}",
                            attempt + 1, maxRetries, e.getMessage());
                    exponentialBackoff(attempt);
                    break;
            }
        }
    }

    throw new ServiceException("Unreachable");
}
```

**Python - Error Classification with Retry Logic**
```python
from enum import Enum
from typing import Type, Tuple
import requests

class ErrorType(Enum):
    RETRIABLE = "retriable"
    FATAL = "fatal"
    INDEFINITE = "indefinite"

class ErrorClassification:
    """
    Classifies errors for proper handling and retry logic.
    """

    RETRIABLE_EXCEPTIONS = (
        requests.ConnectionError,
        requests.Timeout,
        requests.exceptions.ChunkedEncodingError,
    )

    RETRIABLE_STATUS_CODES = {408, 429, 500, 502, 503, 504}
    FATAL_STATUS_CODES = {400, 401, 403, 404, 422}

    @classmethod
    def classify(cls, error: Exception) -> ErrorType:
        """Classify an error for retry logic."""

        # Network errors are retriable
        if isinstance(error, cls.RETRIABLE_EXCEPTIONS):
            return ErrorType.RETRIABLE

        # HTTP errors classified by status code
        if isinstance(error, requests.HTTPError):
            status = error.response.status_code

            if status in cls.FATAL_STATUS_CODES:
                return ErrorType.FATAL

            if status in cls.RETRIABLE_STATUS_CODES:
                return ErrorType.RETRIABLE

            # 5xx errors are generally retriable
            if 500 <= status < 600:
                return ErrorType.RETRIABLE

        # Timeout is indefinite
        if isinstance(error, TimeoutError):
            return ErrorType.INDEFINITE

        # Application-specific errors
        if hasattr(error, 'error_type'):
            return error.error_type

        # Default to retriable for unknown errors
        return ErrorType.RETRIABLE

def fetch_user_data(user_id: str, max_retries: int = 3):
    """
    Fetch user data with intelligent retry logic.
    """
    for attempt in range(max_retries):
        try:
            response = api_client.get(
                f'/users/{user_id}',
                timeout=5.0
            )
            response.raise_for_status()
            return response.json()

        except Exception as e:
            error_type = ErrorClassification.classify(e)

            if error_type == ErrorType.FATAL:
                logger.error(f"Fatal error fetching user {user_id}: {e}")
                raise UserNotFoundError(
                    f"User {user_id} not found or invalid request"
                ) from e

            elif error_type == ErrorType.INDEFINITE:
                logger.warning(f"Indefinite error for user {user_id}, checking...")
                # Could check cache or alternate data source
                raise UserFetchIndefiniteError(
                    f"Unable to confirm fetch status for user {user_id}"
                ) from e

            elif error_type == ErrorType.RETRIABLE:
                if attempt == max_retries - 1:
                    logger.error(
                        f"Failed to fetch user {user_id} after {max_retries} attempts"
                    )
                    raise UserFetchError(
                        f"User service unavailable for {user_id}"
                    ) from e

                backoff = (2 ** attempt) * 0.1
                logger.warning(
                    f"Retriable error fetching user {user_id} "
                    f"(attempt {attempt + 1}/{max_retries}), "
                    f"retrying in {backoff}s: {e}"
                )
                time.sleep(backoff)

    raise UserFetchError(f"Unreachable code")
```

**TypeScript - Proper HTTP Status Codes**
```typescript
enum ErrorCategory {
    VALIDATION = 'validation',
    AUTHENTICATION = 'authentication',
    AUTHORIZATION = 'authorization',
    NOT_FOUND = 'not_found',
    CONFLICT = 'conflict',
    RATE_LIMIT = 'rate_limit',
    INTERNAL = 'internal',
    SERVICE_UNAVAILABLE = 'service_unavailable',
}

class AppError extends Error {
    constructor(
        message: string,
        public category: ErrorCategory,
        public statusCode: number,
        public isRetriable: boolean = false,
        public cause?: Error
    ) {
        super(message);
        this.name = this.constructor.name;
    }
}

// Error class hierarchy
class ValidationError extends AppError {
    constructor(message: string, cause?: Error) {
        super(message, ErrorCategory.VALIDATION, 400, false, cause);
    }
}

class AuthenticationError extends AppError {
    constructor(message: string, cause?: Error) {
        super(message, ErrorCategory.AUTHENTICATION, 401, false, cause);
    }
}

class NotFoundError extends AppError {
    constructor(message: string, cause?: Error) {
        super(message, ErrorCategory.NOT_FOUND, 404, false, cause);
    }
}

class RateLimitError extends AppError {
    constructor(message: string, retryAfter?: number, cause?: Error) {
        super(message, ErrorCategory.RATE_LIMIT, 429, true, cause);
    }
}

class ServiceUnavailableError extends AppError {
    constructor(message: string, cause?: Error) {
        super(message, ErrorCategory.SERVICE_UNAVAILABLE, 503, true, cause);
    }
}

// Middleware for proper error handling
app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
    if (error instanceof AppError) {
        // Properly classified application error
        logger.error(`${error.category}: ${error.message}`, {
            statusCode: error.statusCode,
            retriable: error.isRetriable,
            cause: error.cause,
            path: req.path,
        });

        res.status(error.statusCode).json({
            error: {
                message: error.message,
                category: error.category,
                retriable: error.isRetriable,
            }
        });
    } else {
        // Unclassified error - treat as internal server error
        logger.error('Unhandled error:', error);

        res.status(500).json({
            error: {
                message: 'Internal server error',
                category: ErrorCategory.INTERNAL,
                retriable: false,
            }
        });
    }
});

// Example route with proper error classification
app.post('/api/orders', async (req, res, next) => {
    try {
        // Validate request
        const validation = validateOrderRequest(req.body);
        if (!validation.valid) {
            throw new ValidationError(`Invalid order: ${validation.error}`);
        }

        // Check user authentication
        const user = await authenticateUser(req.headers.authorization);
        if (!user) {
            throw new AuthenticationError('Invalid or missing authentication token');
        }

        // Create order
        const order = await orderService.create(req.body);
        res.status(201).json(order);

    } catch (error) {
        // Classify external errors
        if (error instanceof DatabaseError) {
            next(new ServiceUnavailableError('Database temporarily unavailable', error));
        } else if (error instanceof NetworkError) {
            next(new ServiceUnavailableError('External service unavailable', error));
        } else {
            next(error);
        }
    }
});
```

**Go - Comprehensive Error Classification**
```go
package main

import (
    "errors"
    "fmt"
    "net/http"
)

// ErrorType defines error classification
type ErrorType int

const (
    ErrorTypeRetriable ErrorType = iota  // Can safely retry
    ErrorTypeFatal                       // Don't retry
    ErrorTypeIndefinite                  // Unknown outcome
)

// AppError wraps errors with classification
type AppError struct {
    Message    string
    Type       ErrorType
    StatusCode int
    Cause      error
}

func (e *AppError) Error() string {
    if e.Cause != nil {
        return fmt.Sprintf("%s: %v", e.Message, e.Cause)
    }
    return e.Message
}

func (e *AppError) Unwrap() error {
    return e.Cause
}

// Specific error types
type ValidationError struct {
    Field   string
    Message string
}

func (e *ValidationError) Error() string {
    return fmt.Sprintf("validation error on field '%s': %s", e.Field, e.Message)
}

type NotFoundError struct {
    Resource string
    ID       string
}

func (e *NotFoundError) Error() string {
    return fmt.Sprintf("%s with ID '%s' not found", e.Resource, e.ID)
}

type RateLimitError struct {
    RetryAfter int // seconds
}

func (e *RateLimitError) Error() string {
    return fmt.Sprintf("rate limit exceeded, retry after %d seconds", e.RetryAfter)
}

// ClassifyError determines how to handle an error
func ClassifyError(err error) *AppError {
    if err == nil {
        return nil
    }

    // Check specific error types
    var validationErr *ValidationError
    if errors.As(err, &validationErr) {
        return &AppError{
            Message:    validationErr.Error(),
            Type:       ErrorTypeFatal,
            StatusCode: http.StatusBadRequest,
            Cause:      err,
        }
    }

    var notFoundErr *NotFoundError
    if errors.As(err, &notFoundErr) {
        return &AppError{
            Message:    notFoundErr.Error(),
            Type:       ErrorTypeFatal,
            StatusCode: http.StatusNotFound,
            Cause:      err,
        }
    }

    var rateLimitErr *RateLimitError
    if errors.As(err, &rateLimitErr) {
        return &AppError{
            Message:    rateLimitErr.Error(),
            Type:       ErrorTypeRetriable,
            StatusCode: http.StatusTooManyRequests,
            Cause:      err,
        }
    }

    // Check standard errors
    if errors.Is(err, context.DeadlineExceeded) {
        return &AppError{
            Message:    "Request timeout",
            Type:       ErrorTypeIndefinite,
            StatusCode: http.StatusGatewayTimeout,
            Cause:      err,
        }
    }

    if errors.Is(err, context.Canceled) {
        return &AppError{
            Message:    "Request canceled",
            Type:       ErrorTypeFatal,
            StatusCode: 499, // Client closed request
            Cause:      err,
        }
    }

    // Network errors are retriable
    var netErr net.Error
    if errors.As(err, &netErr) {
        return &AppError{
            Message:    "Network error",
            Type:       ErrorTypeRetriable,
            StatusCode: http.StatusServiceUnavailable,
            Cause:      err,
        }
    }

    // Default: internal server error, retriable
    return &AppError{
        Message:    "Internal server error",
        Type:       ErrorTypeRetriable,
        StatusCode: http.StatusInternalServerError,
        Cause:      err,
    }
}

// ProcessPayment with proper error classification
func ProcessPayment(ctx context.Context, amount int) error {
    const maxRetries = 3

    for attempt := 0; attempt < maxRetries; attempt++ {
        err := paymentGateway.Charge(ctx, amount)
        if err == nil {
            return nil // Success
        }

        appErr := ClassifyError(err)

        switch appErr.Type {
        case ErrorTypeFatal:
            // Don't retry - log and return immediately
            log.Printf("Payment failed with fatal error: %v", appErr)
            return fmt.Errorf("payment failed: %w", err)

        case ErrorTypeIndefinite:
            // Check payment status before retrying
            log.Printf("Payment timeout, verifying status...")
            status, checkErr := paymentGateway.GetStatus(ctx)
            if checkErr != nil {
                log.Printf("Status check failed: %v", checkErr)
                return fmt.Errorf("payment status unknown: %w", err)
            }

            if status == "succeeded" {
                return nil // Already succeeded
            }

            if status == "failed" {
                return fmt.Errorf("payment failed: %w", err)
            }

            // Status still pending, retry
            fallthrough

        case ErrorTypeRetriable:
            if attempt == maxRetries-1 {
                log.Printf("Payment failed after %d attempts", maxRetries)
                return fmt.Errorf("payment failed after retries: %w", err)
            }

            backoff := time.Duration(1<<uint(attempt)) * 100 * time.Millisecond
            log.Printf("Payment failed (attempt %d/%d), retrying in %v: %v",
                attempt+1, maxRetries, backoff, appErr)

            select {
            case <-time.After(backoff):
                continue
            case <-ctx.Done():
                return fmt.Errorf("payment retry canceled: %w", ctx.Err())
            }
        }
    }

    return errors.New("unreachable")
}

// HTTP handler with proper error responses
func handleCreateOrder(w http.ResponseWriter, r *http.Request) {
    var req OrderRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        appErr := &AppError{
            Message:    "Invalid request body",
            Type:       ErrorTypeFatal,
            StatusCode: http.StatusBadRequest,
            Cause:      err,
        }
        writeErrorResponse(w, appErr)
        return
    }

    order, err := orderService.Create(r.Context(), req)
    if err != nil {
        appErr := ClassifyError(err)
        writeErrorResponse(w, appErr)
        return
    }

    w.WriteHeader(http.StatusCreated)
    json.NewEncoder(w).Encode(order)
}

func writeErrorResponse(w http.ResponseWriter, appErr *AppError) {
    w.Header().Set("Content-Type", "application/json")
    w.WriteHeader(appErr.StatusCode)

    response := map[string]interface{}{
        "error": map[string]interface{}{
            "message":   appErr.Message,
            "retriable": appErr.Type == ErrorTypeRetriable,
        },
    }

    json.NewEncoder(w).Encode(response)
}
```

### Key Takeaway
Always classify errors into retriable (network issues, rate limits, 5xx), fatal (validation, auth, 4xx), and indefinite (timeouts). Only retry retriable errors. Return appropriate HTTP status codes. Use status verification for indefinite errors before retrying.

---

## Summary

Proper error handling in distributed systems requires:

1. **Never swallow exceptions** - Always log with context and propagate or handle meaningfully
2. **Always release resources** - Use try-finally, defer, context managers, try-with-resources
3. **Implement complete cleanup** - Handle exceptions in finally blocks, clean up in reverse order
4. **Distinguish indefinite from definite errors** - Use idempotency and status checks for timeouts
5. **Retry smartly** - Exponential backoff with jitter, only retry retriable errors
6. **Shutdown gracefully** - Stop accepting work, drain existing work, terminate with timeout
7. **Error handlers must be bulletproof** - Use fallback logging, never throw in handlers
8. **Classify errors correctly** - Fatal vs retriable vs indefinite, proper HTTP status codes

These patterns prevent data loss, resource leaks, cascading failures, and system instability in distributed systems.
