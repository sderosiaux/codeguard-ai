# SQL Anti-Patterns: Common Database Mistakes and Solutions

This document catalogs common SQL and database anti-patterns that degrade performance, maintainability, and data integrity. Each pattern includes detection criteria, examples, and practical solutions suitable for LLM-based code analysis.

---

## 1. N+1 Query Problem

**Description:** The N+1 query problem occurs when an application executes one query to fetch N records, then executes N additional queries to fetch related data for each record. This results in N+1 total queries instead of a single optimized query with joins or eager loading.

**Bad Code Example (Python/Django):**
```python
# Fetches all books (1 query)
books = Book.objects.all()[:10]

# For each book, fetches author (10 additional queries = 11 total)
for book in books:
    print(f"{book.title} by {book.author.name}")
```

**Bad Code Example (Ruby/Rails):**
```ruby
# Fetches all posts (1 query)
posts = Post.all

# For each post, fetches author (N additional queries)
posts.each do |post|
  puts "#{post.title} by #{post.author.name}"
end
```

**Good Code Example (Python/Django):**
```python
# Single query with JOIN - fetches books and authors together
books = Book.objects.select_related("author").all()[:10]

for book in books:
    print(f"{book.title} by {book.author.name}")
```

**Good Code Example (Ruby/Rails):**
```ruby
# Eager loading with includes - 2 queries total instead of N+1
posts = Post.includes(:author).all

posts.each do |post|
  puts "#{post.title} by #{post.author.name}"
end
```

**Good Code Example (TypeORM):**
```typescript
// Use leftJoinAndSelect for eager loading
const users = await userRepository
  .createQueryBuilder("user")
  .leftJoinAndSelect("user.posts", "posts")
  .getMany();
```

**Batch Insert Example:**
```python
# Bad: 10 separate INSERT queries
for i in range(1, 11):
    Book.objects.create(title=f"Book {i}")

# Good: Single bulk INSERT query
Book.objects.bulk_create([
    Book(title=f"Book {i}") for i in range(1, 11)
])
```

**Key Takeaway:** Always use eager loading (select_related, includes, leftJoinAndSelect) when accessing related data. For write operations, use bulk operations (bulk_create, bulk_insert) instead of loops. Monitor query counts in development using tools like Bullet (Rails), django-debug-toolbar (Django), or APM tools.

---

## 2. Missing Indexes

**Description:** Queries without appropriate indexes force full table scans, severely degrading performance on large tables. Missing indexes are particularly problematic on columns used in WHERE clauses, JOIN conditions, ORDER BY, and GROUP BY operations.

**Detection Criteria:**
- Queries performing table scans on large tables
- Slow queries on columns used in WHERE or JOIN conditions
- Missing indexes on foreign key columns
- Columns frequently used in ORDER BY without indexes

**Bad Schema Example:**
```sql
-- Table without index on foreign key
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,  -- No index!
    product_id INTEGER NOT NULL,  -- No index!
    order_date TIMESTAMP,
    total DECIMAL(10,2)
);

-- Slow query - requires full table scan
SELECT * FROM orders WHERE user_id = 12345;
```

**Good Schema Example:**
```sql
-- Properly indexed table
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    product_id INTEGER NOT NULL,
    order_date TIMESTAMP,
    total DECIMAL(10,2)
);

-- Index on foreign key for JOIN performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
CREATE INDEX idx_orders_product_id ON orders(product_id);

-- Composite index for common query patterns
CREATE INDEX idx_orders_user_date ON orders(user_id, order_date);

-- Query now uses index
SELECT * FROM orders WHERE user_id = 12345;
```

**Key Takeaway:** Create indexes on foreign keys, columns in WHERE/JOIN clauses, and columns used for sorting. Use composite indexes for multi-column queries. Monitor index usage with sys.dm_db_index_usage_stats (SQL Server) or pg_stat_user_indexes (PostgreSQL) to identify missing or unused indexes.

---

## 3. Over-Indexing / Rogue Indexes

**Description:** Creating excessive, duplicate, or unused indexes wastes storage and degrades write performance. Every index adds overhead to INSERT, UPDATE, and DELETE operations as the database must maintain index entries alongside data changes.

**Problems:**
- Unused indexes still incur write operation overhead
- Index fragmentation requires costly rebuilds
- Duplicate or overlapping indexes provide no additional benefit
- Increased storage costs and memory consumption

**Bad Schema Example:**
```sql
-- Over-indexed table with redundant indexes
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    created_at TIMESTAMP
);

-- Redundant indexes
CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_email_lower ON users(LOWER(email));  -- Overlaps
CREATE INDEX idx_users_first_name ON users(first_name);  -- Low cardinality
CREATE INDEX idx_users_last_name ON users(last_name);  -- Low cardinality
CREATE INDEX idx_users_full_name ON users(first_name, last_name);  -- Overlaps above
CREATE INDEX idx_users_created ON users(created_at);  -- Rarely queried
```

**Good Schema Example:**
```sql
-- Strategic indexing based on actual query patterns
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE,  -- UNIQUE constraint creates index
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    created_at TIMESTAMP
);

-- Only create indexes for high-value queries
CREATE INDEX idx_users_name_search ON users(last_name, first_name);
```

