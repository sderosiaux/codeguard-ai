# Database Schema Design Anti-Patterns

A comprehensive guide to common database design mistakes and their solutions. Use this to identify problematic patterns in schema design during code analysis.

---

## 1. God Table (Mega Table)

**Description:** A single massive table storing unrelated data (users, orders, products, logs) with hundreds of columns. This creates a catch-all storage structure that violates separation of concerns and normalization principles.

**Bad Example:**
```sql
CREATE TABLE everything (
    id INT PRIMARY KEY,
    user_name VARCHAR(100),
    user_email VARCHAR(255),
    order_id INT,
    order_date DATE,
    product_name VARCHAR(200),
    product_price DECIMAL,
    log_message TEXT,
    log_timestamp TIMESTAMP,
    billing_address TEXT,
    -- ... hundreds more columns
);
```

**Good Example:**
```sql
CREATE TABLE users (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(255)
);

CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT REFERENCES users(id),
    order_date DATE
);

CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL
);
```

**Key Takeaway:** Decompose into logical, focused tables using normalization principles. Proper separation can reduce query times by up to 80% and improve maintainability.

---

## 2. Missing Primary Keys

**Description:** Tables lacking primary key definitions, relying instead on unreliable composites like name + date-of-birth or allowing duplicate records.

**Bad Example:**
```sql
CREATE TABLE customers (
    name VARCHAR(100),
    date_of_birth DATE,
    email VARCHAR(255)
);
-- No primary key; duplicates can accumulate
```

**Good Example:**
```sql
CREATE TABLE customers (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100),
    date_of_birth DATE,
    email VARCHAR(255) UNIQUE
);
```

**Key Takeaway:** Always define a primary key, preferably using auto-incrementing surrogate IDs. Use natural keys only when guaranteed unique and properly indexed. Missing primary keys complicate relationships, allow duplicates, and reduce operational efficiency.

---

## 3. Over-Normalization

**Description:** Excessive table decomposition creating complex join chains (12+ tables for simple queries). While normalization reduces redundancy, taken to extremes it severely impacts performance.

**Bad Example:**
```sql
-- Querying customer info requires 12+ joins
SELECT c.name, ca.street, ca.city, ci.country, co.code
FROM customers c
JOIN customer_addresses ca ON c.id = ca.customer_id
JOIN cities ci ON ca.city_id = ci.id
JOIN countries co ON ci.country_id = co.id
JOIN address_types at ON ca.type_id = at.id
-- ... many more joins
```

**Good Example:**
```sql
-- Controlled denormalization for read-heavy workloads
CREATE TABLE customer_details (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    street VARCHAR(255),
    city VARCHAR(100),
    country VARCHAR(100),
    address_type VARCHAR(50)
);
-- Use triggers or application logic to maintain consistency
```

**Key Takeaway:** Balance theoretical purity with practical performance. Consolidate tables with controlled redundancy for read-heavy workloads. Strategic denormalization can reduce query times by 50% or more.

---

## 4. EAV (Entity-Attribute-Value) Pattern

**Description:** Generic key-value tables (EntityID, Attribute, Value) for dynamic attribute storage. This sacrifices structured columns for flexibility, leading to severe performance and maintainability issues.

**Bad Example:**
```sql
CREATE TABLE product_attributes (
    id INT PRIMARY KEY,
    product_id INT,
    attribute_name VARCHAR(100),
    attribute_value TEXT
);

-- Inserting product data
INSERT INTO product_attributes VALUES
(1, 101, 'color', 'red'),
(2, 101, 'size', 'large'),
(3, 101, 'weight', '5.2'),
(4, 101, 'price', '29.99');

-- Querying requires complex pivoting
SELECT
    MAX(CASE WHEN attribute_name = 'color' THEN attribute_value END) as color,
    MAX(CASE WHEN attribute_name = 'price' THEN attribute_value END) as price
FROM product_attributes
WHERE product_id = 101
GROUP BY product_id;
```

