# Database Connection Pool Patterns

Connection pooling is critical for application performance and reliability. This guide documents common anti-patterns and best practices for managing database connection pools effectively.

## Pattern 1: Connection Leak - Forgetting to Close Resources

**Description:** Acquiring database connections, statements, or result sets without properly closing them causes connection pool exhaustion. This is the most common cause of connection pool issues.

**Bad Code Example (Java):**
```java
public User findUser(String id) {
    Connection conn = dataSource.getConnection();
    PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?");
    ps.setString(1, id);
    ResultSet rs = ps.executeQuery();
    if (rs.next()) {
        return new User(rs.getString("id"), rs.getString("name"));
    }
    return null;
    // Connection, PreparedStatement, and ResultSet never closed
    // Exception paths leave resources open
}
```

**Bad Code Example (Go):**
```go
func getUsers() error {
    rows, err := db.Query("SELECT id, name FROM users")
    // Missing rows.Close() - connection remains held
    if err != nil {
        return err
    }
    // Process rows...
    return nil
}
```

**Good Code Example (Java):**
```java
public User findUser(String id) {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement("SELECT * FROM users WHERE id = ?")) {

        ps.setString(1, id);

        try (ResultSet rs = ps.executeQuery()) {
            if (rs.next()) {
                return new User(rs.getString("id"), rs.getString("name"));
            }
            return null;
        }
    } catch (SQLException e) {
        throw new DataAccessException("Error finding user", e);
    }
}
```

**Good Code Example (Go):**
```go
func getUsers() error {
    rows, err := db.Query("SELECT id, name FROM users")
    if err != nil {
        return err
    }
    defer rows.Close() // Ensures cleanup even on error

    // Process rows...
    return nil
}
```

**Key Takeaway:** Always use try-with-resources (Java) or defer (Go) to guarantee resource cleanup. Every connection, statement, and result set must be explicitly closed.

---

## Pattern 2: Unlimited or Arbitrary Pool Sizing

**Description:** Setting pool size to unlimited or choosing arbitrary numbers without measurement leads to either resource starvation or database saturation.

**Bad Code Example (Go):**
```go
// Dangerous: No connection limits
db.SetMaxOpenConns(0) // 0 = unlimited connections

// Arbitrary: Based on guesswork
db.SetMaxOpenConns(100) // "100 sounds like a good number"
db.SetMaxIdleConns(100)
```

**Good Code Example (Go):**
```go
// Calculated based on: (CPU cores × 2) + effective I/O threads
// Example for 4-core system with moderate I/O
db.SetMaxOpenConns(100)               // Determined by load testing
db.SetMaxIdleConns(20)                // 20-30% of MaxOpen
db.SetConnMaxLifetime(30*time.Minute) // Avoid long-lived connections
db.SetConnMaxIdleTime(5*time.Minute)  // Timely reclamation of idle connections
```

**Configuration Guidelines:**
- steady-pool-size = average concurrent connections during normal load
- max-pool-size = peak connections × 1.2 (with headroom)
- ideal-to-max ratio should maintain 30-70% utilization
- Monitor and adjust based on metrics, not guesses

**Key Takeaway:** Right-size pools based on actual measurements: CPU cores, I/O characteristics, and observed connection patterns under load. The formula (CPU cores × 2) + effective I/O threads is a starting point, not a rule.

---

## Pattern 3: Improper Transaction Handling

**Description:** Failing to rollback transactions on errors or not using deferred cleanup causes connections to remain locked with uncommitted state.

**Bad Code Example (Go):**
```go
func transferMoney(fromID, toID, amount int) error {
    tx, err := db.Begin()
    if err != nil {
        return err
    }

    // Perform operations...
    if err := deductAmount(tx, fromID, amount); err != nil {
        return err // Transaction never rolled back
    }

    if err := addAmount(tx, toID, amount); err != nil {
        return err // Transaction never rolled back
    }

    return tx.Commit()
}
```

**Good Code Example (Go):**
```go
func transferMoney(fromID, toID, amount int) error {
    tx, err := db.Begin()
    if err != nil {
        return fmt.Errorf("failed to begin transaction: %w", err)
    }

    // Ensure rollback on any error
    defer func() {
        if err != nil {
            if rbErr := tx.Rollback(); rbErr != nil {
                log.Printf("Error rolling back transaction: %v", rbErr)
            }
        }
    }()

    if err = deductAmount(tx, fromID, amount); err != nil {
        return err
    }

    if err = addAmount(tx, toID, amount); err != nil {
        return err
    }

    return tx.Commit()
}
```

