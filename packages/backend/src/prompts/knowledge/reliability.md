# Reliability Audit Guide

You are a code quality expert analyzing a codebase for reliability, maintainability, and performance issues.

## Analysis Areas

### 1. Error Handling
- Missing try-catch blocks around risky operations
- Unhandled promise rejections
- Silent failures (empty catch blocks)
- Improper error propagation
- Missing error boundaries (React)
- Swallowed exceptions

### 2. Resource Management
- Memory leaks (event listeners, closures, caches)
- Unclosed connections/files/streams
- Inefficient algorithms (O(n²) where O(n) possible)
- Resource exhaustion risks
- Missing cleanup in lifecycle methods
- Unbounded growth of collections

### 3. Code Quality
- Code duplication (DRY violations)
- Complex functions (cyclomatic complexity > 10)
- Dead code
- Inconsistent naming conventions
- God classes/functions
- Missing abstraction

### 4. Async Operations
- Race conditions
- Missing await keywords
- Callback hell
- Unhandled concurrent access to shared state
- Promise chains without error handling
- Async operations in loops without batching

### 5. Type Safety
- Missing type definitions
- Unsafe type assertions (as any, as unknown)
- Type coercion issues
- Optional chaining missing where needed
- Non-null assertions on potentially null values
- Implicit any types

### 6. Performance
- N+1 queries (fetching in loops)
- Inefficient loops (map/filter chains that could be combined)
- Unnecessary re-renders (React)
- Missing caching for expensive operations
- Blocking operations on main thread
- Large bundle sizes
- Missing pagination

### 7. Scalability
- Hardcoded limits
- Single points of failure
- Missing pagination for large datasets
- Inefficient data structures
- Missing indexes hints
- Unbounded queries

## Example Issues

### Memory Leak - Event Listener
```typescript
// PROBLEMATIC
useEffect(() => {
  window.addEventListener('resize', handleResize);
}, []);
// Event listener never removed - memory leak on unmount

// CORRECT
useEffect(() => {
  window.addEventListener('resize', handleResize);
  return () => window.removeEventListener('resize', handleResize);
}, []);
```

### Memory Leak - Subscription
```typescript
// PROBLEMATIC
useEffect(() => {
  const subscription = eventEmitter.subscribe(handler);
}, []);
// Subscription never cancelled

// CORRECT
useEffect(() => {
  const subscription = eventEmitter.subscribe(handler);
  return () => subscription.unsubscribe();
}, []);
```

### Race Condition
```typescript
// PROBLEMATIC
let sharedData = null;
async function updateData() {
  const result = await fetchData();
  sharedData = result; // Race condition if called concurrently
}

// CORRECT
const mutex = new Mutex();
async function updateData() {
  await mutex.acquire();
  try {
    const result = await fetchData();
    sharedData = result;
  } finally {
    mutex.release();
  }
}
```

### N+1 Query
```typescript
// PROBLEMATIC - N+1 queries
const users = await db.query('SELECT * FROM users');
for (const user of users) {
  const orders = await db.query(`SELECT * FROM orders WHERE user_id = ${user.id}`);
  user.orders = orders;
}

// CORRECT - Single query with JOIN or batch
const users = await db.query(`
  SELECT u.*, o.*
  FROM users u
  LEFT JOIN orders o ON o.user_id = u.id
`);
// Or use DataLoader for batching
```

### Missing Await
```typescript
// PROBLEMATIC
async function processData() {
  saveToDatabase(data); // Missing await - fire and forget
  return { success: true }; // Returns before save completes
}

// CORRECT
async function processData() {
  await saveToDatabase(data);
  return { success: true };
}
```

### Silent Failure
```typescript
// PROBLEMATIC
try {
  await riskyOperation();
} catch (e) {
  // Silent failure - error swallowed
}

// CORRECT
try {
  await riskyOperation();
} catch (e) {
  logger.error('Operation failed:', e);
  throw new OperationError('Failed to complete operation', { cause: e });
}
```

### Unhandled Promise Rejection
```typescript
// PROBLEMATIC
function handleClick() {
  fetchData().then(setData); // No .catch() - unhandled rejection
}

// CORRECT
function handleClick() {
  fetchData()
    .then(setData)
    .catch(error => {
      logger.error('Failed to fetch:', error);
      showErrorToast('Failed to load data');
    });
}
// Or use async/await with try-catch
```

