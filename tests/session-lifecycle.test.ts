import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Override DB path before importing modules
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

// We test by directly invoking the handlers rather than piping JSON to the CLI,
// since the handlers are the actual units of work.
import {
  createSession,
  getSession,
  updateSession,
  insertAction,
  getSessionActions,
  insertSnapshot,
  getLatestSnapshot,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Session Lifecycle', () => {
  before(() => {
    // Force DB initialization at test DB path
    // The db module uses hardcoded path, so we need to test through the memory module
    // which wraps db calls safely.
  });

  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should create a session record', () => {
    const sessionId = 'test-session-1';
    createSession(sessionId, '/test/project');

    const session = getSession(sessionId);
    assert.ok(session, 'Session should exist after creation');
    assert.equal(session!.id, sessionId);
    assert.equal(session!.project_path, '/test/project');
    assert.equal(session!.compaction_count, 0);
    assert.equal(session!.ended_at, null);
  });

  it('should update session fields', () => {
    const sessionId = 'test-session-update';
    createSession(sessionId, '/test/project');

    updateSession(sessionId, {
      summary: 'Test summary',
      ended_at: '2026-02-01T12:00:00Z',
      compaction_count: 2,
    });

    const session = getSession(sessionId);
    assert.ok(session);
    assert.equal(session!.summary, 'Test summary');
    assert.equal(session!.ended_at, '2026-02-01T12:00:00Z');
    assert.equal(session!.compaction_count, 2);
  });

  it('should record and retrieve actions', () => {
    const sessionId = 'test-session-actions';
    createSession(sessionId, '/test/project');

    insertAction({
      session_id: sessionId,
      tool_name: 'Edit',
      file_path: '/test/file.ts',
      action_type: 'edit',
      description: 'edit: /test/file.ts',
      outcome: 'success',
      error_message: null,
    });

    insertAction({
      session_id: sessionId,
      tool_name: 'Bash',
      file_path: null,
      action_type: 'test',
      description: 'test: npm test',
      outcome: 'failure',
      error_message: 'Test failed: expected 1 to be 2',
    });

    const actions = getSessionActions(sessionId);
    assert.equal(actions.length, 2);
    assert.equal(actions[0].tool_name, 'Edit');
    assert.equal(actions[0].outcome, 'success');
    assert.equal(actions[1].tool_name, 'Bash');
    assert.equal(actions[1].outcome, 'failure');
    assert.ok(actions[1].error_message?.includes('expected 1 to be 2'));
  });

  it('should create and retrieve snapshots', () => {
    const sessionId = 'test-session-snapshot';
    createSession(sessionId, '/test/project');

    insertSnapshot({
      session_id: sessionId,
      trigger: 'pre-compact',
      current_task: 'Implementing feature X',
      progress_summary: '3 edits, 1 test',
      open_questions: '[]',
      next_steps: '["Add error handling"]',
      working_files: '["/test/file.ts"]',
    });

    const snapshot = getLatestSnapshot(sessionId);
    assert.ok(snapshot);
    assert.equal(snapshot!.trigger, 'pre-compact');
    assert.equal(snapshot!.current_task, 'Implementing feature X');
    assert.equal(snapshot!.progress_summary, '3 edits, 1 test');
  });

  it('should handle complete session lifecycle', () => {
    const sessionId = 'test-lifecycle-full';

    // 1. Session start
    createSession(sessionId, '/test/project');
    let session = getSession(sessionId);
    assert.ok(session);
    assert.equal(session!.ended_at, null);

    // 2. Capture actions
    insertAction({
      session_id: sessionId,
      tool_name: 'Edit',
      file_path: '/test/app.ts',
      action_type: 'edit',
      description: 'edit: /test/app.ts',
      outcome: 'success',
      error_message: null,
    });

    insertAction({
      session_id: sessionId,
      tool_name: 'Bash',
      file_path: null,
      action_type: 'build',
      description: 'build: npm run build',
      outcome: 'success',
      error_message: null,
    });

    // 3. Session stop
    const actions = getSessionActions(sessionId);
    assert.equal(actions.length, 2);

    updateSession(sessionId, {
      summary: 'Made 1 edit, 1 build. Build succeeded.',
      files_modified: '["/test/app.ts"]',
      ended_at: new Date().toISOString(),
    });

    // 4. Session end (verification)
    session = getSession(sessionId);
    assert.ok(session);
    assert.ok(session!.ended_at);
    assert.ok(session!.summary?.includes('build'));
  });

  it('should handle missing session gracefully', () => {
    const session = getSession('nonexistent-session-id');
    assert.equal(session, null);

    const actions = getSessionActions('nonexistent-session-id');
    assert.deepEqual(actions, []);
  });
});
