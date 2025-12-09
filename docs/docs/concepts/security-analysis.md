# Security Analysis

CodeGuard AI performs comprehensive security analysis across multiple categories.

## Analysis Categories

### Authentication & Authorization

Detects issues with user authentication and access control:

- Weak or missing authentication
- Insecure session management
- Authorization bypass vulnerabilities
- Insufficient access controls
- Hardcoded credentials

**Example Detection:**

```python
# Detected: Hardcoded credentials
def connect_to_database():
    password = "admin123"  # CRITICAL: Hardcoded password
    return db.connect(user="admin", password=password)
```

### Input Validation

Identifies injection and input handling vulnerabilities:

- SQL/NoSQL injection
- Cross-Site Scripting (XSS)
- Command injection
- Path traversal
- LDAP/XML injection

**Example Detection:**

```javascript
// Detected: SQL Injection
app.get('/user', (req, res) => {
  const query = `SELECT * FROM users WHERE id = ${req.params.id}`; // HIGH: SQL injection
  db.query(query);
});
```

### Cryptography

Finds cryptographic weaknesses:

- Weak encryption algorithms (MD5, SHA1, DES)
- Hardcoded secrets and API keys
- Insecure random number generation
- Missing encryption for sensitive data

**Example Detection:**

```python
# Detected: Weak hashing algorithm
import hashlib

def hash_password(password):
    return hashlib.md5(password.encode()).hexdigest()  # HIGH: MD5 is cryptographically weak
```

### API Security

Identifies API endpoint vulnerabilities:

- Missing rate limiting
- Excessive data exposure
- Insecure direct object references
- Missing input validation

**Example Detection:**

```typescript
// Detected: Missing rate limiting
app.post('/login', async (req, res) => {
  // MEDIUM: No rate limiting on authentication endpoint
  const { email, password } = req.body;
  const user = await authenticate(email, password);
});
```

### Error Handling

Detects error handling issues:

- Information leakage through error messages
- Missing error handling
- Insecure logging of sensitive data

**Example Detection:**

```javascript
// Detected: Information leakage
app.use((err, req, res, next) => {
  res.status(500).json({
    error: err.message,
    stack: err.stack  // HIGH: Stack trace exposed to client
  });
});
```

### Configuration

Finds configuration security issues:

- Debug mode in production
- Insecure default configurations
- Exposed sensitive endpoints
- Missing security headers

**Example Detection:**

```python
# Detected: Debug mode enabled
app = Flask(__name__)
app.config['DEBUG'] = True  # MEDIUM: Debug mode should be disabled in production
```

## Language-Specific Checks

### JavaScript/TypeScript

- `eval()` and `Function()` usage
- Prototype pollution
- DOM-based XSS
- Insecure `innerHTML` usage

### Python

- `pickle` deserialization
- `exec()` and `eval()` usage
- Unsafe YAML loading
- SQL injection in ORMs

### Go

- Unchecked errors
- Race conditions
- Unsafe pointer usage
- Hardcoded TLS configurations

### Java

- Deserialization vulnerabilities
- XXE in XML parsers
- LDAP injection
- Insecure reflection

## Custom Rules

CodeGuard AI adapts its analysis based on:

- Framework detection (Express, Django, Spring)
- Configuration files (package.json, requirements.txt)
- Project structure and patterns

This enables accurate detection of framework-specific vulnerabilities.
