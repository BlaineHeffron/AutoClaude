import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-zeroshot-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { getSession, getSessionActions } from '../src/core/memory';
import { closeDb } from '../src/core/db';

// Tests run from dist/tests/, so CLI entry point is at ../cli/index.js
const cliPath = path.resolve(__dirname, '..', 'cli', 'index.js');

function runCli(
  command: string,
  input: string,
  env: Record<string, string | undefined>,
): string {
  return execFileSync('node', [cliPath, command], {
    input,
    env,
    encoding: 'utf-8',
  });
}

describe('Zeroshot Agent Bypass', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('CLI subprocess with ZEROSHOT_BLOCK_ASK_USER=1', () => {
    const bypassEnv = {
      ...process.env,
      ZEROSHOT_BLOCK_ASK_USER: '1',
      AUTOCLAUDE_DB: TEST_DB,
    };

    it('should return {continue:true} for session-start without recording', () => {
      const input = JSON.stringify({
        session_id: 'zs-bypass-1',
        cwd: '/test/project',
      });

      const result = runCli('session-start', input, bypassEnv);
      const output = JSON.parse(result.trim());
      assert.equal(output.continue, true);
      assert.equal(output.hookSpecificOutput, undefined);
    });

    it('should return {continue:true} for capture-action without recording', () => {
      const input = JSON.stringify({
        session_id: 'zs-bypass-1',
        tool_name: 'Edit',
        tool_input: { file_path: '/test/file.ts' },
      });

      const result = runCli('capture-action', input, bypassEnv);
      const output = JSON.parse(result.trim());
      assert.equal(output.continue, true);
    });

    it('should return {continue:true} for user-prompt without recording', () => {
      const input = JSON.stringify({
        session_id: 'zs-bypass-1',
        tool_input: { user_prompt: 'test prompt' },
      });

      const result = runCli('user-prompt', input, bypassEnv);
      const output = JSON.parse(result.trim());
      assert.equal(output.continue, true);
    });

    it('should return {continue:true} for session-stop without recording', () => {
      const input = JSON.stringify({ session_id: 'zs-bypass-1' });

      const result = runCli('session-stop', input, bypassEnv);
      const output = JSON.parse(result.trim());
      assert.equal(output.continue, true);
    });

    it('should not create any session in the DB', () => {
      const session = getSession('zs-bypass-1');
      assert.equal(session, null, 'No session should be created when bypassed');
    });

    it('should not record any actions in the DB', () => {
      const actions = getSessionActions('zs-bypass-1');
      assert.equal(
        actions.length,
        0,
        'No actions should be recorded when bypassed',
      );
    });
  });

  describe('CLI subprocess without ZEROSHOT_BLOCK_ASK_USER', () => {
    it('should run normally and create session when env var is absent', () => {
      const input = JSON.stringify({
        session_id: 'zs-normal-1',
        cwd: '/test/project',
      });

      const env = { ...process.env, AUTOCLAUDE_DB: TEST_DB };
      delete env.ZEROSHOT_BLOCK_ASK_USER;

      const result = runCli('session-start', input, env);
      const output = JSON.parse(result.trim());
      assert.equal(output.continue, true);
      // Handler ran — session creation verified in next test
    });

    it('should have created the session in the DB', () => {
      // Re-open DB to see writes from the subprocess
      closeDb();
      const session = getSession('zs-normal-1');
      assert.ok(session, 'Session should exist when not bypassed');
      assert.equal(session!.project_path, '/test/project');
    });
  });
});
