import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-export-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { handleExport } from '../src/cli/export';
import {
  createSession,
  insertDecision,
  insertLearning,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Export Command', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should export empty database successfully', async () => {
    const result = await handleExport({ session_id: 'export-test-1' });
    assert.equal(result.continue, true);

    const data = JSON.parse(
      result.hookSpecificOutput?.additionalContext || '{}',
    );
    assert.ok(data.exported_at, 'Should have exported_at timestamp');
    assert.ok(Array.isArray(data.sessions), 'Should have sessions array');
    assert.ok(Array.isArray(data.decisions), 'Should have decisions array');
    assert.ok(Array.isArray(data.learnings), 'Should have learnings array');
  });

  it('should include session data in export', async () => {
    createSession('export-sess-1', '/test/project');

    const result = await handleExport({ session_id: 'export-test-2' });
    const data = JSON.parse(
      result.hookSpecificOutput?.additionalContext || '{}',
    );

    assert.ok(data.sessions.length >= 1, 'Should have at least one session');
    const match = data.sessions.find(
      (s: { id: string }) => s.id === 'export-sess-1',
    );
    assert.ok(match, 'Should include our test session');
  });

  it('should include decisions in export', async () => {
    insertDecision({
      session_id: 'export-sess-1',
      project_path: '/test/project',
      category: 'architecture',
      decision: 'Use esbuild for bundling',
      rationale: 'Fast build times',
      files_affected: JSON.stringify(['esbuild.config.js']),
      supersedes_id: null,
    });

    const result = await handleExport({ session_id: 'export-test-3' });
    const data = JSON.parse(
      result.hookSpecificOutput?.additionalContext || '{}',
    );

    assert.ok(data.decisions.length >= 1, 'Should have at least one decision');
    const match = data.decisions.find(
      (d: { decision: string }) => d.decision === 'Use esbuild for bundling',
    );
    assert.ok(match, 'Should include our test decision');
  });

  it('should include learnings in export', async () => {
    insertLearning({
      session_id: 'export-sess-1',
      project_path: '/test/project',
      category: 'gotcha',
      learning: 'Always check for null before accessing properties',
      context: 'test context',
      relevance_score: 1.0,
      times_referenced: 0,
    });

    const result = await handleExport({ session_id: 'export-test-4' });
    const data = JSON.parse(
      result.hookSpecificOutput?.additionalContext || '{}',
    );

    assert.ok(data.learnings.length >= 1, 'Should have at least one learning');
    const match = data.learnings.find(
      (l: { learning: string }) =>
        l.learning === 'Always check for null before accessing properties',
    );
    assert.ok(match, 'Should include our test learning');
  });

  it('should always return continue: true', async () => {
    const result = await handleExport({ session_id: 'export-test-5' });
    assert.equal(result.continue, true);
  });
});