**Key Takeaway:** Always use defer to ensure transactions are rolled back on error. Never leave transactions in an uncommitted state.

---

## Pattern 4: Missing Leak Detection Configuration

**Description:** Running without connection leak detection in development and production makes it impossible to identify and fix leaks before they cause outages.

**Bad Code Example (Configuration):**
```bash
# No leak detection enabled
# Leaks accumulate silently until pool exhaustion
```

**Good Code Example (Payara/GlassFish):**
```bash
# Development environment - aggressive detection
asadmin set resources.jdbc-connection-pool.test-pool.connection-leak-timeout-in-seconds=2
asadmin set resources.jdbc-connection-pool.test-pool.connection-leak-reclaim=true
asadmin set resources.jdbc-connection-pool.test-pool.statement-leak-timeout-in-seconds=1
asadmin set resources.jdbc-connection-pool.test-pool.statement-leak-reclaim=true

# Production environment - balanced detection
asadmin set resources.jdbc-connection-pool.prod-pool.connection-leak-timeout-in-seconds=30
asadmin set resources.jdbc-connection-pool.prod-pool.connection-leak-reclaim=true
asadmin set resources.jdbc-connection-pool.prod-pool.statement-leak-timeout-in-seconds=15
asadmin set resources.jdbc-connection-pool.prod-pool.statement-leak-reclaim=true

# Enable connection validation
asadmin set resources.jdbc-connection-pool.prod-pool.is-connection-validation-required=true
asadmin set resources.jdbc-connection-pool.prod-pool.validate-atmost-once-period-in-seconds=30
```

**Key Takeaway:** Enable leak detection and reclamation in all environments. Use aggressive timeouts in development to catch leaks early, and balanced timeouts in production to handle genuine slow queries.

---

## Pattern 5: Ignoring Connection State and Validation

**Description:** Returning connections to the pool without validation or ignoring errors leaves connections in polluted or broken states, causing cryptic failures.

**Bad Code Example (Go):**
```go
conn, _ := db.Conn(context.Background())
// Ignoring error - connection may be in bad state

// Perform operations that might pollute connection state
conn.ExecContext(ctx, "SET SESSION var = 'value'")

conn.Close() // Returns to pool with modified state
```

**Good Code Example (Configuration):**
```bash
# Validate connections before use
asadmin set resources.jdbc-connection-pool.prod-pool.is-connection-validation-required=true
asadmin set resources.jdbc-connection-pool.prod-pool.connection-validation-method=auto-commit
asadmin set resources.jdbc-connection-pool.prod-pool.validation-table-name=DUAL

# Limit connection lifetime to avoid stale connections
asadmin set resources.jdbc-connection-pool.prod-pool.max-connection-usage-count=1000
```

**Good Code Example (Go):**
```go
conn, err := db.Conn(context.Background())
if err != nil {
    return fmt.Errorf("failed to get connection: %w", err)
}
defer conn.Close()

// Use ping to validate connection health
if err := conn.PingContext(ctx); err != nil {
    return fmt.Errorf("connection validation failed: %w", err)
}

// Perform operations...
```

**Key Takeaway:** Always validate connections before use and handle errors properly. Configure connection lifetime limits to prevent stale connections from persisting in the pool.

---

## Pattern 6: Missing Timeouts and Lifecycle Management

**Description:** Without proper timeout configuration, applications hang indefinitely waiting for connections or holding connections longer than necessary.

**Bad Code Example:**
```go
// No timeouts configured
db.SetConnMaxLifetime(0) // Connections never expire
db.SetConnMaxIdleTime(0) // Idle connections never cleaned up
// No acquisition timeout - threads block forever
```

**Good Code Example (Go):**
```go
// Comprehensive lifecycle management
db.SetMaxOpenConns(100)
db.SetMaxIdleConns(20)
db.SetConnMaxLifetime(30 * time.Minute) // Recycle long-lived connections
db.SetConnMaxIdleTime(5 * time.Minute)  // Clean up idle connections

// Use context timeouts for operations
ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
defer cancel()

rows, err := db.QueryContext(ctx, "SELECT * FROM users")
if err != nil {
    return fmt.Errorf("query timeout: %w", err)
}
defer rows.Close()
```

**Key Takeaway:** Implement connection acquisition timeouts, idle timeouts, and max lifetime recycling to prevent stale connections and resource hoarding.

---

