import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-gc-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { handleGc } from '../src/cli/gc';
import {
  createSession,
  insertLearning,
  getTopLearnings,
  decayLearnings,
  garbageCollect,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Garbage Collection', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should decay learning relevance scores', () => {
    createSession('gc-test-1', '/test/project');
    insertLearning({
      session_id: 'gc-test-1',
      project_path: '/test/project',
      category: 'gotcha',
      learning: 'Always check null before accessing properties',
      context: 'Found bug in production',
      relevance_score: 1.0,
      times_referenced: 0,
    });

    decayLearnings(0.1); // 10% decay

    const learnings = getTopLearnings('/test/project', 10);
    assert.ok(learnings.length >= 1);
    assert.ok(
      learnings[0].relevance_score < 1.0,
      `Score should be decayed: ${learnings[0].relevance_score}`,
    );
    assert.ok(
      learnings[0].relevance_score >= 0.89,
      `Score should be ~0.9: ${learnings[0].relevance_score}`,
    );
  });

  it('should remove learnings below threshold', () => {
    createSession('gc-test-2', '/test/project');
    insertLearning({
      session_id: 'gc-test-2',
      project_path: '/test/project',
      category: 'pattern',
      learning: 'Old pattern that is no longer relevant',
      context: null,
      relevance_score: 0.01,
      times_referenced: 0,
    });

    const { removed } = garbageCollect(0.1);
    assert.ok(removed >= 1, `Should have removed at least 1 entry: ${removed}`);
  });

  it('should return status message from handleGc', async () => {
    const result = await handleGc({
      session_id: 'gc-test-1',
    });
    assert.equal(result.continue, true);
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    assert.ok(ctx.includes('Garbage collection complete'));
    assert.ok(ctx.includes('decay'));
  });
});
