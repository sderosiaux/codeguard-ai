import { securityPrompt } from './security.js';
import { reliabilityPrompt } from './reliability.js';

// Extract just the task content from each prompt (remove the "Begin now" instruction)
const securityTaskContent = securityPrompt.replace(/Begin your analysis now.*$/s, '').trim();
const reliabilityTaskContent = reliabilityPrompt.replace(/Begin your analysis now.*$/s, '').trim();

export const combinedAnalysisPrompt = `You are a code analysis expert performing both SECURITY and RELIABILITY audits of this codebase.

## CRITICAL: Execution Strategy

You MUST use the Task tool to spawn TWO parallel agents that will run simultaneously:
1. **Security Agent** - Analyzes vulnerabilities, writes to \`.codeguard/security-report.json\`
2. **Reliability Agent** - Analyzes code quality, writes to \`.codeguard/reliability-report.json\`

## Setup

First, create the output directory:
\`\`\`bash
mkdir -p .codeguard
\`\`\`

## Parallel Execution

Spawn BOTH agents in a SINGLE message with TWO Task tool calls. This runs them in parallel.

### Security Agent

Spawn with subagent_type="Explore" and this prompt:

\`\`\`
${securityTaskContent}

Begin your analysis now and write the results to .codeguard/security-report.json.
\`\`\`

### Reliability Agent

Spawn with subagent_type="Explore" and this prompt:

\`\`\`
${reliabilityTaskContent}

Begin your analysis now and write the results to .codeguard/reliability-report.json.
\`\`\`

## Execution Steps

1. Run \`mkdir -p .codeguard\`
2. Spawn BOTH agents in parallel (TWO Task tool calls in ONE message)
3. Wait for both to complete
4. Verify both JSON files exist

Begin now.`;
