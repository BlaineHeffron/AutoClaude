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
  insertAction,
  insertDecision,
  insertLearning,
  insertPrompt,
  getProjectMetrics,
  getActiveDecisions,
  getTopLearnings,
  updateSession,
} from '../src/core/memory';
import { closeDb } from '../src/core/db';

describe('Stats', () => {
  const projectPath = '/test/stats-project';

  before(() => {
    // Set up test data
    createSession('stats-session-1', projectPath);
    createSession('stats-session-2', projectPath);

    // Add actions to session 1
    insertAction({
      session_id: 'stats-session-1',
      tool_name: 'Edit',
      file_path: '/test/app.ts',
      action_type: 'edit',
      description: 'edit: /test/app.ts',
      outcome: 'success',
      error_message: null,
    });

    insertAction({
      session_id: 'stats-session-1',
      tool_name: 'Bash',
      file_path: null,
      action_type: 'test',
      description: 'test: npm test',
      outcome: 'failure',
      error_message: 'Test assertion failed',
    });

    insertAction({
      session_id: 'stats-session-1',
      tool_name: 'Edit',
      file_path: '/test/app.ts',
      action_type: 'edit',
      description: 'edit: /test/app.ts',
      outcome: 'success',
      error_message: null,
    });

    insertAction({
      session_id: 'stats-session-1',
      tool_name: 'Bash',
      file_path: null,
      action_type: 'test',
      description: 'test: npm test',
      outcome: 'success',
      error_message: null,
    });

    // Update session 1 peak utilization
    updateSession('stats-session-1', {
      context_utilization_peak: 0.62,
      compaction_count: 1,
    });

    // Add a decision
    insertDecision({
      session_id: 'stats-session-1',
      project_path: projectPath,
      category: 'architecture',
      decision: 'Use esbuild for production builds',
      rationale: 'Faster than tsc for production bundling',
      files_affected: '["scripts/build.js"]',
      supersedes_id: null,
    });

    // Add learnings
    insertLearning({
      session_id: 'stats-session-1',
      project_path: projectPath,
      category: 'gotcha',
      learning: 'FTS5 queries require proper escaping of special characters',
      context: 'Discovered when implementing search',
      relevance_score: 0.9,
      times_referenced: 2,
    });

    insertLearning({
      session_id: 'stats-session-1',
      project_path: projectPath,
      category: 'pattern',
      learning: 'Always wrap DB operations in try/catch for hooks',
      context: 'Pattern used throughout the codebase',
      relevance_score: 0.75,
      times_referenced: 0,
    });

    // Add a prompt
    insertPrompt({
      session_id: 'stats-session-1',
      project_path: projectPath,
      prompt: 'Help me implement the metrics system',
    });
  });

  after(() => {
    closeDb();
    try {
      fs.rmSync(TEST_DIR, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return correct project metrics', () => {
    const pm = getProjectMetrics(projectPath);

    assert.equal(pm.sessionCount, 2, 'Should have 2 sessions');
    assert.equal(pm.totalActions, 4, 'Should have 4 actions');
    assert.equal(pm.totalFailures, 1, 'Should have 1 failure');
    assert.ok(pm.avgUtilization > 0, 'Average utilization should be > 0');
    assert.equal(pm.totalCompactions, 1, 'Should have 1 compaction');
    assert.equal(pm.decisionCount, 1, 'Should have 1 decision');
    assert.equal(pm.learningCount, 2, 'Should have 2 learnings');
    assert.equal(pm.promptCount, 1, 'Should have 1 prompt');
  });

  it('should return active decisions', () => {
    const decisions = getActiveDecisions(projectPath, 10);
    assert.equal(decisions.length, 1);
    assert.equal(decisions[0].decision, 'Use esbuild for production builds');
    assert.equal(decisions[0].category, 'architecture');
  });

  it('should return learnings sorted by relevance', () => {
    const learnings = getTopLearnings(projectPath, 10);
    assert.equal(learnings.length, 2);
    // Higher relevance score first
    assert.ok(
      learnings[0].relevance_score >= learnings[1].relevance_score,
      'Learnings should be sorted by relevance descending',
    );
    assert.equal(
      learnings[0].learning,
      'FTS5 queries require proper escaping of special characters',
    );
  });

  it('should return empty metrics for unknown project', () => {
    const pm = getProjectMetrics('/unknown/project');
    assert.equal(pm.sessionCount, 0);
    assert.equal(pm.totalActions, 0);
    assert.equal(pm.totalFailures, 0);
  });
});