**Key Takeaway:** Create indexes strategically based on actual query patterns, not speculatively. Avoid indexing low-cardinality columns (e.g., boolean, status with few values). Foreign keys in SQL Server don't auto-index, so add them manually. Regularly audit and remove unused indexes using database statistics views.

---

## 4. SELECT * Anti-Pattern

**Description:** Using SELECT * instead of explicitly listing columns retrieves unnecessary data, prevents covering indexes, breaks applications when schema changes, and wastes network bandwidth and memory.

**Bad Code Example:**
```sql
-- Retrieves all columns including large BLOBs
SELECT * FROM users WHERE id = 123;

-- Forces query to fetch from heap/clustered index
SELECT * FROM orders WHERE user_id = 456;
```

**Good Code Example:**
```sql
-- Only retrieve needed columns
SELECT id, email, first_name, last_name
FROM users
WHERE id = 123;

-- Enables covering index optimization
SELECT user_id, order_date, total
FROM orders
WHERE user_id = 456;

-- Create covering index for the query
CREATE INDEX idx_orders_user_covering
ON orders(user_id)
INCLUDE (order_date, total);
```

**Key Takeaway:** Always specify exact columns needed. This enables covering indexes (where index contains all queried columns, avoiding table lookups), prevents breaking changes when columns are added/reordered, reduces network transfer and memory usage, and makes query intent explicit.

---

## 5. Implicit Type Conversion

**Description:** When query parameters don't match column data types, the database performs implicit conversion. This prevents index usage, causes table scans, and wastes CPU resources on type conversion.

**Bad Code Example:**
```sql
-- Table has VARCHAR column
CREATE TABLE products (
    id INTEGER PRIMARY KEY,
    sku VARCHAR(50)  -- String column with index
);
CREATE INDEX idx_products_sku ON products(sku);

-- Query with wrong type - forces conversion and table scan
SELECT * FROM products WHERE sku = 12345;  -- Integer literal!

-- Another example with NVARCHAR vs VARCHAR
SELECT * FROM users WHERE username = N'john.doe';  -- NVARCHAR literal on VARCHAR column
```

**Good Code Example:**
```sql
-- Match the column data type exactly
SELECT * FROM products WHERE sku = '12345';  -- String literal

-- For parameterized queries, ensure parameter types match
-- Python example:
cursor.execute("SELECT * FROM products WHERE sku = %s", ('12345',))

-- SQL Server: Match VARCHAR with VARCHAR (not NVARCHAR)
SELECT * FROM users WHERE username = 'john.doe';  -- No N prefix
```

**Detection Query (SQL Server):**
```sql
-- Find queries with implicit conversions
SELECT
    query_plan,
    text
FROM sys.dm_exec_query_stats
CROSS APPLY sys.dm_exec_sql_text(sql_handle)
CROSS APPLY sys.dm_exec_query_plan(plan_handle)
WHERE CAST(query_plan AS NVARCHAR(MAX)) LIKE '%CONVERT_IMPLICIT%';
```

**Key Takeaway:** Always match parameter types to column types. Common mistakes include: integer/string mismatches, NVARCHAR vs VARCHAR in SQL Server, CHAR vs VARCHAR comparisons. Use prepared statements with correctly typed parameters. Enable query plan warnings to detect CONVERT_IMPLICIT operations.

---

## 6. Tables Without Primary Keys

**Description:** Tables without primary keys violate fundamental relational database principles and typically indicate missing foreign keys, unique constraints, and other integrity mechanisms. This makes row identification ambiguous and breaks replication/change tracking.

**Bad Schema Example:**
```sql
-- No way to uniquely identify rows
CREATE TABLE user_sessions (
    user_id INTEGER,
    session_token VARCHAR(255),
    created_at TIMESTAMP
);

-- Allows duplicate rows
INSERT INTO user_sessions VALUES (1, 'abc123', NOW());
INSERT INTO user_sessions VALUES (1, 'abc123', NOW());  -- Duplicate!
```

**Good Schema Example:**
```sql
-- Synthetic primary key
CREATE TABLE user_sessions (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL,
    session_token VARCHAR(255) UNIQUE NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Natural composite primary key (when appropriate)
CREATE TABLE order_items (
    order_id INTEGER,
    product_id INTEGER,
    quantity INTEGER,
    PRIMARY KEY (order_id, product_id)
);
```

**Key Takeaway:** Every table must have a primary key. Use synthetic keys (auto-increment integers, UUIDs) for most tables. Use natural composite keys when the combination uniquely identifies rows. Primary keys enable foreign key relationships, improve query performance, and ensure data integrity.

---

## 7. Using CHAR(N) Instead of VARCHAR(N)

**Description:** Fixed-length CHAR fields waste storage space for variable-length strings and silently truncate data exceeding the limit. They also require TRIM operations in queries and application code.

**Bad Schema Example:**
```sql
-- Wastes space when strings are shorter than 100
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title CHAR(100),  -- Always uses 100 bytes
    author_name CHAR(50)  -- Always uses 50 bytes
);

-- Average title is 30 chars: wastes 70 bytes per row
-- With 1M rows: 70MB wasted storage

-- Queries require trimming
SELECT RTRIM(LTRIM(title)) FROM articles;
```

