import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-backup-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

// The backup handler reads AUTOCLAUDE_DB to find the db path, but also uses
// a hardcoded backup dir under ~/.autoclaude/backups. We'll override HOME to
// keep tests isolated.
const FAKE_HOME = path.join(TEST_DIR, 'fakehome');
fs.mkdirSync(FAKE_HOME, { recursive: true });

import { getDb, closeDb } from '../src/core/db';
import { handleBackup } from '../src/cli/backup';

describe('Backup Command', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should report no database when db file does not exist', async () => {
    // Point to a non-existent db
    const origDb = process.env.AUTOCLAUDE_DB;
    process.env.AUTOCLAUDE_DB = path.join(TEST_DIR, 'nonexistent.db');

    const result = await handleBackup({ session_id: 'backup-test-1' });
    assert.equal(result.continue, true);
    assert.ok(
      result.hookSpecificOutput?.additionalContext?.includes('No database'),
      'Should report no database found',
    );

    process.env.AUTOCLAUDE_DB = origDb;
  });

  it('should create a backup of an existing database', async () => {
    // Ensure the db exists by opening it
    const db = getDb();
    assert.ok(db, 'Should have a db handle');
    assert.ok(fs.existsSync(TEST_DB), 'DB file should exist');

    const result = await handleBackup({ session_id: 'backup-test-2' });
    assert.equal(result.continue, true);
    assert.ok(
      result.hookSpecificOutput?.additionalContext?.includes('backed up'),
      'Should confirm backup success',
    );
  });

  it('should always return continue: true even on error', async () => {
    // Point to a directory as if it were a db file to cause an error
    const origDb = process.env.AUTOCLAUDE_DB;
    const dirAsDb = path.join(TEST_DIR, 'fakedir');
    fs.mkdirSync(dirAsDb, { recursive: true });
    process.env.AUTOCLAUDE_DB = dirAsDb;

    const result = await handleBackup({ session_id: 'backup-test-3' });
    assert.equal(result.continue, true, 'Should always continue');

    process.env.AUTOCLAUDE_DB = origDb;
  });
});
