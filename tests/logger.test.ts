import { describe, it, beforeEach, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-logger-test-'),
);

// We need a fresh logger instance for testing. The module exports a singleton,
// so we configure it to write to our test directory.
import { logger } from '../src/util/logger';

describe('Logger', () => {
  const logFile = path.join(TEST_DIR, 'test.log');

  beforeEach(() => {
    // Clear log file between tests
    try {
      fs.writeFileSync(logFile, '', 'utf-8');
    } catch {
      // ignore
    }
    logger.setLogFile(logFile);
    logger.setLevel('debug');
  });

  after(() => {
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should write info messages to log file', () => {
    logger.info('test info message');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(content.includes('[INFO]'), 'Should contain INFO level');
    assert.ok(
      content.includes('test info message'),
      'Should contain the message',
    );
  });

  it('should write error messages to log file', () => {
    logger.error('something went wrong');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(content.includes('[ERROR]'), 'Should contain ERROR level');
    assert.ok(
      content.includes('something went wrong'),
      'Should contain the message',
    );
  });

  it('should write debug messages when level is debug', () => {
    logger.setLevel('debug');
    logger.debug('debug detail');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(content.includes('[DEBUG]'), 'Should contain DEBUG level');
  });

  it('should suppress debug messages when level is info', () => {
    logger.setLevel('info');
    logger.debug('hidden debug');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(
      !content.includes('hidden debug'),
      'Debug message should be suppressed',
    );
  });

  it('should suppress info messages when level is warn', () => {
    logger.setLevel('warn');
    logger.info('hidden info');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(
      !content.includes('hidden info'),
      'Info message should be suppressed',
    );
  });

  it('should write warn messages', () => {
    logger.warn('warning message');
    const content = fs.readFileSync(logFile, 'utf-8');
    assert.ok(content.includes('[WARN]'), 'Should contain WARN level');
  });

  it('should include ISO timestamp in log lines', () => {
    logger.info('timestamp check');
    const content = fs.readFileSync(logFile, 'utf-8');
    // ISO 8601 pattern: [2026-02-01T...]
    assert.match(content, /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  });

  it('should handle tilde path expansion in setLogFile', () => {
    const tildeFile = path.join(TEST_DIR, 'tilde-test.log');
    // setLogFile replaces leading ~ with homedir; verify it doesn't crash
    // with a normal path
    logger.setLogFile(tildeFile);
    logger.info('tilde test');
    const content = fs.readFileSync(tildeFile, 'utf-8');
    assert.ok(content.includes('tilde test'), 'Should write to new path');

    // Restore for other tests
    logger.setLogFile(logFile);
  });
});