**Good Schema Example:**
```sql
-- Uses only needed space plus small overhead
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100),  -- Uses actual length + 1-2 bytes
    author_name VARCHAR(50)
);

-- No trimming needed
SELECT title FROM articles;
```

**When CHAR Is Appropriate:**
- Fixed-length codes (country codes: CHAR(2), state codes: CHAR(2))
- Fixed-format identifiers (ISBN: CHAR(13), UUID: CHAR(36))
- Columns where all values are truly the same length

**Key Takeaway:** Use VARCHAR for variable-length strings. Reserve CHAR only for truly fixed-length data like country codes. VARCHAR provides storage efficiency, prevents silent truncation, eliminates trim operations, and maintains data integrity.

---

## 8. Extremely Wide Tables

**Description:** Tables with excessive columns (50+) indicate poor normalization, combining multiple entities into one table. This creates maintenance difficulties, wasted storage, and complex queries.

**Bad Schema Example:**
```sql
-- God table with 100+ columns
CREATE TABLE customer_data (
    id SERIAL PRIMARY KEY,
    -- Customer info
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255),
    -- 20 address fields
    home_address_line1 VARCHAR(255),
    home_address_line2 VARCHAR(255),
    home_city VARCHAR(100),
    home_state VARCHAR(2),
    home_zip VARCHAR(10),
    work_address_line1 VARCHAR(255),
    work_address_line2 VARCHAR(255),
    -- ... 13 more address fields
    -- 30 preference fields
    email_preference_marketing BOOLEAN,
    email_preference_newsletter BOOLEAN,
    -- ... 28 more boolean fields
    -- 50 more miscellaneous fields
);
```

**Good Schema Example:**
```sql
-- Normalized design
CREATE TABLE customers (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    email VARCHAR(255)
);

CREATE TABLE addresses (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    address_type VARCHAR(20),  -- 'home', 'work', 'billing'
    address_line1 VARCHAR(255),
    address_line2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(2),
    zip VARCHAR(10)
);

CREATE TABLE customer_preferences (
    id SERIAL PRIMARY KEY,
    customer_id INTEGER REFERENCES customers(id),
    preference_key VARCHAR(100),
    preference_value TEXT
);
```

**Key Takeaway:** Tables should typically have 10-30 columns. More suggests poor normalization. Split wide tables into logical entities using foreign keys. This improves maintainability, reduces NULL columns, enables flexible schema evolution, and improves query performance by reducing row width.

---

## 9. Unnecessary DATETIME/TIMESTAMP When DATE Suffices

**Description:** Using DATETIME or TIMESTAMP data types when only date information is needed wastes 4-5 bytes per row and complicates queries with time components.

**Bad Schema Example:**
```sql
CREATE TABLE user_birthdays (
    user_id INTEGER PRIMARY KEY,
    birth_date TIMESTAMP  -- Stores '1990-01-15 00:00:00' - unnecessary time
);

-- Complex query to match dates
SELECT * FROM user_birthdays
WHERE DATE(birth_date) = '1990-01-15';  -- Function prevents index use
```

**Good Schema Example:**
```sql
CREATE TABLE user_birthdays (
    user_id INTEGER PRIMARY KEY,
    birth_date DATE  -- Stores '1990-01-15' only
);

-- Simple, efficient query
SELECT * FROM user_birthdays
WHERE birth_date = '1990-01-15';
```

**Storage Comparison:**
- DATE: 3-4 bytes (date only)
- DATETIME/TIMESTAMP: 8 bytes (date + time)
- With 10M rows: 40-50MB wasted storage

**Key Takeaway:** Apply YAGNI principle - "You Aren't Gonna Need It." Use DATE for dates (birthdays, hire dates, deadlines), TIME for time-only values (business hours), and DATETIME/TIMESTAMP only when you need both components. This saves storage, simplifies queries, and prevents timezone confusion.

---

## 10. Deeply Nested Views

**Description:** Creating views that reference other views in multiple layers creates a maintenance nightmare, hinders query optimization, and makes performance analysis nearly impossible.

**Bad Schema Example:**
```sql
-- Base view
CREATE VIEW active_users AS
SELECT * FROM users WHERE status = 'active';

-- Second layer
CREATE VIEW premium_users AS
SELECT * FROM active_users WHERE subscription_tier = 'premium';

-- Third layer
CREATE VIEW premium_users_with_orders AS
SELECT p.*, COUNT(o.id) as order_count
FROM premium_users p
LEFT JOIN orders o ON p.id = o.user_id
GROUP BY p.id;

-- Fourth layer
CREATE VIEW top_premium_customers AS
SELECT * FROM premium_users_with_orders
WHERE order_count > 10;

-- Query becomes impossible to optimize
SELECT * FROM top_premium_customers WHERE email LIKE '%@example.com';
```

