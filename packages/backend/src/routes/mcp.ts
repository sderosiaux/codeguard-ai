import { Router, Request, Response } from 'express';
import Anthropic from '@anthropic-ai/sdk';
import { db } from '../db/index.js';
import { apiTokens, repositories, issues, workspaceMembers } from '../db/schema.js';
import { eq, and } from 'drizzle-orm';
import crypto from 'crypto';

const router = Router();

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// MCP Server metadata
const MCP_SERVER_INFO = {
  name: 'codeguard-ai',
  version: '1.0.0',
  protocolVersion: '2024-11-05',
};

// Tool definitions
const TOOLS = [
  {
    name: 'scan_code',
    description: 'Scan source code for security vulnerabilities and code quality issues. Returns a list of issues with severity, description, and remediation suggestions.',
    inputSchema: {
      type: 'object',
      properties: {
        code: {
          type: 'string',
          description: 'The source code to analyze',
        },
        language: {
          type: 'string',
          description: 'Programming language (e.g., javascript, python, java, go, rust, typescript)',
        },
        filename: {
          type: 'string',
          description: 'Optional filename for context',
        },
      },
      required: ['code', 'language'],
    },
  },
  {
    name: 'list_repositories',
    description: 'List all repositories in the workspace that have been analyzed',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_repository_issues',
    description: 'Get security issues for a specific repository by ID',
    inputSchema: {
      type: 'object',
      properties: {
        repositoryId: {
          type: 'number',
          description: 'The repository ID',
        },
        severity: {
          type: 'string',
          enum: ['critical', 'high', 'medium', 'low'],
          description: 'Filter by severity level',
        },
      },
      required: ['repositoryId'],
    },
  },
];

// Hash a token for comparison
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Authenticate bearer token
async function authenticateToken(authHeader: string | undefined): Promise<{ userId: string; workspaceId: string } | null> {
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  const tokenHash = hashToken(token);

  const [tokenRecord] = await db
    .select()
    .from(apiTokens)
    .where(eq(apiTokens.tokenHash, tokenHash));

  if (!tokenRecord) {
    return null;
  }

  // Check expiration
  if (tokenRecord.expiresAt && tokenRecord.expiresAt < new Date()) {
    return null;
  }

  // Update last used
  await db
    .update(apiTokens)
    .set({ lastUsedAt: new Date() })
    .where(eq(apiTokens.id, tokenRecord.id));

  return {
    userId: tokenRecord.userId,
    workspaceId: tokenRecord.workspaceId,
  };
}

// JSON-RPC response helpers
function jsonRpcSuccess(id: string | number | null, result: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

function jsonRpcError(id: string | number | null, code: number, message: string, data?: unknown) {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, data },
  };
}

// Build analysis prompt
function buildAnalysisPrompt(code: string, language: string, filename?: string): string {
  return `You are a security auditor analyzing code for potential vulnerabilities.

## Code to Analyze

### ${filename || `code.${language}`}
\`\`\`${language}
${code.substring(0, 15000)}
\`\`\`

## Your Task

Analyze this code for security vulnerabilities and code quality issues. Focus on:

1. **Security Issues**
   - SQL/NoSQL injection
   - XSS vulnerabilities
   - Authentication/authorization flaws
   - Hardcoded secrets
   - Command injection
   - Path traversal
   - Insecure cryptography

2. **Code Quality**
   - Error handling issues
   - Resource leaks
   - Race conditions
   - Null pointer risks

## Output Format

Return ONLY a JSON object with this exact structure (no markdown, no explanation):

{
  "issues": [
    {
      "id": "SEC-001",
      "severity": "critical|high|medium|low",
      "category": "Security|Input Validation|Authentication|Cryptography|Error Handling|Code Quality",
      "title": "Brief title",
      "description": "Detailed description of the issue",
      "lineStart": 10,
      "lineEnd": 15,
      "suggestion": "How to fix this issue"
    }
  ]
}

## Severity Guidelines

- **critical**: Easily exploitable, high impact (RCE, SQL injection, auth bypass)
- **high**: Serious issues requiring attention (XSS, CSRF, data exposure)
- **medium**: Issues requiring specific conditions (weak crypto, missing validation)
- **low**: Best practice violations (info disclosure, missing headers)

Return ONLY valid JSON. No markdown code blocks, no explanations.`;
}

