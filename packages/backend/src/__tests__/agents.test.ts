import { describe, it, expect } from 'vitest';
import {
  tier1Agents,
  tier2Agents,
  getAgentsForStack,
  estimateTokensForAgents,
} from '../prompts/agents.js';

describe('Agent Configuration', () => {
  describe('Tier 1 agents', () => {
    it('should have exactly 3 tier 1 agents', () => {
      expect(tier1Agents).toHaveLength(3);
    });

    it('should include security, resilience, and concurrency agents', () => {
      const agentIds = tier1Agents.map(a => a.id);
      expect(agentIds).toContain('security');
      expect(agentIds).toContain('resilience');
      expect(agentIds).toContain('concurrency');
    });

    it('should all have tier "always"', () => {
      tier1Agents.forEach(agent => {
        expect(agent.tier).toBe('always');
      });
    });

    it('should all have unique output files', () => {
      const outputFiles = tier1Agents.map(a => a.outputFile);
      const uniqueFiles = new Set(outputFiles);
      expect(uniqueFiles.size).toBe(tier1Agents.length);
    });
  });

  describe('Tier 2 agents', () => {
    it('should include kafka, database, and distributed agents', () => {
      expect(tier2Agents.kafka).toBeDefined();
      expect(tier2Agents.database).toBeDefined();
      expect(tier2Agents.distributed).toBeDefined();
    });

    it('should all have tier "stack-based"', () => {
      Object.values(tier2Agents).forEach(agent => {
        expect(agent.tier).toBe('stack-based');
      });
    });

    it('kafka agent should have knowledge files', () => {
      expect(tier2Agents.kafka.knowledgeFiles.length).toBeGreaterThan(0);
    });
  });

  describe('getAgentsForStack', () => {
    it('should return tier1 agents for empty stack', () => {
      const agents = getAgentsForStack(new Set());
      expect(agents).toHaveLength(3);
      expect(agents.every(a => a.tier === 'always')).toBe(true);
    });

    it('should add kafka agent when kafka stack detected', () => {
      const agents = getAgentsForStack(new Set(['kafka']));
      expect(agents.length).toBe(4);
      expect(agents.find(a => a.id === 'kafka')).toBeDefined();
    });

    it('should add database agent when database_sql stack detected', () => {
      const agents = getAgentsForStack(new Set(['database_sql']));
      expect(agents.length).toBe(4);
      expect(agents.find(a => a.id === 'database')).toBeDefined();
    });

    it('should not duplicate agents for related stacks', () => {
      const agents = getAgentsForStack(new Set(['distributed', 'consensus']));
      const distributedAgents = agents.filter(a => a.id === 'distributed');
      expect(distributedAgents).toHaveLength(1);
    });
  });

  describe('estimateTokensForAgents', () => {
    it('should return positive token count', () => {
      const estimate = estimateTokensForAgents(tier1Agents);
      expect(estimate).toBeGreaterThan(0);
    });

    it('should increase with more agents', () => {
      const tier1Estimate = estimateTokensForAgents(tier1Agents);
      const allAgents = [...tier1Agents, tier2Agents.kafka];
      const fullEstimate = estimateTokensForAgents(allAgents);
      expect(fullEstimate).toBeGreaterThan(tier1Estimate);
    });
  });
});