**Good Schema Example:**
```sql
-- Single view with clear logic
CREATE VIEW top_premium_customers AS
SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'
  AND u.subscription_tier = 'premium'
GROUP BY u.id, u.email, u.first_name, u.last_name
HAVING COUNT(o.id) > 10;

-- Or use materialized view for performance
CREATE MATERIALIZED VIEW top_premium_customers_mv AS
SELECT
    u.id,
    u.email,
    u.first_name,
    u.last_name,
    COUNT(o.id) as order_count
FROM users u
LEFT JOIN orders o ON u.id = o.user_id
WHERE u.status = 'active'
  AND u.subscription_tier = 'premium'
GROUP BY u.id, u.email, u.first_name, u.last_name
HAVING COUNT(o.id) > 10;

-- Refresh periodically
REFRESH MATERIALIZED VIEW top_premium_customers_mv;
```

**Key Takeaway:** Limit view nesting to 2-3 layers maximum. Reference base tables with proper indexes when possible. Consider materialized views (PostgreSQL) or indexed views (SQL Server) for complex, frequently-accessed queries. Document view dependencies and refresh schedules.

---

## 11. Comma-Separated Lists in Columns (Jaywalking)

**Description:** Storing delimited lists in a single column violates first normal form, prevents efficient querying, and eliminates referential integrity. This anti-pattern is also called "Jaywalking" or ignoring the signal.

**Bad Schema Example:**
```sql
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255),
    tag_ids VARCHAR(255)  -- Stores '1,5,12,23' as string
);

-- Inefficient, non-portable query
SELECT * FROM articles WHERE tag_ids LIKE '%12%';  -- Matches 12, 123, 1123!

-- Cannot use foreign keys
-- Cannot efficiently JOIN
-- Cannot easily count or aggregate
```

**Good Schema Example:**
```sql
-- Proper many-to-many relationship
CREATE TABLE articles (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255)
);

CREATE TABLE tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) UNIQUE
);

CREATE TABLE article_tags (
    article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
    tag_id INTEGER REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (article_id, tag_id)
);

-- Efficient, standard SQL query
SELECT a.*
FROM articles a
JOIN article_tags at ON a.id = at.article_id
WHERE at.tag_id = 12;

-- Easy aggregation
SELECT t.name, COUNT(at.article_id) as article_count
FROM tags t
LEFT JOIN article_tags at ON t.id = at.tag_id
GROUP BY t.id, t.name;
```

**Key Takeaway:** Never store delimited lists in columns. Use junction tables for many-to-many relationships. This enables foreign key constraints, efficient indexed queries, proper JOIN operations, and adherence to first normal form. Modern databases have JSON/ARRAY types if you truly need multi-value columns, but relational design is usually better.

---

## 12. Polymorphic Associations

**Description:** Using a multi-purpose foreign key that can reference multiple parent tables eliminates referential integrity and creates ambiguous data relationships. Also called "messy associations."

**Bad Schema Example:**
```sql
-- Polymorphic association (common in Rails)
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    content TEXT,
    commentable_type VARCHAR(50),  -- 'Article', 'Photo', 'Video'
    commentable_id INTEGER,  -- Can reference any table!
    created_at TIMESTAMP
);

-- No foreign key constraint possible
-- No referential integrity
-- Cannot efficiently JOIN without application logic
SELECT * FROM comments WHERE commentable_type = 'Article';
```

**Good Schema Example (Shared Primary Key):**
```sql
-- Create supertype table
CREATE TABLE commentables (
    id SERIAL PRIMARY KEY,
    created_at TIMESTAMP
);

-- Subtype tables reference supertype
CREATE TABLE articles (
    id INTEGER PRIMARY KEY REFERENCES commentables(id),
    title VARCHAR(255),
    content TEXT
);

CREATE TABLE photos (
    id INTEGER PRIMARY KEY REFERENCES commentables(id),
    url VARCHAR(500),
    caption TEXT
);

-- Comments reference supertype with proper FK
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    commentable_id INTEGER REFERENCES commentables(id),
    content TEXT,
    created_at TIMESTAMP
);
```

**Good Schema Example (Separate Foreign Keys):**
```sql
-- Explicit foreign keys for each relationship
CREATE TABLE comments (
    id SERIAL PRIMARY KEY,
    content TEXT,
    article_id INTEGER REFERENCES articles(id) ON DELETE CASCADE,
    photo_id INTEGER REFERENCES photos(id) ON DELETE CASCADE,
    video_id INTEGER REFERENCES videos(id) ON DELETE CASCADE,
    created_at TIMESTAMP,
    CHECK (
        (article_id IS NOT NULL)::INTEGER +
        (photo_id IS NOT NULL)::INTEGER +
        (video_id IS NOT NULL)::INTEGER = 1
    )
);

-- Create partial indexes for each type
CREATE INDEX idx_comments_article ON comments(article_id) WHERE article_id IS NOT NULL;
CREATE INDEX idx_comments_photo ON comments(photo_id) WHERE photo_id IS NOT NULL;
CREATE INDEX idx_comments_video ON comments(video_id) WHERE video_id IS NOT NULL;
```

**Key Takeaway:** Avoid polymorphic associations. Use explicit foreign keys with CHECK constraints, or use a supertype table with shared primary keys. This ensures referential integrity, enables CASCADE operations, allows efficient indexed JOINs, and makes the data model explicit and maintainable.

