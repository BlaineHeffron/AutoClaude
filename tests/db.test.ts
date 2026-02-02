import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-db-test-'));
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import { getDb, closeDb } from '../src/core/db';

describe('Database', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return a database handle', () => {
    const db = getDb();
    assert.ok(db, 'getDb() should return a non-null handle');
  });

  it('should have core tables', () => {
    const db = getDb()!;
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    for (const expected of [
      'sessions',
      'actions',
      'decisions',
      'learnings',
      'snapshots',
      'metrics',
      'prompts',
    ]) {
      assert.ok(
        tableNames.includes(expected),
        `Table '${expected}' should exist`,
      );
    }
  });

  it('should have FTS5 virtual tables', () => {
    const db = getDb()!;
    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%_fts'",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    for (const expected of [
      'sessions_fts',
      'decisions_fts',
      'learnings_fts',
      'prompts_fts',
    ]) {
      assert.ok(
        tableNames.includes(expected),
        `FTS table '${expected}' should exist`,
      );
    }
  });

  it('should reopen after close', () => {
    closeDb();
    const db = getDb();
    assert.ok(db, 'getDb() should return a handle after close + reopen');
  });
});
