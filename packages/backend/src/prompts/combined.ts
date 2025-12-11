import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Read markdown knowledge files (from src folder, not dist)
// Go up from dist/prompts to project root, then into src/prompts/knowledge
const knowledgeDir = path.join(__dirname, '..', '..', 'src', 'prompts', 'knowledge');
const securityKnowledge = fs.readFileSync(path.join(knowledgeDir, 'security.md'), 'utf-8');
const reliabilityKnowledge = fs.readFileSync(path.join(knowledgeDir, 'reliability.md'), 'utf-8');

export const combinedAnalysisPrompt = `You are a code analysis expert. Your task is to perform both **Security** and **Reliability** audits of this codebase simultaneously.

## Execution Strategy

You MUST spawn TWO parallel agents to analyze the codebase concurrently:
1. **Security Agent** - Analyzes for vulnerabilities → writes \`.codeguard/security-report.json\`
2. **Reliability Agent** - Analyzes for code quality issues → writes \`.codeguard/reliability-report.json\`

## Setup

First, create the output directory:
\`\`\`bash
mkdir -p .codeguard
\`\`\`

## Parallel Execution

Spawn BOTH agents in a **SINGLE message** with **TWO Task tool calls**. This runs them in parallel.

---

### Agent 1: Security Analysis

Use Task tool with subagent_type="Explore" and this prompt:

\`\`\`
${securityKnowledge}

Begin your analysis now and write results to .codeguard/security-report.json
\`\`\`

---

### Agent 2: Reliability Analysis

Use Task tool with subagent_type="Explore" and this prompt:

\`\`\`
${reliabilityKnowledge}

Begin your analysis now and write results to .codeguard/reliability-report.json
\`\`\`

---

## Completion

After both agents complete:
1. Verify \`.codeguard/security-report.json\` exists
2. Verify \`.codeguard/reliability-report.json\` exists
3. Report completion

Begin now.`;

// Export individual prompts for standalone use
export const securityPrompt = securityKnowledge + '\n\nBegin your analysis now and write results to .codeguard/security-report.json';
export const reliabilityPrompt = reliabilityKnowledge + '\n\nBegin your analysis now and write results to .codeguard/reliability-report.json';