**Good Example:**
```sql
-- Use fixed schema with JSON for truly dynamic attributes
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL(10,2),
    weight DECIMAL(10,2),
    metadata JSON  -- For genuinely dynamic attributes
);

-- Insert
INSERT INTO products VALUES
(101, 'Widget', 29.99, 5.2, '{"color": "red", "size": "large"}');

-- Query with proper types and indexing
SELECT * FROM products WHERE price > 20.00;
```

**Key Takeaway:** Use fixed schemas with JSON columns (PostgreSQL/MySQL) for semi-structured data instead of pure EAV. Document databases (MongoDB) are better suited for genuinely dynamic schemas. EAV loses type safety, prevents efficient indexing, and makes aggregations nearly impossible.

---

## 5. Wide Tables

**Description:** Single tables with 150+ columns cramming all attributes to avoid joins. This attempts to solve over-normalization but creates different performance problems.

**Bad Example:**
```sql
CREATE TABLE orders (
    id INT PRIMARY KEY,
    -- Order columns
    order_date DATE,
    order_total DECIMAL,
    -- Customer columns (denormalized)
    customer_name VARCHAR(100),
    customer_email VARCHAR(255),
    customer_phone VARCHAR(20),
    -- ... 50 more customer columns
    -- Shipping columns
    shipping_address_1 VARCHAR(255),
    shipping_address_2 VARCHAR(255),
    -- ... 30 more shipping columns
    -- Billing columns
    billing_address_1 VARCHAR(255),
    -- ... 30 more billing columns
    -- Product columns
    product_name VARCHAR(200),
    -- ... 40 more product columns
);
```

**Good Example:**
```sql
-- Normalized structure
CREATE TABLE orders (
    id INT PRIMARY KEY,
    customer_id INT REFERENCES customers(id),
    order_date DATE,
    order_total DECIMAL
);

CREATE TABLE customers (
    id INT PRIMARY KEY,
    name VARCHAR(100),
    email VARCHAR(255),
    phone VARCHAR(20)
);

-- Use views for common wide reads
CREATE VIEW order_details AS
SELECT o.*, c.name, c.email, s.address
FROM orders o
JOIN customers c ON o.customer_id = c.id
JOIN shipping_addresses s ON o.shipping_id = s.id;
```

**Key Takeaway:** Normalize into related tables; use views or materialized views for wide reads when needed. Wide tables slow inserts significantly (by 300% or more), cause update locks, and waste storage with excessive NULLs.

---

## 6. Improper Indexing

**Description:** Either over-indexing every column or under-indexing critical fields. Both extremes cause performance problems but in different ways.

**Bad Example (Over-indexing):**
```sql
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    description TEXT,
    price DECIMAL,
    created_at TIMESTAMP,
    updated_at TIMESTAMP
);
-- Creating indexes on every column
CREATE INDEX idx_name ON products(name);
CREATE INDEX idx_desc ON products(description);
CREATE INDEX idx_price ON products(price);
CREATE INDEX idx_created ON products(created_at);
CREATE INDEX idx_updated ON products(updated_at);
-- Slows down writes, bloats storage
```

**Bad Example (Under-indexing):**
```sql
-- No indexes on frequently queried columns
SELECT * FROM orders WHERE customer_email = 'user@example.com';
-- Forces full table scan
```

**Good Example:**
```sql
-- Strategic indexing based on query patterns
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    category_id INT,
    price DECIMAL,
    created_at TIMESTAMP
);

-- Index frequently queried columns
CREATE INDEX idx_category ON products(category_id);
CREATE INDEX idx_price ON products(price);
-- Composite index for common query patterns
CREATE INDEX idx_category_price ON products(category_id, price);

-- Use EXPLAIN to verify
EXPLAIN SELECT * FROM products WHERE category_id = 5 AND price < 100;
```

**Key Takeaway:** Index strategically based on actual query patterns using EXPLAIN plans. Over-indexing bloats storage and slows writes; under-indexing forces full table scans and spikes CPU. Regular analysis maintains optimal read/write balance.

