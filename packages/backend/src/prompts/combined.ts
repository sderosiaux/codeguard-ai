import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  getTieredKnowledge,
  knowledgePaths,
} from './tieredKnowledge';
import type { TieredKnowledgeResult } from './tieredKnowledge';
import {
  tier1Agents,
  tier2Agents,
  stackToAgent,
  getAgentsForStack,
  estimateTokensForAgents,
  AgentDefinition,
} from './agents';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Knowledge files location
const knowledgeDir = path.join(__dirname, '..', '..', 'src', 'prompts', 'knowledge');
const securityPath = path.join(knowledgeDir, 'security.md');
const reliabilityPath = path.join(knowledgeDir, 'reliability.md');

// =============================================================================
// STATIC PROMPTS (for standalone use)
// =============================================================================

export const securityPrompt = fs.readFileSync(securityPath, 'utf-8');
export const reliabilityPrompt = fs.readFileSync(reliabilityPath, 'utf-8');

// =============================================================================
// MULTI-AGENT ORCHESTRATOR
// =============================================================================

export interface OrchestratorResult {
  prompt: string;
  agents: AgentDefinition[];
  tieredResult: TieredKnowledgeResult;
  tokenEstimate: number;
}

/**
 * Generate the orchestrator prompt that spawns specialized sub-agents.
 * Each agent has focused context (no pollution between domains).
 *
 * Architecture:
 * - Tier 1 (Always): Security, Resilience, Concurrency
 * - Tier 2 (Stack-based): Kafka, Database, Distributed Systems
 *
 * @param repoPath - Path to the repository being analyzed
 */
export async function generateOrchestratorPrompt(repoPath: string): Promise<OrchestratorResult> {
  const tieredResult = await getTieredKnowledge(repoPath);
  const detectedStacks = tieredResult.detectedStack.types;

  // Get agents to run
  const agents = getAgentsForStack(detectedStacks);
  const tokenEstimate = estimateTokensForAgents(agents);

  // Build agent spawn instructions
  const tier1Instructions = agents
    .filter(a => a.tier === 'always')
    .map(a => `### Agent: ${a.name}
- **ID:** ${a.id}
- **Focus:** ${a.description}
- **Output:** ${a.outputFile}
- **Prompt:**
\`\`\`
${a.prompt}
\`\`\``)
    .join('\n\n');

  const tier2Agents = agents.filter(a => a.tier === 'stack-based');
  const tier2Instructions = tier2Agents.length > 0
    ? tier2Agents.map(a => `### Agent: ${a.name}
- **ID:** ${a.id}
- **Focus:** ${a.description}
- **Output:** ${a.outputFile}
- **Prompt:**
\`\`\`
${a.prompt}
\`\`\``)
    .join('\n\n')
    : 'No stack-specific agents needed based on detection.';

  const prompt = `# Code Analysis Orchestrator

You are an orchestrator that spawns specialized analysis agents. Each agent has focused expertise and isolated context to avoid pollution between domains.

## Detected Stack
${Array.from(detectedStacks).join(', ') || 'Generic'}

## Token Budget
- Estimated: ~${tokenEstimate.toLocaleString()} tokens across ${agents.length} agents

## Setup

\`\`\`bash
mkdir -p .codeguard
\`\`\`

## Tier 1: Core Agents (Always Run)

These agents run on every codebase:

${tier1Instructions}

## Tier 2: Specialized Agents (Stack-Based)

${tier2Instructions}

## Execution Plan

1. Create \`.codeguard/\` directory
2. Spawn **ALL ${agents.length} agents in parallel** using the Task tool:
${agents.map(a => `   - ${a.name} → ${a.outputFile}`).join('\n')}
3. Wait for all agents to complete
4. Verify all report files exist

## IMPORTANT

- Spawn ALL agents in a **SINGLE message** with **${agents.length} Task tool calls**
- Each agent reads ONLY its own knowledge files (no cross-domain reading)
- Each agent writes to its own output file
- Do NOT merge reports - keep them separate

## Begin

Execute the plan now. Spawn all ${agents.length} agents in parallel.
`;

  return {
    prompt,
    agents,
    tieredResult,
    tokenEstimate,
  };
}

/**
 * Get just the tiered knowledge result without generating the full prompt.
 * Useful for logging/debugging what would be loaded.
 */
export async function analyzeTechStack(repoPath: string): Promise<TieredKnowledgeResult> {
  return getTieredKnowledge(repoPath);
}

// =============================================================================
// EXPORTS
// =============================================================================

export {
  getTieredKnowledge,
  knowledgePaths,
  tier1Agents,
  tier2Agents,
  stackToAgent,
  getAgentsForStack,
  estimateTokensForAgents,
};
export type { TieredKnowledgeResult, AgentDefinition };
