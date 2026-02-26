import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-native-mem-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import {
  createSession,
  insertDecision,
  insertLearning,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';
import {
  getNativeMemoryDir,
  syncToNativeMemory,
} from '../src/core/native-memory';

describe('Native Memory Bridge', () => {
  const projectPath = '/test/native-mem-project';

  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should compute correct native memory directory', () => {
    const dir = getNativeMemoryDir('/home/user/projects/myapp');
    assert.ok(dir.includes('-home-user-projects-myapp'));
    assert.ok(dir.endsWith('/memory'));
  });

  it('should sync decisions to native memory', () => {
    createSession('native-test-1', projectPath);

    insertDecision({
      session_id: 'native-test-1',
      project_path: projectPath,
      category: 'architecture',
      decision: 'Use PostgreSQL for persistence',
      rationale: 'Better for complex queries',
      files_affected: null,
      supersedes_id: null,
    });

    insertDecision({
      session_id: 'native-test-1',
      project_path: projectPath,
      category: 'convention',
      decision: 'Use camelCase for all variables',
      rationale: 'Team standard',
      files_affected: null,
      supersedes_id: null,
    });

    syncToNativeMemory(projectPath);

    const memDir = getNativeMemoryDir(projectPath);
    const decisionsFile = path.join(memDir, 'decisions.md');
    assert.ok(fs.existsSync(decisionsFile), 'decisions.md should exist');

    const content = fs.readFileSync(decisionsFile, 'utf-8');
    assert.ok(
      content.includes('Use PostgreSQL'),
      'Should contain decision text',
    );
    assert.ok(content.includes('[architecture]'), 'Should contain category');
    assert.ok(
      content.includes('Better for complex queries'),
      'Should contain rationale',
    );
  });

  it('should sync learnings to native memory', () => {
    insertLearning({
      session_id: 'native-test-1',
      project_path: projectPath,
      category: 'gotcha',
      learning: 'FTS5 requires special character escaping',
      context: 'Discovered during search implementation',
      relevance_score: 0.85,
      times_referenced: 3,
    });

    syncToNativeMemory(projectPath);

    const memDir = getNativeMemoryDir(projectPath);
    const learningsFile = path.join(memDir, 'learnings.md');
    assert.ok(fs.existsSync(learningsFile), 'learnings.md should exist');

    const content = fs.readFileSync(learningsFile, 'utf-8');
    assert.ok(
      content.includes('FTS5 requires special character escaping'),
      'Should contain learning text',
    );
    assert.ok(content.includes('0.85'), 'Should contain relevance score');
    assert.ok(
      content.includes('referenced 3x'),
      'Should contain reference count',
    );
  });

  it('should update MEMORY.md index', () => {
    syncToNativeMemory(projectPath);

    const memDir = getNativeMemoryDir(projectPath);
    const indexFile = path.join(memDir, 'MEMORY.md');
    assert.ok(fs.existsSync(indexFile), 'MEMORY.md should exist');

    const content = fs.readFileSync(indexFile, 'utf-8');
    assert.ok(
      content.includes('AutoClaude Structured Memory'),
      'Should contain index section',
    );
    assert.ok(
      content.includes('decisions.md'),
      'Should reference decisions file',
    );
    assert.ok(
      content.includes('learnings.md'),
      'Should reference learnings file',
    );
  });

  it('should not duplicate index section on repeated syncs', () => {
    syncToNativeMemory(projectPath);
    syncToNativeMemory(projectPath);

    const memDir = getNativeMemoryDir(projectPath);
    const content = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf-8');

    const count = (content.match(/AutoClaude Structured Memory/g) || []).length;
    assert.equal(count, 1, 'Should only have one index section');
  });
});