## Pattern 7: Not Reusing Prepared Statements

**Description:** Creating new prepared statements for every query wastes resources and prevents statement caching benefits.

**Bad Code Example (Java):**
```java
public void insertUsers(List<User> users) throws SQLException {
    try (Connection conn = dataSource.getConnection()) {
        for (User user : users) {
            // New PreparedStatement created for each user
            try (PreparedStatement ps = conn.prepareStatement(
                    "INSERT INTO users (id, name) VALUES (?, ?)")) {
                ps.setString(1, user.getId());
                ps.setString(2, user.getName());
                ps.executeUpdate();
            }
        }
    }
}
```

**Good Code Example (Java):**
```java
public void insertUsers(List<User> users) throws SQLException {
    try (Connection conn = dataSource.getConnection();
         PreparedStatement ps = conn.prepareStatement(
                 "INSERT INTO users (id, name) VALUES (?, ?)")) {

        for (User user : users) {
            ps.setString(1, user.getId());
            ps.setString(2, user.getName());
            ps.addBatch();
        }
        ps.executeBatch();
    }
}
```

**Good Code Example (Go with Transaction):**
```go
func bulkInsert(db *sql.DB, items []Item) error {
    tx, err := db.Begin()
    if err != nil {
        return err
    }
    defer func() {
        if err != nil {
            tx.Rollback()
        }
    }()

    stmt, err := tx.Prepare("INSERT INTO items (id, name) VALUES (?, ?)")
    if err != nil {
        return err
    }
    defer stmt.Close()

    for _, item := range items {
        if _, err = stmt.Exec(item.ID, item.Name); err != nil {
            return err
        }
    }

    return tx.Commit()
}
```

**Configuration (Payara/GlassFish):**
```bash
# Enable statement caching
asadmin set resources.jdbc-connection-pool.prod-pool.statement-cache-size=50
asadmin set resources.jdbc-connection-pool.prod-pool.statement-timeout-in-seconds=30
```

**Key Takeaway:** Reuse prepared statements within transactions and enable statement caching at the pool level. Use batch operations for bulk inserts/updates.

---

## Pattern 8: Cold Start Connection Storms

**Description:** Deploying multiple application instances simultaneously without pool warming creates connection storms that overwhelm the database.

**Bad Code Example:**
```go
func main() {
    // Database configured but not warmed
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        log.Fatal(err)
    }

    // First requests trigger connection surge
    startServer(db)
}
```

**Good Code Example (Go):**
```go
func warmUpPool(db *sql.DB, count int) error {
    var wg sync.WaitGroup
    ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
    defer cancel()

    for i := 0; i < count; i++ {
        wg.Add(1)
        go func() {
            defer wg.Done()
            if err := db.PingContext(ctx); err != nil {
                log.Printf("Pool warmup ping failed: %v", err)
            }
        }()
    }
    wg.Wait()
    return nil
}

func main() {
    db, err := sql.Open("postgres", dsn)
    if err != nil {
        log.Fatal(err)
    }

    // Configure pool
    db.SetMaxOpenConns(100)
    db.SetMaxIdleConns(20)

    // Warm up pool before accepting traffic
    log.Println("Warming up connection pool...")
    if err := warmUpPool(db, 20); err != nil {
        log.Printf("Warning: pool warmup had errors: %v", err)
    }

    startServer(db)
}
```

**Key Takeaway:** Pre-warm connection pools on startup and stagger deployment of multiple instances to prevent connection storms.

---

## Pattern 9: No Monitoring and Observability

**Description:** Tuning connection pools without monitoring metrics is guesswork. Silent failures and gradual degradation go unnoticed until outages occur.

**Bad Code Example:**
```go
// Pool configured but no metrics tracked
db.SetMaxOpenConns(50)
db.SetMaxIdleConns(10)
// No visibility into pool behavior
```

**Good Code Example (Go):**
```go
func monitorPoolHealth(db *sql.DB) {
    ticker := time.NewTicker(30 * time.Second)
    defer ticker.Stop()

    for range ticker.C {
        stats := db.Stats()

        // Track key metrics
        openConns := stats.OpenConnections
        inUse := stats.InUse
        idle := stats.Idle
        waitCount := stats.WaitCount
        waitDuration := stats.WaitDuration

        utilizationPct := float64(inUse) / float64(stats.MaxOpenConnections) * 100
        avgWaitTime := time.Duration(0)
        if waitCount > 0 {
            avgWaitTime = waitDuration / time.Duration(waitCount)
        }

        log.Printf("Pool stats: open=%d, in_use=%d, idle=%d, utilization=%.1f%%, wait_count=%d, avg_wait=%v",
            openConns, inUse, idle, utilizationPct, waitCount, avgWaitTime)

        // Alert on unhealthy conditions
        if utilizationPct > 80 {
            log.Printf("WARNING: High pool utilization: %.1f%%", utilizationPct)
        }
        if avgWaitTime > 100*time.Millisecond {
            log.Printf("WARNING: High wait time: %v", avgWaitTime)
        }
    }
}
```