// Tool handlers
async function handleScanCode(args: { code: string; language: string; filename?: string }) {
  const prompt = buildAnalysisPrompt(args.code, args.language, args.filename);

  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }],
  });

  const textContent = message.content.find((block: { type: string }) => block.type === 'text');
  if (!textContent || textContent.type !== 'text') {
    throw new Error('No text response from analysis');
  }

  // Parse JSON response
  let jsonStr = textContent.text.trim();
  if (jsonStr.startsWith('```json')) jsonStr = jsonStr.slice(7);
  else if (jsonStr.startsWith('```')) jsonStr = jsonStr.slice(3);
  if (jsonStr.endsWith('```')) jsonStr = jsonStr.slice(0, -3);
  jsonStr = jsonStr.trim();

  try {
    const result = JSON.parse(jsonStr);
    return result;
  } catch {
    return { issues: [], error: 'Failed to parse analysis results' };
  }
}

async function handleListRepositories(workspaceId: string) {
  const repos = await db
    .select({
      id: repositories.id,
      name: repositories.name,
      owner: repositories.owner,
      status: repositories.status,
      createdAt: repositories.createdAt,
    })
    .from(repositories)
    .where(eq(repositories.workspaceId, workspaceId));

  return { repositories: repos };
}

async function handleGetRepositoryIssues(workspaceId: string, args: { repositoryId: number; severity?: string }) {
  // Verify repository belongs to workspace
  const [repo] = await db
    .select()
    .from(repositories)
    .where(
      and(
        eq(repositories.id, args.repositoryId),
        eq(repositories.workspaceId, workspaceId)
      )
    );

  if (!repo) {
    throw new Error('Repository not found in this workspace');
  }

  let query = db
    .select()
    .from(issues)
    .where(eq(issues.repositoryId, args.repositoryId));

  const allIssues = await query;

  // Filter by severity if provided
  const filteredIssues = args.severity
    ? allIssues.filter(i => i.severity === args.severity)
    : allIssues;

  return {
    repository: {
      id: repo.id,
      name: repo.name,
      owner: repo.owner,
    },
    issues: filteredIssues,
    total: filteredIssues.length,
  };
}

// Main MCP endpoint - handles JSON-RPC 2.0 requests
router.post('/', async (req: Request, res: Response) => {
  const auth = await authenticateToken(req.headers.authorization);

  if (!auth) {
    return res.status(401).json(
      jsonRpcError(null, -32000, 'Unauthorized: Invalid or missing API token')
    );
  }

  const { jsonrpc, id, method, params } = req.body;

  // Validate JSON-RPC format
  if (jsonrpc !== '2.0') {
    return res.json(jsonRpcError(id, -32600, 'Invalid Request: Expected JSON-RPC 2.0'));
  }

  try {
    switch (method) {
      // MCP Protocol methods
      case 'initialize': {
        return res.json(jsonRpcSuccess(id, {
          protocolVersion: MCP_SERVER_INFO.protocolVersion,
          capabilities: {
            tools: {},
          },
          serverInfo: {
            name: MCP_SERVER_INFO.name,
            version: MCP_SERVER_INFO.version,
          },
        }));
      }

      case 'tools/list': {
        return res.json(jsonRpcSuccess(id, { tools: TOOLS }));
      }

      case 'tools/call': {
        const { name, arguments: args } = params || {};

        if (!name) {
          return res.json(jsonRpcError(id, -32602, 'Invalid params: tool name required'));
        }

        let result;
        switch (name) {
          case 'scan_code':
            if (!args?.code || !args?.language) {
              return res.json(jsonRpcError(id, -32602, 'Invalid params: code and language required'));
            }
            result = await handleScanCode(args);
            break;

          case 'list_repositories':
            result = await handleListRepositories(auth.workspaceId);
            break;

          case 'get_repository_issues':
            if (!args?.repositoryId) {
              return res.json(jsonRpcError(id, -32602, 'Invalid params: repositoryId required'));
            }
            result = await handleGetRepositoryIssues(auth.workspaceId, args);
            break;

          default:
            return res.json(jsonRpcError(id, -32601, `Method not found: tool ${name}`));
        }

        return res.json(jsonRpcSuccess(id, {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
        }));
      }

      case 'notifications/initialized':
      case 'ping': {
        return res.json(jsonRpcSuccess(id, {}));
      }

      default:
        return res.json(jsonRpcError(id, -32601, `Method not found: ${method}`));
    }
  } catch (error) {
    console.error('MCP error:', error);
    return res.json(jsonRpcError(id, -32603, error instanceof Error ? error.message : 'Internal error'));
  }
});

// GET endpoint for server info (convenience)
router.get('/', (_req: Request, res: Response) => {
  res.json({
    name: MCP_SERVER_INFO.name,
    version: MCP_SERVER_INFO.version,
    protocol: 'MCP (Model Context Protocol)',
    protocolVersion: MCP_SERVER_INFO.protocolVersion,
    documentation: 'https://security-guard-ai.vercel.app/docs/mcp',
    tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
  });
});

export default router;