---

## 13. Entity-Attribute-Value (EAV) Model

**Description:** EAV attempts to store dynamic attributes by using rows instead of columns, creating a "schema-on-read" pattern. While flexible, it sacrifices type safety, query performance, and data integrity for nearly all use cases.

**Bad Schema Example:**
```sql
CREATE TABLE eav_data (
    entity_id INTEGER,
    attribute_name VARCHAR(100),
    attribute_value TEXT,  -- All values are strings!
    PRIMARY KEY (entity_id, attribute_name)
);

-- Storing product data in EAV
INSERT INTO eav_data VALUES (1, 'name', 'Laptop');
INSERT INTO eav_data VALUES (1, 'price', '999.99');  -- String, not number!
INSERT INTO eav_data VALUES (1, 'in_stock', 'true');  -- String, not boolean!
INSERT INTO eav_data VALUES (2, 'name', 'Mouse');
INSERT INTO eav_data VALUES (2, 'price', '29.99');

-- Horrible query to get products with price > 500
SELECT entity_id
FROM eav_data
WHERE attribute_name = 'price'
  AND CAST(attribute_value AS DECIMAL) > 500;  -- No index possible!

-- Complex query to reconstruct one entity
SELECT
    MAX(CASE WHEN attribute_name = 'name' THEN attribute_value END) as name,
    MAX(CASE WHEN attribute_name = 'price' THEN attribute_value END) as price,
    MAX(CASE WHEN attribute_name = 'in_stock' THEN attribute_value END) as in_stock
FROM eav_data
WHERE entity_id = 1
GROUP BY entity_id;
```

**Good Schema Example:**
```sql
-- Traditional normalized design
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    in_stock BOOLEAN DEFAULT true
);

-- Use JSONB for truly dynamic attributes (PostgreSQL)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL,
    in_stock BOOLEAN DEFAULT true,
    metadata JSONB  -- For optional, dynamic attributes
);

-- Create GIN index on JSONB for efficient queries
CREATE INDEX idx_products_metadata ON products USING GIN (metadata);

-- Query with type safety
SELECT * FROM products WHERE price > 500;

-- Query JSONB attributes efficiently
SELECT * FROM products WHERE metadata->>'color' = 'red';
```

**Problems with EAV:**
- Loss of data type integrity (everything becomes TEXT)
- Cannot use NOT NULL, CHECK, or DEFAULT constraints
- Queries require expensive pivots and CASE statements
- No index support for attribute values
- Difficult reporting and aggregation
- Typos create new attributes silently

**When EAV May Be Acceptable:**
- Rapid prototyping with truly unknown schema
- Multi-tenant SaaS where customers define custom fields
- Medical records with thousands of optional fields
- Consider modern alternatives: JSONB (PostgreSQL), JSON (MySQL), or document databases (MongoDB)

**Key Takeaway:** Avoid EAV in 99% of cases. Use traditional normalized design with proper data types. For dynamic attributes, use JSONB/JSON columns with GIN indexes, or use a document database if the entire model is document-oriented. EAV sacrifices too much for the flexibility it provides.

---

## 14. Using FLOAT/REAL for Money

**Description:** Floating-point types use binary representation that cannot accurately represent decimal values, causing rounding errors in financial calculations. This violates regulatory requirements and creates audit issues.

**Bad Schema Example:**
```sql
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    amount FLOAT,  -- WRONG! Binary floating point
    tax FLOAT,
    total FLOAT
);

-- Rounding errors accumulate
INSERT INTO transactions VALUES (1, 10.10, 0.77, 10.87);
SELECT * FROM transactions;  -- May show 10.869999999...

-- Calculations produce incorrect results
SELECT SUM(amount) FROM transactions;  -- Not exact
```

**Good Schema Example:**
```sql
-- Use DECIMAL/NUMERIC for money
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    amount DECIMAL(19,4) NOT NULL,  -- Exact decimal arithmetic
    tax DECIMAL(19,4) NOT NULL,
    total DECIMAL(19,4) NOT NULL,
    CHECK (total = amount + tax)  -- Constraint enforces integrity
);

-- Exact calculations
INSERT INTO transactions VALUES (1, 10.10, 0.77, 10.87);
SELECT * FROM transactions;  -- Shows exactly 10.8700

-- Accurate aggregation
SELECT SUM(amount) FROM transactions;  -- Exact sum
```

**Data Type Guidelines:**
- DECIMAL(19,4): Industry standard for money (supports up to quadrillions with 4 decimal places)
- DECIMAL(10,2): Smaller amounts with cent precision
- INTEGER: Store cents as integers (e.g., 1087 cents = $10.87) for maximum precision

**Alternative: Store as Integers:**
```sql
-- Store cents as integers
CREATE TABLE transactions (
    id SERIAL PRIMARY KEY,
    amount_cents INTEGER NOT NULL,  -- Store 1087 for $10.87
    currency CHAR(3) DEFAULT 'USD'
);

-- Convert in application layer
-- $10.87 → 1087 cents → store in DB
-- 1087 cents → retrieve from DB → $10.87
```

