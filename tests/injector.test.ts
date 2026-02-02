import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-injector-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { buildInjectionContext } from '../src/core/injector';
import {
  createSession,
  updateSession,
  insertDecision,
  insertLearning,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';
import { DEFAULT_CONFIG } from '../src/util/config';
import { estimateTokens } from '../src/util/tokens';

describe('Injector', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return empty string when no data exists', () => {
    const result = buildInjectionContext(
      '/test/empty-project',
      'inj-test-1',
      'startup',
      DEFAULT_CONFIG,
    );
    assert.equal(result, '');
  });

  it('should include sessions section', () => {
    createSession('inj-prev-1', '/test/project');
    updateSession('inj-prev-1', {
      summary: 'Previous session implemented auth module',
      ended_at: new Date().toISOString(),
    });

    createSession('inj-current', '/test/project');
    const result = buildInjectionContext(
      '/test/project',
      'inj-current',
      'startup',
      DEFAULT_CONFIG,
    );
    assert.ok(result.includes('Recent Sessions'), `Got: ${result}`);
    assert.ok(result.includes('auth module'), `Got: ${result}`);
  });

  it('should include decisions section', () => {
    insertDecision({
      session_id: 'inj-prev-1',
      project_path: '/test/project',
      category: 'architecture',
      decision: 'Use microservices architecture',
      rationale: 'Scalability requirement',
      files_affected: null,
      supersedes_id: null,
    });

    const result = buildInjectionContext(
      '/test/project',
      'inj-current',
      'startup',
      DEFAULT_CONFIG,
    );
    assert.ok(result.includes('Active Decisions'), `Got: ${result}`);
    assert.ok(result.includes('microservices'), `Got: ${result}`);
  });

  it('should respect token budget', () => {
    // Add lots of data
    for (let i = 0; i < 20; i++) {
      insertLearning({
        session_id: 'inj-prev-1',
        project_path: '/test/project',
        category: 'pattern',
        learning: `Learning number ${i}: This is a somewhat long description of a pattern that was discovered during development and should contribute to the token count significantly.`,
        context: null,
        relevance_score: 1.0,
        times_referenced: 0,
      });
    }

    const config = {
      ...DEFAULT_CONFIG,
      injection: { ...DEFAULT_CONFIG.injection, maxTokens: 200 },
    };
    const result = buildInjectionContext(
      '/test/project',
      'inj-current',
      'startup',
      config,
    );
    const tokens = estimateTokens(result);
    assert.ok(tokens <= 210, `Should be within budget: got ${tokens} tokens`);
  });
});
