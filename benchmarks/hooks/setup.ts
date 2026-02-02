/**
 * Promptfoo extension hook: beforeAll.
 *
 * Seeds an isolated SQLite DB with ground truth data, builds the
 * injection context, and injects the groundTruthDoc template variable
 * into all test cases.
 *
 * Uses the "new calling convention": exported as a named function
 * matching the hook name, receives (context, { hookName }).
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// Create temp dir and set AUTOCLAUDE_DB at module scope, before any
// getDb() call. Static imports only define functions; the lazy getDb()
// in db.ts won't fire until seedBenchmarkDb() is called below.
const BENCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-e2e-'));
const DB_PATH = path.join(BENCH_DIR, 'bench.db');
const PROJECT_DIR = path.join(BENCH_DIR, 'project');
fs.mkdirSync(PROJECT_DIR, { recursive: true });
fs.writeFileSync(
  path.join(PROJECT_DIR, 'package.json'),
  JSON.stringify({ name: 'benchmark-project', version: '0.0.1' }),
);
process.env.AUTOCLAUDE_DB = DB_PATH;

import { seedBenchmarkDb, closeSeedDb } from '../seed';
import { buildInjectionContext } from '../../src/core/injector';
import { getConfig } from '../../src/util/config';
import { buildGroundTruthDoc } from '../ground-truth';

declare const global: {
  __benchInjectionContext?: string;
  __benchProjectDir?: string;
  __benchDbPath?: string;
};

interface SuiteContext {
  suite: {
    description?: string;
    tests: Array<{
      vars?: Record<string, string | object>;
      [key: string]: unknown;
    }>;
    [key: string]: unknown;
  };
}

/**
 * beforeAll hook: seeds the DB, builds injection context, sets globals,
 * and injects groundTruthDoc into all test case vars.
 */
export async function beforeAll(
  context: SuiteContext,
  _options: { hookName: string },
): Promise<SuiteContext> {
  console.log('E2E Setup: Seeding database...');

  // Seed the database
  const groundTruth = seedBenchmarkDb(PROJECT_DIR);

  // Build injection context (simulates what session-start hook would inject)
  const config = getConfig();
  const injectionContext = buildInjectionContext(
    PROJECT_DIR,
    'e2e-current',
    'compact',
    config,
  );

  closeSeedDb();

  // Set globals for providers to read
  global.__benchInjectionContext = injectionContext || '';
  global.__benchProjectDir = PROJECT_DIR;
  global.__benchDbPath = DB_PATH;

  // Build ground truth doc and inject into all test vars
  const groundTruthDoc = buildGroundTruthDoc(groundTruth);
  for (const test of context.suite.tests) {
    test.vars = test.vars || {};
    test.vars.groundTruthDoc = groundTruthDoc;
  }

  console.log(`E2E Setup complete:`);
  console.log(`  DB:       ${DB_PATH}`);
  console.log(`  Project:  ${PROJECT_DIR}`);
  console.log(
    `  Context:  ${injectionContext ? `${injectionContext.length} chars` : 'empty'}`,
  );
  console.log(
    `  Seeded:   ${groundTruth.sessions.length} sessions, ` +
      `${groundTruth.decisions.length} decisions, ` +
      `${groundTruth.learnings.length} learnings`,
  );

  return context;
}