**Key Takeaway:** Never use FLOAT, REAL, or DOUBLE PRECISION for money. Use DECIMAL/NUMERIC with appropriate precision and scale, or store cents as INTEGER values. This ensures exact decimal arithmetic, compliance with financial regulations, accurate reporting, and audit trail integrity.

---

## 15. Not Using Transactions

**Description:** Executing multiple related operations without a transaction wrapper risks data inconsistency when partial failures occur. Transactions ensure atomicity - all operations succeed or all fail together.

**Bad Code Example:**
```python
# No transaction - partial updates possible
cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
# ... application crashes here ...
cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
# First account debited, second never credited!
```

**Bad Code Example (Multiple Operations):**
```sql
-- Without transaction
DELETE FROM order_items WHERE order_id = 123;
DELETE FROM orders WHERE id = 123;
-- If second DELETE fails, orphaned order exists with no items!
```

**Good Code Example:**
```python
# Proper transaction usage
try:
    conn.begin()
    cursor.execute("UPDATE accounts SET balance = balance - 100 WHERE id = 1")
    cursor.execute("UPDATE accounts SET balance = balance + 100 WHERE id = 2")
    conn.commit()
except Exception:
    conn.rollback()
    raise
```

**Good Code Example (SQL):**
```sql
BEGIN TRANSACTION;

UPDATE accounts
SET balance = balance - 100
WHERE id = 1;

UPDATE accounts
SET balance = balance + 100
WHERE id = 2;

COMMIT;
-- If any statement fails, ROLLBACK occurs automatically
```

**Transaction Isolation Levels:**
```sql
-- READ COMMITTED (default in most databases)
BEGIN TRANSACTION ISOLATION LEVEL READ COMMITTED;

-- REPEATABLE READ (prevents non-repeatable reads)
BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ;

-- SERIALIZABLE (strictest isolation)
BEGIN TRANSACTION ISOLATION LEVEL SERIALIZABLE;
```

**Key Takeaway:** Always wrap related operations in transactions. Use appropriate isolation levels based on consistency requirements. Keep transactions short to avoid long-held locks. For long-running operations, consider saga patterns or eventual consistency models. Transactions are essential for maintaining data integrity across multi-step operations.

---

## 16. Missing or Incorrect Foreign Key Constraints

**Description:** Failing to define foreign key constraints allows orphaned records, breaks referential integrity, and prevents cascading updates/deletes. Foreign keys are crucial for maintaining data consistency.

**Bad Schema Example:**
```sql
CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER,  -- No foreign key!
    product_id INTEGER,  -- No foreign key!
    quantity INTEGER
);

-- Allows invalid data
INSERT INTO orders VALUES (1, 999, 888, 5);  -- Non-existent user and product
DELETE FROM users WHERE id = 123;  -- Leaves orphaned orders
```

**Good Schema Example:**
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL
);

CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    price DECIMAL(10,2) NOT NULL
);

CREATE TABLE orders (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE RESTRICT,
    quantity INTEGER NOT NULL CHECK (quantity > 0),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Foreign keys prevent invalid data
INSERT INTO orders VALUES (1, 999, 888, 5);  -- ERROR: user 999 doesn't exist

-- Cascading delete
DELETE FROM users WHERE id = 123;  -- Automatically deletes related orders

-- Restrict delete
DELETE FROM products WHERE id = 5;  -- ERROR: orders reference this product
```

**Cascade Options:**
```sql
-- ON DELETE CASCADE: Delete child rows when parent deleted
REFERENCES users(id) ON DELETE CASCADE

-- ON DELETE SET NULL: Set foreign key to NULL when parent deleted
REFERENCES users(id) ON DELETE SET NULL

-- ON DELETE RESTRICT: Prevent parent deletion if children exist
REFERENCES products(id) ON DELETE RESTRICT

-- ON DELETE NO ACTION: Same as RESTRICT (default)
REFERENCES categories(id) ON DELETE NO ACTION

-- ON UPDATE CASCADE: Update foreign key when parent key changes
REFERENCES users(id) ON UPDATE CASCADE
```

**Important Note (SQL Server):**
```sql
-- SQL Server does NOT auto-index foreign keys!
CREATE TABLE orders (
    id INT PRIMARY KEY,
    user_id INT REFERENCES users(id)
);

-- Must manually create index for JOIN performance
CREATE INDEX idx_orders_user_id ON orders(user_id);
```

**Key Takeaway:** Always define foreign key constraints for referential integrity. Choose appropriate CASCADE actions based on business logic. Manually index foreign keys in SQL Server for JOIN performance. Foreign keys prevent orphaned data, enable efficient JOINs, document relationships, and enforce data consistency at the database level.

---

## 17. LIKE with Leading Wildcard

**Description:** Using LIKE with a leading wildcard (e.g., '%pattern') prevents index usage and forces full table scans, even when an index exists on the column.

**Bad Code Example:**
```sql
-- Cannot use index - requires full table scan
SELECT * FROM users WHERE email LIKE '%@example.com';

-- Another example
SELECT * FROM products WHERE name LIKE '%widget%';
```

**Good Code Example:**
```sql
-- Can use index with leading characters
SELECT * FROM users WHERE email LIKE 'john%';

-- Use full-text search for substring matching
-- PostgreSQL
CREATE INDEX idx_users_email_gin ON users USING GIN (email gin_trgm_ops);
SELECT * FROM users WHERE email ILIKE '%example%';

-- MySQL
CREATE FULLTEXT INDEX idx_products_name ON products(name);
SELECT * FROM products WHERE MATCH(name) AGAINST('widget');

-- SQL Server
CREATE FULLTEXT INDEX ON products(name);
SELECT * FROM products WHERE CONTAINS(name, 'widget');
```

**Alternative Solutions:**
```sql
-- For email domain searches, store domain separately
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255),
    email_domain VARCHAR(255) GENERATED ALWAYS AS (
        SUBSTRING(email FROM POSITION('@' IN email) + 1)
    ) STORED
);

