import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Override DB path before importing modules
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { estimateUtilization } from '../src/core/metrics';
import {
  createSession,
  insertMetric,
  getSessionMetrics,
  updateSession,
  getSession,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Metrics', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('estimateUtilization', () => {
    it('should estimate utilization from a transcript file', () => {
      // Create a mock transcript file
      const transcriptPath = path.join(TEST_DIR, 'transcript.jsonl');
      // Write ~4000 bytes (should be ~1000 tokens)
      const content = 'x'.repeat(4000);
      fs.writeFileSync(transcriptPath, content);

      const result = estimateUtilization(transcriptPath);
      assert.equal(result.bytes, 4000);
      assert.equal(result.estimatedTokens, 1000);
      // 4000 bytes / (200000 * 4 bytes) = 0.005
      assert.ok(
        Math.abs(result.utilization - 0.005) < 0.001,
        `Expected utilization ~0.005, got ${result.utilization}`,
      );
    });

    it('should return zeros for non-existent file', () => {
      const result = estimateUtilization('/nonexistent/path/transcript.jsonl');
      assert.equal(result.bytes, 0);
      assert.equal(result.estimatedTokens, 0);
      assert.equal(result.utilization, 0);
    });

    it('should return zeros for empty file', () => {
      const emptyPath = path.join(TEST_DIR, 'empty.jsonl');
      fs.writeFileSync(emptyPath, '');

      const result = estimateUtilization(emptyPath);
      assert.equal(result.bytes, 0);
      assert.equal(result.estimatedTokens, 0);
      assert.equal(result.utilization, 0);
    });

    it('should handle large transcript correctly', () => {
      const largePath = path.join(TEST_DIR, 'large.jsonl');
      // 400KB = ~100k tokens = 50% of 200k window
      const content = 'x'.repeat(400_000);
      fs.writeFileSync(largePath, content);

      const result = estimateUtilization(largePath);
      assert.equal(result.bytes, 400_000);
      assert.equal(result.estimatedTokens, 100_000);
      assert.ok(
        Math.abs(result.utilization - 0.5) < 0.001,
        `Expected utilization ~0.5, got ${result.utilization}`,
      );
    });
  });

  describe('Metric storage', () => {
    it('should insert and retrieve metrics', () => {
      const sessionId = 'metrics-test-session';
      createSession(sessionId, '/test/project');

      insertMetric(sessionId, 'context_utilization', 0.35);
      insertMetric(sessionId, 'tool_calls', 1);
      insertMetric(sessionId, 'context_utilization', 0.42);

      const metrics = getSessionMetrics(sessionId);
      assert.ok(metrics.length >= 3);

      const utilMetrics = metrics.filter(
        (m) => m.metric_name === 'context_utilization',
      );
      assert.ok(utilMetrics.length >= 2);
    });

    it('should track peak utilization on session', () => {
      const sessionId = 'metrics-peak-session';
      createSession(sessionId, '/test/project');

      // Simulate utilization tracking
      updateSession(sessionId, { context_utilization_peak: 0.45 });
      let session = getSession(sessionId);
      assert.equal(session?.context_utilization_peak, 0.45);

      // Update with higher peak
      updateSession(sessionId, { context_utilization_peak: 0.72 });
      session = getSession(sessionId);
      assert.equal(session?.context_utilization_peak, 0.72);
    });
  });
});
