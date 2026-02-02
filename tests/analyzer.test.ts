import { describe, it, after } from 'node:test';
import * as assert from 'node:assert/strict';
import * as path from 'node:path';
import * as fs from 'node:fs';
import * as os from 'node:os';

const TEST_DIR = fs.mkdtempSync(
  path.join(os.tmpdir(), 'autoclaude-analyzer-test-'),
);
const TEST_DB = path.join(TEST_DIR, 'test.db');
process.env.AUTOCLAUDE_DB = TEST_DB;

import {
  analyzeActionForDecisions,
  extractLearningsFromSession,
} from '../src/core/analyzer';
import {
  createSession,
  getActiveDecisions,
  getTopLearnings,
} from '../src/core/memory';
import type { ActionRecord } from '../src/core/memory';
import { closeDb } from '../src/core/db';

const PROJECT = '/test/project';

describe('Analyzer', () => {
  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  describe('analyzeActionForDecisions', () => {
    it('should extract a convention decision from tsconfig edit', () => {
      createSession('analyzer-1', PROJECT);
      const action: ActionRecord = {
        session_id: 'analyzer-1',
        tool_name: 'Edit',
        file_path: '/project/tsconfig.json',
        action_type: 'edit',
        description: 'Updated strict mode',
        outcome: 'success',
        error_message: null,
      };

      analyzeActionForDecisions(action, PROJECT);

      const decisions = getActiveDecisions(PROJECT, 10);
      const match = decisions.find((d) => d.decision.includes('tsconfig.json'));
      assert.ok(match, 'Should have a decision about tsconfig.json');
      assert.equal(match!.category, 'convention');
    });

    it('should extract architecture decision from webpack config', () => {
      const action: ActionRecord = {
        session_id: 'analyzer-1',
        tool_name: 'Edit',
        file_path: '/project/webpack.config.js',
        action_type: 'create',
        description: 'Added webpack configuration',
        outcome: 'success',
        error_message: null,
      };

      analyzeActionForDecisions(action, PROJECT);

      const decisions = getActiveDecisions(PROJECT, 10);
      const match = decisions.find((d) =>
        d.decision.includes('webpack.config.js'),
      );
      assert.ok(match, 'Should have a decision about webpack config');
      assert.equal(match!.category, 'architecture');
    });

    it('should extract library decision from npm install', () => {
      createSession('analyzer-2', PROJECT);
      const action: ActionRecord = {
        session_id: 'analyzer-2',
        tool_name: 'Bash',
        file_path: null,
        action_type: 'command',
        description: 'npm install lodash express',
        outcome: 'success',
        error_message: null,
      };

      analyzeActionForDecisions(action, PROJECT);

      const decisions = getActiveDecisions(PROJECT, 20);
      const match = decisions.find(
        (d) => d.category === 'library' && d.decision.includes('lodash'),
      );
      assert.ok(match, 'Should have a library decision for lodash');
    });

    it('should ignore non-config file edits', () => {
      const beforeCount = getActiveDecisions(PROJECT, 100).length;
      const action: ActionRecord = {
        session_id: 'analyzer-1',
        tool_name: 'Edit',
        file_path: '/project/src/index.ts',
        action_type: 'edit',
        description: 'Updated code',
        outcome: 'success',
        error_message: null,
      };

      analyzeActionForDecisions(action, PROJECT);

      const afterCount = getActiveDecisions(PROJECT, 100).length;
      assert.equal(afterCount, beforeCount, 'No new decisions for non-config');
    });

    it('should handle actions with null file_path', () => {
      const action: ActionRecord = {
        session_id: 'analyzer-1',
        tool_name: 'Read',
        file_path: null,
        action_type: 'read',
        description: 'Read something',
        outcome: 'success',
        error_message: null,
      };

      // Should not throw
      analyzeActionForDecisions(action, PROJECT);
    });
  });

  describe('extractLearningsFromSession', () => {
    it('should extract learning from test failure→fix→success sequence', () => {
      createSession('analyzer-learn-1', PROJECT);
      const actions: ActionRecord[] = [
        {
          session_id: 'analyzer-learn-1',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'failure',
          error_message: 'TypeError: cannot read property of undefined',
        },
        {
          session_id: 'analyzer-learn-1',
          tool_name: 'Edit',
          file_path: '/project/src/utils.ts',
          action_type: 'edit',
          description: 'Fixed null check',
          outcome: 'success',
          error_message: null,
        },
        {
          session_id: 'analyzer-learn-1',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'success',
          error_message: null,
        },
      ];

      extractLearningsFromSession(actions, 'analyzer-learn-1', PROJECT);

      const learnings = getTopLearnings(PROJECT, 10);
      const match = learnings.find(
        (l) => l.category === 'gotcha' && l.learning.includes('utils.ts'),
      );
      assert.ok(match, 'Should extract a gotcha learning from test fix');
    });

    it('should extract learning from build failure→fix→success', () => {
      createSession('analyzer-learn-2', PROJECT);
      const actions: ActionRecord[] = [
        {
          session_id: 'analyzer-learn-2',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'build',
          description: 'npm run build',
          outcome: 'failure',
          error_message: 'Module not found',
        },
        {
          session_id: 'analyzer-learn-2',
          tool_name: 'Edit',
          file_path: '/project/src/config.ts',
          action_type: 'edit',
          description: 'Fixed import',
          outcome: 'success',
          error_message: null,
        },
        {
          session_id: 'analyzer-learn-2',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'build',
          description: 'npm run build',
          outcome: 'success',
          error_message: null,
        },
      ];

      extractLearningsFromSession(actions, 'analyzer-learn-2', PROJECT);

      const learnings = getTopLearnings(PROJECT, 20);
      const match = learnings.find(
        (l) => l.category === 'gotcha' && l.learning.includes('Build failure'),
      );
      assert.ok(match, 'Should extract a gotcha learning from build fix');
    });

    it('should not extract learnings when there is no fix', () => {
      createSession('analyzer-learn-3', PROJECT);
      const actions: ActionRecord[] = [
        {
          session_id: 'analyzer-learn-3',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'failure',
          error_message: 'Tests failed',
        },
        {
          session_id: 'analyzer-learn-3',
          tool_name: 'Read',
          file_path: '/project/src/index.ts',
          action_type: 'read',
          description: 'Reading file',
          outcome: 'success',
          error_message: null,
        },
      ];

      const beforeCount = getTopLearnings(PROJECT, 100).length;
      extractLearningsFromSession(actions, 'analyzer-learn-3', PROJECT);
      const afterCount = getTopLearnings(PROJECT, 100).length;
      assert.equal(afterCount, beforeCount, 'No learnings without a fix');
    });

    it('should handle empty action list', () => {
      createSession('analyzer-learn-4', PROJECT);
      // Should not throw
      extractLearningsFromSession([], 'analyzer-learn-4', PROJECT);
    });

    it('should deduplicate identical error-fix sequences', () => {
      createSession('analyzer-learn-5', PROJECT);
      const sequence: ActionRecord[] = [
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'failure',
          error_message: 'Error A',
        },
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Edit',
          file_path: '/project/src/dup.ts',
          action_type: 'edit',
          description: 'Fix A',
          outcome: 'success',
          error_message: null,
        },
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'success',
          error_message: null,
        },
        // Same sequence again
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'failure',
          error_message: 'Error A again',
        },
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Edit',
          file_path: '/project/src/dup.ts',
          action_type: 'edit',
          description: 'Fix A again',
          outcome: 'success',
          error_message: null,
        },
        {
          session_id: 'analyzer-learn-5',
          tool_name: 'Bash',
          file_path: null,
          action_type: 'test',
          description: 'npm test',
          outcome: 'success',
          error_message: null,
        },
      ];

      const beforeCount = getTopLearnings(PROJECT, 100).length;
      extractLearningsFromSession(sequence, 'analyzer-learn-5', PROJECT);
      const afterCount = getTopLearnings(PROJECT, 100).length;

      // Should only add one learning, not two (deduplication via seen set)
      assert.equal(
        afterCount - beforeCount,
        1,
        'Should deduplicate identical sequences',
      );
    });
  });
});
