import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-mcp-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import {
  createSession,
  insertDecision,
  insertLearning,
  incrementLearningReference,
  getActiveDecisions,
  getTopLearnings,
  getSessionMetrics,
  insertMetric,
  searchMemory,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('MCP Server Data Layer', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('autoclaude_search (via searchMemory)', () => {
    it('should return empty results for empty DB', () => {
      const results = searchMemory('test query', 'all', 5);
      assert.equal(results.length, 0);
    });

    it('should find decisions via FTS', () => {
      createSession('mcp-test-1', '/test/project');
      insertDecision({
        session_id: 'mcp-test-1',
        project_path: '/test/project',
        category: 'architecture',
        decision: 'Adopt serverless deployment strategy',
        rationale: 'Cost efficiency and scalability',
        files_affected: null,
        supersedes_id: null,
      });

      const results = searchMemory('serverless deployment', 'decisions', 5);
      assert.ok(results.length >= 1, 'Should find the decision');
      assert.equal(results[0].source, 'decisions');
    });

    it('should filter by category', () => {
      const sessResults = searchMemory('serverless', 'sessions', 5);
      const decResults = searchMemory('serverless', 'decisions', 5);
      assert.equal(sessResults.length, 0);
      assert.ok(decResults.length >= 1);
    });
  });

  describe('record_decision (via insertDecision)', () => {
    it('should insert and retrieve decisions', () => {
      const id = insertDecision({
        session_id: 'mcp-test-1',
        project_path: '/test/project',
        category: 'library',
        decision: 'Use Zod for schema validation',
        rationale: 'TypeScript-first, small bundle',
        files_affected: JSON.stringify(['package.json']),
        supersedes_id: null,
      });
      assert.ok(id > 0, 'Should return a positive ID');

      const decisions = getActiveDecisions('/test/project');
      const found = decisions.find((d) => d.decision.includes('Zod'));
      assert.ok(found, 'Should find the decision');
    });
  });

  describe('record_learning (via insertLearning)', () => {
    it('should insert learning with relevance score', () => {
      const id = insertLearning({
        session_id: 'mcp-test-1',
        project_path: '/test/project',
        category: 'gotcha',
        learning: 'better-sqlite3 requires node-gyp on install',
        context: 'CI pipeline was failing',
        relevance_score: 1.0,
        times_referenced: 0,
      });
      assert.ok(id > 0);
    });

    it('should increment reference count', () => {
      const learnings = getTopLearnings('/test/project', 10);
      const learning = learnings.find((l) => l.learning.includes('node-gyp'));
      assert.ok(learning);
      const originalRefs = learning!.times_referenced;

      incrementLearningReference(learning!.id!);

      const updated = getTopLearnings('/test/project', 10);
      const updatedLearning = updated.find((l) =>
        l.learning.includes('node-gyp'),
      );
      assert.equal(updatedLearning!.times_referenced, originalRefs + 1);
    });
  });

  describe('autoclaude_metrics (via getSessionMetrics)', () => {
    it('should record and retrieve metrics', () => {
      insertMetric('mcp-test-1', 'tool_calls', 5);
      insertMetric('mcp-test-1', 'context_utilization', 0.45);

      const metrics = getSessionMetrics('mcp-test-1');
      assert.ok(metrics.length >= 2);
      const toolCalls = metrics.find((m) => m.metric_name === 'tool_calls');
      assert.ok(toolCalls);
      assert.equal(toolCalls!.metric_value, 5);
    });
  });
});
