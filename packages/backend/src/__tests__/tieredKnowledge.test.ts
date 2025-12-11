import { describe, it, expect } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { getTieredKnowledge, StackType } from '../prompts/tieredKnowledge.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const fixturesDir = path.join(__dirname, 'fixtures');

describe('Stack Detection', () => {
  describe('Kafka detection', () => {
    it('should detect Kafka stack from kafkajs imports', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'kafka-app'));

      expect(result.detectedStack.types.has(StackType.KAFKA)).toBe(true);
    });

    it('should include Kafka-specific knowledge files in tier2', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'kafka-app'));

      const kafkaFiles = result.tier2.filter(f => f.path.includes('kafka'));
      expect(kafkaFiles.length).toBeGreaterThan(0);
    });
  });

  describe('Database detection', () => {
    it('should detect Database stack from drizzle imports', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'sql-app'));

      expect(result.detectedStack.types.has(StackType.DATABASE_SQL)).toBe(true);
    });

    it('should include database-specific knowledge files in tier2', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'sql-app'));

      const dbFiles = result.tier2.filter(f =>
        f.path.includes('connection-pools') ||
        f.path.includes('sql-antipatterns') ||
        f.path.includes('schema-design')
      );
      expect(dbFiles.length).toBeGreaterThan(0);
    });
  });

  describe('Clean app (no special stack)', () => {
    it('should not detect Kafka stack for clean app', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'clean-app'));

      expect(result.detectedStack.types.has(StackType.KAFKA)).toBe(false);
    });

    it('should not detect Database stack for clean app', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'clean-app'));

      expect(result.detectedStack.types.has(StackType.DATABASE_SQL)).toBe(false);
    });

    it('should still include tier1 files for clean app', async () => {
      const result = await getTieredKnowledge(path.join(fixturesDir, 'clean-app'));

      expect(result.tier1.length).toBeGreaterThan(0);
    });
  });

  describe('Token estimation', () => {
    it('should estimate more tokens for Kafka app than clean app', async () => {
      const kafkaResult = await getTieredKnowledge(path.join(fixturesDir, 'kafka-app'));
      const cleanResult = await getTieredKnowledge(path.join(fixturesDir, 'clean-app'));

      expect(kafkaResult.tokenEstimate).toBeGreaterThan(cleanResult.tokenEstimate);
    });
  });
});