---

## 7. Polymorphic Associations

**Description:** Foreign keys referencing multiple table types with a "type" discriminator column. This breaks referential integrity and creates maintenance nightmares.

**Bad Example:**
```sql
CREATE TABLE comments (
    id INT PRIMARY KEY,
    commentable_id INT,  -- Could reference posts OR photos OR videos
    commentable_type VARCHAR(50),  -- 'Post', 'Photo', 'Video'
    content TEXT
);

-- Cannot enforce referential integrity
-- Orphaned records when posts/photos/videos are deleted
SELECT * FROM comments WHERE commentable_type = 'Post' AND commentable_id = 123;
```

**Good Example:**
```sql
-- Separate tables for each relationship
CREATE TABLE post_comments (
    id INT PRIMARY KEY,
    post_id INT REFERENCES posts(id) ON DELETE CASCADE,
    content TEXT
);

CREATE TABLE photo_comments (
    id INT PRIMARY KEY,
    photo_id INT REFERENCES photos(id) ON DELETE CASCADE,
    content TEXT
);

-- Or use a proper inheritance pattern
CREATE TABLE commentable_items (
    id INT PRIMARY KEY,
    type VARCHAR(50)
);

CREATE TABLE posts (
    id INT PRIMARY KEY REFERENCES commentable_items(id)
);

CREATE TABLE comments (
    id INT PRIMARY KEY,
    item_id INT REFERENCES commentable_items(id) ON DELETE CASCADE,
    content TEXT
);
```

**Key Takeaway:** Use single-type relationships or separate join tables. Polymorphic associations prevent referential integrity enforcement, allow orphaned records, require complex CASE statements, and make cascading deletes fail inconsistently.

---

## 8. Wrong Data Types

**Description:** Storing dates as VARCHAR strings, using INT for booleans, or other type mismatches. This prevents proper querying and enables subtle bugs.

**Bad Example:**
```sql
CREATE TABLE events (
    id INT PRIMARY KEY,
    event_date VARCHAR(50),  -- '2025-12-11' or '12/11/2025' or '11-Dec-2025'
    is_active INT,  -- 0 or 1 instead of BOOLEAN
    price VARCHAR(20),  -- '$29.99' instead of DECIMAL
    status VARCHAR(50)  -- 'pending', 'active', 'closed'
);

-- Cannot do range queries properly
SELECT * FROM events WHERE event_date > '2025-01-01';  -- String comparison!
-- Requires runtime type conversions
SELECT * FROM events WHERE CAST(price AS DECIMAL) > 20;
```

**Good Example:**
```sql
CREATE TABLE events (
    id INT PRIMARY KEY,
    event_date DATE,  -- Proper date type
    is_active BOOLEAN,  -- Proper boolean type
    price DECIMAL(10,2),  -- Proper numeric type
    status ENUM('pending', 'active', 'closed')  -- Constrained values
);

-- Proper range queries
SELECT * FROM events WHERE event_date > '2025-01-01';
-- Proper numeric operations
SELECT * FROM events WHERE price > 20.00;
-- Type-safe status checks
SELECT * FROM events WHERE status = 'active';
```

**Key Takeaway:** Match data types precisely to their domain. Use DATE/TIMESTAMP for temporal data, BOOLEAN for true/false, DECIMAL for money, ENUM for fixed sets. Wrong types prevent range queries, require runtime conversions, and enable subtle logic bugs.

---

## 9. Universal Primary Keys (One-Size-Fits-All)

**Description:** Universally applying auto-incrementing integers as primary keys regardless of context, even when meaningful natural keys exist.

**Bad Example:**
```sql
CREATE TABLE countries (
    id INT PRIMARY KEY AUTO_INCREMENT,
    country_code VARCHAR(2),  -- 'US', 'UK', 'FR'
    name VARCHAR(100)
);

CREATE TABLE orders (
    id INT PRIMARY KEY,
    country_id INT REFERENCES countries(id)
);

-- Requires join to get readable information
SELECT o.*, c.country_code
FROM orders o
JOIN countries c ON o.country_id = c.id;
```