CREATE INDEX idx_users_email_domain ON users(email_domain);
SELECT * FROM users WHERE email_domain = 'example.com';  -- Uses index!
```

**Key Takeaway:** Avoid LIKE with leading wildcards on large tables. Use full-text search indexes for substring matching. Consider computed columns or denormalization for common search patterns. When leading characters are known, structure queries to enable index usage.

---

## 18. Storing Files in Database as BLOBs

**Description:** Storing large files (images, PDFs, videos) as BLOBs inflates database size, slows backups, prevents CDN caching, and complicates scaling.

**Bad Schema Example:**
```sql
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255),
    content_type VARCHAR(100),
    file_data BYTEA  -- Entire file stored in database!
);

-- Database grows massive
-- Backups take hours
-- No CDN/caching possible
-- Memory issues when querying
```

**Good Schema Example:**
```sql
CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT,
    storage_path VARCHAR(500) NOT NULL,  -- S3, disk path, CDN URL
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Store file metadata, actual file on object storage
-- Example storage_path: 's3://my-bucket/documents/2025/12/abc123.pdf'
-- Example storage_path: '/var/files/documents/abc123.pdf'
```

**Best Practices:**
```sql
-- Store file references with checksums
CREATE TABLE documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    filename VARCHAR(255) NOT NULL,
    content_type VARCHAR(100) NOT NULL,
    file_size BIGINT NOT NULL,
    storage_key VARCHAR(500) NOT NULL UNIQUE,  -- S3 key
    sha256_checksum CHAR(64) NOT NULL,  -- Verify integrity
    upload_complete BOOLEAN DEFAULT false,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by INTEGER REFERENCES users(id)
);

-- Index for listing user's files
CREATE INDEX idx_documents_created_by ON documents(created_by);
```

**Key Takeaway:** Store files in object storage (S3, Azure Blob, Google Cloud Storage) or filesystem. Store only file metadata (name, size, type, path, checksum) in the database. This enables CDN caching, independent scaling, efficient backups, parallel uploads/downloads, and cost-effective storage.

---

## 19. Using Cursors for Set-Based Operations

**Description:** Processing data row-by-row with cursors instead of using set-based SQL operations is dramatically slower and uses more resources.

**Bad Code Example (SQL Server):**
```sql
-- Cursor-based update (slow)
DECLARE @user_id INT
DECLARE @order_count INT

DECLARE user_cursor CURSOR FOR
    SELECT id FROM users

OPEN user_cursor
FETCH NEXT FROM user_cursor INTO @user_id

WHILE @@FETCH_STATUS = 0
BEGIN
    SELECT @order_count = COUNT(*) FROM orders WHERE user_id = @user_id
    UPDATE users SET order_count = @order_count WHERE id = @user_id

    FETCH NEXT FROM user_cursor INTO @user_id
END

CLOSE user_cursor
DEALLOCATE user_cursor
```

**Good Code Example:**
```sql
-- Set-based update (fast)
UPDATE users u
SET order_count = (
    SELECT COUNT(*)
    FROM orders o
    WHERE o.user_id = u.id
);

-- Or with CTE
WITH order_counts AS (
    SELECT user_id, COUNT(*) as cnt
    FROM orders
    GROUP BY user_id
)
UPDATE users u
SET order_count = oc.cnt
FROM order_counts oc
WHERE u.id = oc.user_id;
```

**Performance Comparison:**
- Cursor: 100,000 rows in ~60 seconds
- Set-based: 100,000 rows in <1 second

**Key Takeaway:** Avoid cursors for data manipulation. Use set-based SQL operations (UPDATE, INSERT, DELETE with JOINs, subqueries, CTEs). Cursors are acceptable only for admin tasks or when procedural logic is truly required (rare). Set-based operations leverage query optimization and are 10-100x faster.

---

## 20. Not Validating Data at Database Level

**Description:** Relying solely on application-layer validation allows invalid data to enter through direct database access, bulk imports, or bugs. Database constraints provide the last line of defense.

**Bad Schema Example:**
```sql
-- No constraints - relies on application validation
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255),  -- Can be NULL, duplicate, invalid
    age INTEGER,  -- Can be negative, NULL, 999
    status VARCHAR(50),  -- Can be 'acitve' (typo), any value
    created_at TIMESTAMP
);
```

**Good Schema Example:**
```sql
-- Database-enforced constraints
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL UNIQUE,
    age INTEGER NOT NULL CHECK (age >= 0 AND age <= 150),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT chk_valid_email CHECK (email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}$'),
    CONSTRAINT chk_valid_status CHECK (status IN ('active', 'inactive', 'suspended'))
);

