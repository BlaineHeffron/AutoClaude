import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-query-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { handleQuery } from '../src/cli/query';
import type { HookInput } from '../src/cli/types';
import {
  createSession,
  updateSession,
  insertDecision,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

const stubInput: HookInput = { session_id: 'stub' };

describe('Query Handler', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return error for empty query', async () => {
    const result = await handleQuery(stubInput, '');
    assert.ok(result.hookSpecificOutput?.additionalContext?.includes('Error'));
  });

  it('should return no results for unmatched query', async () => {
    const result = await handleQuery(stubInput, 'xyznonexistentterm');
    assert.ok(
      result.hookSpecificOutput?.additionalContext?.includes('No results'),
    );
  });

  it('should return results for a matching query', async () => {
    createSession('query-test-1', '/test/project');
    updateSession('query-test-1', {
      summary: 'Implemented authentication middleware with JWT tokens',
    });

    // FTS needs the summary to be indexed
    insertDecision({
      session_id: 'query-test-1',
      project_path: '/test/project',
      category: 'architecture',
      decision: 'Use JWT tokens for authentication',
      rationale: 'Industry standard approach',
      files_affected: null,
      supersedes_id: null,
    });

    const result = await handleQuery(stubInput, 'JWT authentication');
    assert.ok(result.continue);
    const ctx = result.hookSpecificOutput?.additionalContext ?? '';
    assert.ok(ctx.includes('result'), 'Should contain result text');
  });
});