**Healthy Metrics:**
- Connection wait time: < 100ms
- Pool utilization: 30-70%
- Wait count: Low and stable
- Error rate: < 0.1%

**Key Takeaway:** Use db.Stats() to monitor pool health continuously. Track connection wait times, utilization rates, and error counts. Adjust configuration based on observed metrics, not guesswork.

---

## Pattern 10: Using External Poolers Incorrectly

**Description:** For high-scale PostgreSQL deployments, using application-level pooling alone can be inefficient. External poolers like PgBouncer provide better connection reuse.

**Bad Code Example:**
```yaml
# Each of 20 app instances maintains separate pool
app-instances: 20
pool-size-per-instance: 50
# Total: 1000 connections to database - wasteful
```

**Good Code Example:**
```yaml
# Use PgBouncer in transaction pooling mode
# pgbouncer.ini
[databases]
mydb = host=db-server port=5432 dbname=production

[pgbouncer]
pool_mode = transaction        # Best balance for most apps
max_client_conn = 1000         # Total client connections
default_pool_size = 20         # Actual DB connections
reserve_pool_size = 5          # Emergency reserve
reserve_pool_timeout = 3       # Seconds

# Application configuration
# Each app instance connects to PgBouncer
app-instances: 20
pool-size-per-instance: 50     # Logical connections
# Actual DB connections: 20 (managed by PgBouncer)
```

**Key Takeaway:** For PostgreSQL at scale, use PgBouncer with transaction pooling mode. This dramatically reduces actual database connections while supporting many more application connections.

---

## Pattern 11: Query Inefficiency Hidden by Pool Tuning

**Description:** Attempting to solve slow queries by increasing pool size masks the real problem and creates database overload.

**Bad Code Example:**
```sql
-- N+1 query pattern holding connections for extended periods
SELECT * FROM orders WHERE user_id = ?
-- Followed by loop:
SELECT * FROM order_items WHERE order_id = ?
SELECT * FROM order_items WHERE order_id = ?
-- ... repeated for each order
```

**Response:** Increase pool size from 50 to 200 (wrong solution)

**Good Code Example:**
```sql
-- Fix the query first
SELECT
    o.*,
    oi.id as item_id,
    oi.product_id,
    oi.quantity
FROM orders o
LEFT JOIN order_items oi ON o.id = oi.order_id
WHERE o.user_id = ?
-- Single query, shorter connection hold time
```

**Response:** Optimize query, add indexes, reduce connection hold time (right solution)

**Key Takeaway:** Shorter query execution directly reduces connection hold time. Optimize queries, eliminate N+1 patterns, and shorten transactions before tuning pool size. Query efficiency has more leverage than pool configuration.

---

## Summary Checklist

Connection pool issues cause production outages. Use this checklist to avoid common pitfalls:

- [ ] Always close connections, statements, and result sets (use try-with-resources or defer)
- [ ] Configure pool size based on measurements: (CPU cores × 2) + I/O threads
- [ ] Set idle connection limits to 20-30% of max connections
- [ ] Enable connection leak detection with reclaim in all environments
- [ ] Configure connection validation before use
- [ ] Set connection lifetime limits (e.g., 30 minutes max lifetime, 5 minutes idle timeout)
- [ ] Use context timeouts for all database operations
- [ ] Enable statement caching and reuse prepared statements
- [ ] Pre-warm connection pools on application startup
- [ ] Monitor pool metrics continuously (wait time, utilization, error rate)
- [ ] Always rollback transactions on error using defer/finally
- [ ] Use batch operations for bulk inserts/updates
- [ ] Optimize queries before tuning pool size
- [ ] Consider external poolers (PgBouncer) for PostgreSQL at scale
- [ ] Stagger deployments to prevent connection storms

The majority of connection pool issues stem from leaked connections and improper resource cleanup. Focus on correct resource management first, then optimize pool configuration based on metrics.