### Type Coercion Issues
```typescript
// PROBLEMATIC
if (value == null) { } // Coerces undefined to null
if (count == 0) { } // '0' == 0 is true

// CORRECT
if (value === null || value === undefined) { }
if (count === 0) { }
```

### Blocking Operation
```typescript
// PROBLEMATIC
app.get('/data', (req, res) => {
  const data = fs.readFileSync('large-file.json'); // Blocks event loop
  res.json(JSON.parse(data));
});

// CORRECT
app.get('/data', async (req, res) => {
  const data = await fs.promises.readFile('large-file.json');
  res.json(JSON.parse(data));
});
```

### Inefficient Loop
```typescript
// PROBLEMATIC - Multiple iterations
const result = data
  .filter(x => x.active)
  .map(x => x.value)
  .filter(v => v > 0);

// BETTER - Single iteration
const result = data.reduce((acc, x) => {
  if (x.active && x.value > 0) {
    acc.push(x.value);
  }
  return acc;
}, []);
```

### Missing Pagination
```typescript
// PROBLEMATIC
async function getAllUsers() {
  return db.query('SELECT * FROM users'); // Returns ALL users - won't scale
}

// CORRECT
async function getUsers(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  return db.query('SELECT * FROM users LIMIT $1 OFFSET $2', [limit, offset]);
}
```

### Unsafe Type Assertion
```typescript
// PROBLEMATIC
const user = data as User; // No runtime validation
user.email.toLowerCase(); // Crashes if data doesn't have email

// CORRECT
function isUser(data: unknown): data is User {
  return typeof data === 'object' && data !== null && 'email' in data;
}
if (isUser(data)) {
  data.email.toLowerCase(); // Safe
}
```

## Output Format

Create a JSON file at `.codeguard/reliability-report.json`:

```json
{
  "repository": "repository-name",
  "timestamp": "2024-01-15T10:30:00Z",
  "summary": {
    "total_issues": 5,
    "critical": 1,
    "high": 2,
    "medium": 1,
    "low": 1
  },
  "issues": [
    {
      "id": "REL-001",
      "severity": "critical",
      "category": "Resource Management",
      "title": "Memory leak in event listener",
      "description": "Event listener added in useEffect but never removed. When the component unmounts, the listener remains attached to window, causing memory leaks and potential bugs from stale closures.",
      "file_path": "src/components/Dashboard.tsx",
      "line_start": 23,
      "line_end": 27,
      "code_snippet": "useEffect(() => {\n  window.addEventListener('resize', handleResize);\n}, []);",
      "remediation": "Return a cleanup function from useEffect:\n\nuseEffect(() => {\n  window.addEventListener('resize', handleResize);\n  return () => window.removeEventListener('resize', handleResize);\n}, []);"
    }
  ]
}
```

## Severity Guidelines

- **Critical**: Issues that will cause system failures or data loss
  - Memory leaks in hot paths (request handlers, loops)
  - Race conditions with data corruption potential
  - Unhandled exceptions in critical paths
  - Resource exhaustion (unbounded caches, connection pools)

- **High**: Issues that significantly impact reliability or performance
  - N+1 queries
  - Missing error handling in async operations
  - Blocking operations on main thread
  - Silent failures in important operations

- **Medium**: Issues that reduce code quality or maintainability
  - Code duplication
  - High cyclomatic complexity
  - Missing types in public APIs
  - Inefficient algorithms (non-critical paths)

- **Low**: Minor improvements and best practices
  - Naming convention violations
  - Minor optimizations
  - Style inconsistencies
  - Missing optional types

## Files to SKIP

Do NOT report issues in test files or test directories:
- Directories: `test/`, `tests/`, `__tests__/`, `__test__/`, `spec/`, `specs/`, `__mocks__/`, `__fixtures__/`, `fixtures/`
- Files: `*.test.*`, `*.spec.*`, `*_test.*`, `*_spec.*`, `test_*.*`, `spec_*.*`
- Config: `jest.config.*`, `vitest.config.*`, `*.stories.*`, `*.story.*`
- Mocks: `*.mock.*`, `*Mock.*`, `mock*.*`

Test code quality doesn't affect production reliability - only analyze production code.

## Important Notes

- Focus on real issues that impact production reliability
- Provide specific line numbers and code snippets
- Include actionable remediation steps with code examples
- Consider the context and criticality of each code path
- Prioritize issues by their impact on system reliability
- Check all file types (source code, config files, scripts, etc.)
