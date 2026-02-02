import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-precompact-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { handlePreCompact } from '../src/cli/pre-compact';
import {
  createSession,
  insertAction,
  getSession,
  getLatestSnapshot,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Pre-Compact Handler', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should create snapshot and update session', async () => {
    createSession('precompact-1', '/test/project');
    insertAction({
      session_id: 'precompact-1',
      tool_name: 'Edit',
      file_path: '/test/file.ts',
      action_type: 'edit',
      description: 'edit: /test/file.ts',
      outcome: 'success',
      error_message: null,
    });

    const result = await handlePreCompact({
      session_id: 'precompact-1',
      cwd: '/test/project',
    });

    assert.equal(result.continue, true);
    assert.ok(result.hookSpecificOutput?.systemMessage?.includes('snapshot'));
  });

  it('should have created a snapshot', () => {
    const snapshot = getLatestSnapshot('precompact-1');
    assert.ok(snapshot, 'Snapshot should exist');
    assert.equal(snapshot!.trigger, 'pre-compact');
    assert.ok(snapshot!.progress_summary);
  });

  it('should have updated session with summary', () => {
    const session = getSession('precompact-1');
    assert.ok(session);
    assert.ok(session!.summary, 'Session should have a summary');
    assert.equal(session!.compaction_count, 1);
  });
});