**Good Example:**
```sql
CREATE TABLE countries (
    country_code CHAR(2) PRIMARY KEY,  -- Natural key
    name VARCHAR(100)
);

CREATE TABLE orders (
    id INT PRIMARY KEY,
    country_code CHAR(2) REFERENCES countries(country_code)
);

-- Direct readable access
SELECT * FROM orders WHERE country_code = 'US';
```

**Key Takeaway:** Employ natural keys when stable and available (country codes, SKUs, email addresses). Reserve surrogate keys for entities lacking natural identifiers. Natural keys provide better readability in logs, URLs, and reduce unnecessary joins.

---

## 10. Timestamp Confusion

**Description:** Inconsistent date/time handling: storing as strings, mixing time zones, using inappropriate data types for temporal data.

**Bad Example:**
```sql
CREATE TABLE user_activity (
    id INT PRIMARY KEY,
    user_id INT,
    login_time VARCHAR(50),  -- '2025-12-11 14:30:00 PST'
    created_at INT,  -- Unix timestamp
    updated VARCHAR(100)  -- 'December 11, 2025 at 2:30pm'
);

-- Inconsistent formats, impossible to query reliably
```

**Good Example:**
```sql
CREATE TABLE user_activity (
    id INT PRIMARY KEY,
    user_id INT,
    login_time TIMESTAMP,  -- Always UTC
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Proper temporal queries
SELECT * FROM user_activity
WHERE login_time BETWEEN '2025-12-01' AND '2025-12-31';

-- Convert to local time in application logic
```

**Key Takeaway:** Always use proper date/time data types (DATE, TIMESTAMP, DATETIME). Store everything in UTC and convert to local time in application logic. Consistent handling enables proper range queries, sorting, and time-based aggregations.

---

## 11. Soft Delete Obsession

**Description:** Marking records as deleted rather than physically removing them, often without proper justification. Every table gets an is_deleted or deleted_at column.

**Bad Example:**
```sql
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL,
    is_deleted BOOLEAN DEFAULT FALSE
);

-- Every query must filter deleted records
SELECT * FROM products WHERE is_deleted = FALSE AND price < 100;

-- Indexes become less efficient
-- Data grows indefinitely
-- Compliance deletions become problematic
```

**Good Example:**
```sql
-- Only soft delete when truly needed (audit trail, referential integrity)
CREATE TABLE products (
    id INT PRIMARY KEY,
    name VARCHAR(200),
    price DECIMAL
);

-- If audit trail needed, use separate audit table
CREATE TABLE product_audit (
    id INT PRIMARY KEY,
    product_id INT,
    action VARCHAR(50),  -- 'created', 'updated', 'deleted'
    action_date TIMESTAMP,
    snapshot JSON
);

-- Actual queries are clean
SELECT * FROM products WHERE price < 100;
```

**Key Takeaway:** Use soft deletes only when audit requirements or historical referential integrity necessitate it. Prefer proper backups and separate audit logs instead. Soft deletes bloat tables, slow queries, complicate indexes, and make compliance deletions (GDPR) problematic.

---

## Summary: Key Prevention Strategies

1. **Peer Design Reviews:** Have schemas reviewed before implementation
2. **ER Diagramming:** Visualize relationships to spot design flaws early
3. **Query Profiling:** Use slow query logs and EXPLAIN plans regularly
4. **KISS Principle:** Keep schemas simple and focused
5. **Production-Scale Testing:** Test with realistic data volumes before deployment
6. **Monitor Metrics:** Track query performance, index usage, and table bloat
7. **Regular Audits:** Periodically review and refactor schemas as requirements evolve

Use normalization as a starting point, then denormalize strategically based on measured performance needs. Always prioritize data integrity and maintainability over premature optimization.
