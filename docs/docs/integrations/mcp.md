# MCP Server Integration

CodeGuard AI provides a **Model Context Protocol (MCP)** server that allows you to integrate security scanning capabilities directly into AI-powered development tools like Claude Desktop, Cursor, and other MCP-compatible clients.

## What is MCP?

The [Model Context Protocol](https://modelcontextprotocol.io) is an open protocol that enables AI assistants to interact with external tools and data sources. By connecting CodeGuard AI as an MCP server, you can:

- Scan code snippets for vulnerabilities directly from your AI assistant
- Query your repository's security issues
- Get real-time security analysis while coding

## Prerequisites

Before you begin, you'll need:

1. A CodeGuard AI account with at least one workspace
2. An API token (create one in [Settings](/app/settings))
3. An MCP-compatible client (Claude Desktop, Cursor, etc.)

## Creating an API Token

1. Go to **Settings** (click your profile picture, then "Settings")
2. Under **API Tokens**, click **Create Token**
3. Give your token a descriptive name (e.g., "Claude Desktop")
4. Select the workspace you want to grant access to
5. Choose an expiration period or select "Never expires"
6. Click **Create Token**

!!! warning "Important"
    Copy your token immediately after creation. You won't be able to see it again!

## Server Configuration

The MCP server is available at:

```
https://security-guard-ai.vercel.app/api/mcp
```

Or if running locally:

```
http://localhost:3001/api/mcp
```

## Setting Up Claude Desktop

Add the following to your Claude Desktop configuration file:

=== "macOS"
    Edit `~/Library/Application Support/Claude/claude_desktop_config.json`

=== "Windows"
    Edit `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "codeguard-ai": {
      "command": "npx",
      "args": ["-y", "@anthropic-ai/mcp-remote", "https://security-guard-ai.vercel.app/api/mcp"],
      "env": {
        "MCP_HEADERS": "Authorization: Bearer YOUR_API_TOKEN_HERE"
      }
    }
  }
}
```

Replace `YOUR_API_TOKEN_HERE` with your actual API token.

## Setting Up Cursor

In Cursor, you can add the MCP server through the settings:

1. Open Cursor Settings
2. Navigate to **Features** > **MCP Servers**
3. Add a new server with:
   - **Name**: CodeGuard AI
   - **URL**: `https://security-guard-ai.vercel.app/api/mcp`
   - **Headers**: `Authorization: Bearer YOUR_API_TOKEN`

## Available Tools

The MCP server provides the following tools:

### `scan_code`

Analyze code for security vulnerabilities and code quality issues.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `code` | string | Yes | The source code to analyze |
| `language` | string | Yes | Programming language (javascript, python, java, go, rust, typescript) |
| `filename` | string | No | Optional filename for context |

**Example:**

```json
{
  "name": "scan_code",
  "arguments": {
    "code": "const query = `SELECT * FROM users WHERE id = ${userId}`",
    "language": "javascript",
    "filename": "database.js"
  }
}
```

**Response:**

```json
{
  "issues": [
    {
      "id": "SEC-001",
      "severity": "critical",
      "category": "Security",
      "title": "SQL Injection Vulnerability",
      "description": "User input is directly interpolated into SQL query without sanitization",
      "lineStart": 1,
      "lineEnd": 1,
      "suggestion": "Use parameterized queries or an ORM to prevent SQL injection"
    }
  ]
}
```

### `list_repositories`

List all repositories in your workspace that have been analyzed.

**Parameters:** None

**Response:**

```json
{
  "repositories": [
    {
      "id": 1,
      "name": "my-app",
      "owner": "username",
      "status": "completed",
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `get_repository_issues`

Get security issues for a specific repository.

**Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `repositoryId` | number | Yes | The repository ID |
| `severity` | string | No | Filter by severity (critical, high, medium, low) |

**Response:**

```json
{
  "repository": {
    "id": 1,
    "name": "my-app",
    "owner": "username"
  },
  "issues": [...],
  "total": 15
}
```

## Example Usage

Once configured, you can ask Claude or your AI assistant:

> "Scan this code for security issues: [paste code]"

> "What security vulnerabilities were found in my-app repository?"

> "List all my analyzed repositories"

The AI will use the MCP tools to fetch real-time data from CodeGuard AI.

## Protocol Details

The MCP server implements JSON-RPC 2.0 over HTTP POST. All requests require Bearer token authentication.

### Supported Methods

| Method | Description |
|--------|-------------|
| `initialize` | Initialize the MCP connection |
| `tools/list` | List available tools |
| `tools/call` | Execute a tool |
| `ping` | Health check |

### Example Request

```bash
curl -X POST https://security-guard-ai.vercel.app/api/mcp \
  -H "Authorization: Bearer cg_your_token_here" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "tools/list",
    "params": {}
  }'
```

## Troubleshooting

### Token Not Working

- Ensure your token hasn't expired
- Verify the token has access to the workspace you're trying to query
- Check that the Authorization header is formatted correctly: `Bearer <token>`

### Connection Errors

- Verify the server URL is correct
- Check your network connection
- Ensure your firewall allows outgoing connections to the API

### No Repositories Found

- Confirm you've analyzed at least one repository in the workspace
- Verify your token is associated with the correct workspace

## Rate Limits

API tokens are subject to the following rate limits:

- **Code scanning**: 100 requests per minute
- **Repository queries**: 1000 requests per minute

If you exceed these limits, you'll receive a `429 Too Many Requests` response.

## Security Best Practices

1. **Rotate tokens regularly**: Create new tokens periodically and revoke old ones
2. **Use expiring tokens**: Set an expiration date when possible
3. **Limit scope**: Create separate tokens for different use cases
4. **Never commit tokens**: Add `.env` files to `.gitignore`
5. **Monitor usage**: Check the "Last used" date in Settings to detect unauthorized use