-- Modern constraint syntax (PostgreSQL 12+)
CREATE TABLE products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL CHECK (LENGTH(TRIM(name)) > 0),
    price DECIMAL(10,2) NOT NULL CHECK (price > 0),
    discount_percent INTEGER CHECK (discount_percent BETWEEN 0 AND 100),
    stock_quantity INTEGER NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0)
);
```

**Additional Constraints:**
```sql
-- Ensure at least one contact method provided
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    email VARCHAR(255),
    phone VARCHAR(20),
    CONSTRAINT chk_has_contact CHECK (
        email IS NOT NULL OR phone IS NOT NULL
    )
);

-- Ensure date ranges are valid
CREATE TABLE bookings (
    id SERIAL PRIMARY KEY,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    CONSTRAINT chk_valid_date_range CHECK (end_date > start_date)
);
```

**Key Takeaway:** Always add database constraints (NOT NULL, UNIQUE, CHECK, FOREIGN KEY). This prevents invalid data regardless of entry point, documents business rules in schema, enables database-level optimization, and provides defense-in-depth validation strategy.

---

## Detection and Prevention

### Automated Detection Tools

**ORM Query Monitoring:**
- Bullet gem (Rails): Detects N+1 queries in development
- django-debug-toolbar (Django): Shows all queries executed
- TypeORM logging: Enable query logging to spot patterns

**Database-Specific Tools:**
- SQL Server: Extended Events with query_antipattern event
- PostgreSQL: pg_stat_statements, auto_explain module
- MySQL: slow query log, performance schema

**APM and Monitoring:**
- Scout APM, New Relic, DataDog: Track query performance
- Sentry: Detects N+1 query performance issues

### Query Analysis Queries

**Find Missing Indexes (PostgreSQL):**
```sql
SELECT
    schemaname,
    tablename,
    seq_scan,
    seq_tup_read,
    idx_scan,
    seq_tup_read / seq_scan AS avg_rows_per_scan
FROM pg_stat_user_tables
WHERE seq_scan > 0
  AND seq_tup_read / seq_scan > 10000
ORDER BY seq_tup_read DESC;
```

**Find Unused Indexes (SQL Server):**
```sql
SELECT
    OBJECT_NAME(i.object_id) AS table_name,
    i.name AS index_name,
    i.type_desc,
    us.user_seeks,
    us.user_scans,
    us.user_lookups,
    us.user_updates
FROM sys.indexes i
LEFT JOIN sys.dm_db_index_usage_stats us
    ON i.object_id = us.object_id AND i.index_id = us.index_id
WHERE OBJECTPROPERTY(i.object_id, 'IsUserTable') = 1
  AND i.index_id > 0
  AND us.user_seeks + us.user_scans + us.user_lookups = 0
ORDER BY us.user_updates DESC;
```

### Best Practices Summary

1. **Design Phase:**
   - Normalize to 3NF, denormalize only with evidence
   - Define all constraints (FK, CHECK, NOT NULL, UNIQUE)
   - Choose appropriate data types (DECIMAL for money, DATE/DATETIME correctly)
   - Avoid EAV, polymorphic associations, comma-separated lists

2. **Development Phase:**
   - Enable ORM query logging in development
   - Use eager loading for related data
   - Write explicit SELECT column lists
   - Use transactions for multi-step operations
   - Match parameter types to column types

3. **Indexing Strategy:**
   - Index foreign keys (especially in SQL Server)
   - Index columns in WHERE, JOIN, ORDER BY clauses
   - Avoid over-indexing low-cardinality columns
   - Monitor and remove unused indexes

4. **Review Phase:**
   - Run EXPLAIN/EXPLAIN ANALYZE on queries
   - Check for table scans on large tables
   - Verify index usage with database statistics
   - Test queries with production-scale data

5. **Monitoring Phase:**
   - Track slow queries with thresholds
   - Monitor index usage statistics
   - Set up alerts for N+1 query patterns
   - Review execution plans regularly

---

## Conclusion

SQL anti-patterns typically emerge from prioritizing short-term convenience over long-term maintainability, performance, and data integrity. The patterns documented here represent decades of collective experience identifying what doesn't work well at scale.

Key principles to remember:
- **Data integrity belongs in the database**, not just application code
- **Query performance comes from proper indexing and set-based operations**, not hardware alone
- **Schema design impacts every query forever**; invest time upfront in normalization and constraints
- **Type safety prevents bugs**; use appropriate data types and avoid generic TEXT/VARCHAR columns
- **Explicit is better than implicit**; name columns, define constraints, document relationships

When you encounter legacy systems with these anti-patterns, prioritize fixes based on impact: start with missing indexes on high-traffic queries, add critical foreign keys, fix N+1 queries in hot code paths, and gradually normalize wide tables over time.

The goal is not perfection but continuous improvement. Modern databases provide excellent tools for detecting anti-patterns - use them proactively in development and staging environments to prevent issues before they reach production.
