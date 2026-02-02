import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-capture-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { captureAction } from '../src/cli/capture-action';
import { createSession, getSessionActions } from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Capture Action', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return continue: true for an Edit action', async () => {
    createSession('cap-test-1', '/test/project');
    const result = await captureAction({
      session_id: 'cap-test-1',
      tool_name: 'Edit',
      tool_input: { file_path: '/test/file.ts' },
    });
    assert.equal(result.continue, true);
  });

  it('should record the action in the database', async () => {
    const actions = getSessionActions('cap-test-1');
    assert.ok(actions.length >= 1, 'Should have at least 1 action');
    assert.equal(actions[0].tool_name, 'Edit');
    assert.equal(actions[0].action_type, 'edit');
  });

  it('should classify Bash test commands', async () => {
    createSession('cap-test-2', '/test/project');
    await captureAction({
      session_id: 'cap-test-2',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
    });
    const actions = getSessionActions('cap-test-2');
    const testAction = actions.find((a) => a.action_type === 'test');
    assert.ok(testAction, 'Should classify npm test as test action');
  });

  it('should classify Bash build commands', async () => {
    createSession('cap-test-3', '/test/project');
    await captureAction({
      session_id: 'cap-test-3',
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
    });
    const actions = getSessionActions('cap-test-3');
    const buildAction = actions.find((a) => a.action_type === 'build');
    assert.ok(buildAction, 'Should classify npm run build as build action');
  });

  it('should detect failure from error in output', async () => {
    createSession('cap-test-4', '/test/project');
    await captureAction({
      session_id: 'cap-test-4',
      tool_name: 'Bash',
      tool_input: { command: 'npm test' },
      tool_output: 'Error: test failed',
    });
    const actions = getSessionActions('cap-test-4');
    assert.equal(actions[0].outcome, 'failure');
  });
});
