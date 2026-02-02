import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';

import {
  summarizeSession,
  collectUniqueFiles,
  countByType,
} from '../src/core/summarizer';
import type { ActionRecord } from '../src/core/memory';

describe('Summarizer', () => {
  it('should return default message for empty actions', () => {
    const result = summarizeSession([]);
    assert.ok(result.includes('no recorded actions'));
  });

  it('should summarize edits and tests', () => {
    const actions: ActionRecord[] = [
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/app.ts',
        action_type: 'edit',
        description: 'edit: /src/app.ts',
        outcome: 'success',
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/utils.ts',
        action_type: 'edit',
        description: 'edit: /src/utils.ts',
        outcome: 'success',
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Bash',
        file_path: null,
        action_type: 'test',
        description: 'test: npm test',
        outcome: 'success',
        error_message: null,
      },
    ];
    const result = summarizeSession(actions);
    assert.ok(result.includes('2 file edits'), `Got: ${result}`);
    assert.ok(result.includes('1 test run'), `Got: ${result}`);
  });

  it('should mention failures in summary', () => {
    const actions: ActionRecord[] = [
      {
        session_id: 's1',
        tool_name: 'Bash',
        file_path: null,
        action_type: 'test',
        description: 'test: npm test',
        outcome: 'failure',
        error_message: 'assertion failed',
      },
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/fix.ts',
        action_type: 'edit',
        description: 'edit: /src/fix.ts',
        outcome: 'success',
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Bash',
        file_path: null,
        action_type: 'test',
        description: 'test: npm test',
        outcome: 'success',
        error_message: null,
      },
    ];
    const result = summarizeSession(actions);
    assert.ok(
      result.includes('failed') || result.includes('failure'),
      `Got: ${result}`,
    );
  });

  it('should collect unique files', () => {
    const actions: ActionRecord[] = [
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/a.ts',
        action_type: 'edit',
        description: null,
        outcome: null,
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/b.ts',
        action_type: 'edit',
        description: null,
        outcome: null,
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: '/src/a.ts',
        action_type: 'edit',
        description: null,
        outcome: null,
        error_message: null,
      },
    ];
    const files = collectUniqueFiles(actions);
    assert.equal(files.length, 2);
    assert.ok(files.includes('/src/a.ts'));
    assert.ok(files.includes('/src/b.ts'));
  });

  it('should count by type', () => {
    const actions: ActionRecord[] = [
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: null,
        action_type: 'edit',
        description: null,
        outcome: null,
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Edit',
        file_path: null,
        action_type: 'edit',
        description: null,
        outcome: null,
        error_message: null,
      },
      {
        session_id: 's1',
        tool_name: 'Bash',
        file_path: null,
        action_type: 'test',
        description: null,
        outcome: null,
        error_message: null,
      },
    ];
    const counts = countByType(actions);
    assert.equal(counts['edit'], 2);
    assert.equal(counts['test'], 1);
  });
});
