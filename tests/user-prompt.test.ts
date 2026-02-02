import { describe, it, before, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

// Override DB path before importing modules
const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import {
  createSession,
  insertPrompt,
  findSimilarPrompts,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('User Prompt', () => {
  const projectPath = '/test/project';

  before(() => {
    // Create sessions for the prompts
    createSession('prompt-session-1', projectPath);
    createSession('prompt-session-2', projectPath);
  });

  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should insert and retrieve prompts', () => {
    const id = insertPrompt({
      session_id: 'prompt-session-1',
      project_path: projectPath,
      prompt: 'Help me implement user authentication with JWT tokens',
    });

    assert.ok(id > 0, 'insertPrompt should return a positive ID');
  });

  it('should detect similar prompts via FTS5', () => {
    // Insert several prompts in session 1
    insertPrompt({
      session_id: 'prompt-session-1',
      project_path: projectPath,
      prompt: 'Implement user authentication with JWT tokens and refresh logic',
    });

    insertPrompt({
      session_id: 'prompt-session-1',
      project_path: projectPath,
      prompt: 'Add database migration for the users table',
    });

    insertPrompt({
      session_id: 'prompt-session-1',
      project_path: projectPath,
      prompt: 'Fix the broken build pipeline in CI configuration',
    });

    // Now search from session 2 for something similar to the first prompt
    const similar = findSimilarPrompts(
      'authentication OR tokens OR JWT OR implement',
      projectPath,
      'prompt-session-2',
      5,
    );

    assert.ok(similar.length > 0, 'Should find similar prompts');
    // The authentication-related prompt should be the top match
    assert.ok(
      similar[0].prompt.includes('authentication'),
      "Best match should contain 'authentication'",
    );
  });

  it('should not return prompts from the excluded session', () => {
    const similar = findSimilarPrompts(
      'authentication OR tokens OR JWT',
      projectPath,
      'prompt-session-1', // exclude the session that has the prompts
      5,
    );

    // Should not find prompts from the excluded session
    for (const result of similar) {
      assert.notEqual(
        result.session_id,
        'prompt-session-1',
        'Should not return prompts from excluded session',
      );
    }
  });

  it('should return empty array for unmatched query', () => {
    const similar = findSimilarPrompts(
      'xyzzyfoobarbaz123',
      projectPath,
      'prompt-session-2',
      5,
    );
    assert.equal(similar.length, 0);
  });

  it('should handle empty prompt gracefully', () => {
    const id = insertPrompt({
      session_id: 'prompt-session-1',
      project_path: projectPath,
      prompt: '',
    });
    // Empty prompt should still insert (DB allows it)
    assert.ok(id >= 0);
  });
});
