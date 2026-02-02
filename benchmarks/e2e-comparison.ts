/**
 * E2E Benchmark: AutoClaude vs Vanilla Claude Code
 *
 * Main orchestrator that runs the full benchmark pipeline:
 *   1. Seed — create an isolated SQLite DB with ground truth data
 *   2. Collect — run each scenario through both arms (with/without autoclaude)
 *   3. Judge — use LLM-as-judge to score each response
 *   4. Report — generate ASCII table + JSON report
 *
 * Usage:
 *   npm run bench:e2e
 *   npm run bench:e2e -- --scenarios cont-1,know-1  # run specific scenarios
 *   npm run bench:e2e -- --skip-judge                # collect only, no scoring
 */

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

// ── Parse CLI args before any imports that use AUTOCLAUDE_DB ───────────────

const args = process.argv.slice(2);
const scenarioFilter = args
  .find((a) => a.startsWith('--scenarios='))
  ?.split('=')[1]
  ?.split(',');
const skipJudge = args.includes('--skip-judge');
const delayMs = parseInt(
  args.find((a) => a.startsWith('--delay='))?.split('=')[1] ?? '2000',
  10,
);

// ── Create isolated temp directory and set AUTOCLAUDE_DB ───────────────────

const BENCH_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-e2e-'));
const DB_PATH = path.join(BENCH_DIR, 'bench.db');
const PROJECT_DIR = path.join(BENCH_DIR, 'project');
fs.mkdirSync(PROJECT_DIR, { recursive: true });

// Create a minimal project structure so claude has a CWD
fs.writeFileSync(
  path.join(PROJECT_DIR, 'package.json'),
  JSON.stringify({ name: 'benchmark-project', version: '0.0.1' }),
);

// Set AUTOCLAUDE_DB BEFORE importing seed.ts (which imports memory.ts → db.ts)
process.env.AUTOCLAUDE_DB = DB_PATH;

// ── Now import modules that depend on the DB path ──────────────────────────

import { SCENARIOS } from './scenarios';
import { seedBenchmarkDb, closeSeedDb } from './seed';
import { runScenario, type RunnerConfig } from './runner';
import { judgeScenario } from './judge';
import {
  computeAggregates,
  determineWinner,
  generateConsoleReport,
  writeJsonReport,
} from './report';
import { buildInjectionContext } from '../src/core/injector';
import { getConfig } from '../src/util/config';
import type {
  BenchmarkReport,
  GroundTruth,
  JudgeScores,
  ScenarioResult,
} from './types';

// ── Plugin dir detection ───────────────────────────────────────────────────

// This repo's root is the plugin dir
const PLUGIN_DIR = path.resolve(__dirname, '..');

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('  AutoClaude E2E Benchmark');
  console.log('='.repeat(60));
  console.log('');
  console.log(`  Temp dir:    ${BENCH_DIR}`);
  console.log(`  DB path:     ${DB_PATH}`);
  console.log(`  Plugin dir:  ${PLUGIN_DIR}`);
  console.log(`  Project dir: ${PROJECT_DIR}`);
  console.log(`  Delay:       ${delayMs}ms`);
  console.log(`  Skip judge:  ${skipJudge}`);
  console.log('');

  // ── Phase 1: Seed ─────────────────────────────────────────────────────

  console.log('PHASE 1: Seeding database with ground truth...');
  const groundTruth: GroundTruth = seedBenchmarkDb(PROJECT_DIR);

  // Build injection context from the seeded DB BEFORE closing it.
  // This simulates what the SessionStart hook would inject in a real session.
  // We need this because --print mode does not fire plugin hooks.
  const config = getConfig();
  const injectionContext = buildInjectionContext(
    PROJECT_DIR,
    'e2e-current',
    'compact', // Use 'compact' source to include snapshot section
    config,
  );

  closeSeedDb();
  console.log(
    `  Seeded: ${groundTruth.sessions.length} sessions, ` +
      `${groundTruth.decisions.length} decisions, ` +
      `${groundTruth.learnings.length} learnings, ` +
      `${groundTruth.priorPrompts.length} prior prompts`,
  );
  console.log(
    `  Injection context: ${injectionContext ? `${injectionContext.length} chars` : 'empty (!)'}`,
  );
  console.log('');

  // ── Phase 2: Collect responses ────────────────────────────────────────

  console.log('PHASE 2: Collecting responses from both arms...');

  const activeScenarios = scenarioFilter
    ? SCENARIOS.filter((s) => scenarioFilter.includes(s.id))
    : SCENARIOS;

  if (activeScenarios.length === 0) {
    console.error('No matching scenarios found. Available IDs:');
    for (const s of SCENARIOS) {
      console.error(`  ${s.id} — ${s.description}`);
    }
    process.exit(1);
  }

  console.log(`  Running ${activeScenarios.length} scenarios...\n`);

  const runnerConfig: RunnerConfig = {
    pluginDir: PLUGIN_DIR,
    dbPath: DB_PATH,
    model: 'sonnet',
    maxBudgetUsd: 0.15,
    delayMs,
    cwd: PROJECT_DIR,
    injectionContext: injectionContext || undefined,
  };

  const collectedResults: Array<{
    scenario: (typeof SCENARIOS)[0];
    withResponse: Awaited<ReturnType<typeof runScenario>>['withResponse'];
    withoutResponse: Awaited<ReturnType<typeof runScenario>>['withoutResponse'];
  }> = [];

  for (const scenario of activeScenarios) {
    try {
      const result = await runScenario(scenario, runnerConfig);
      collectedResults.push({ scenario, ...result });

      console.log(
        `  [${scenario.id}] With response: ${result.withResponse.responseText.length} chars, ` +
          `$${result.withResponse.costUsd.toFixed(3)}`,
      );
      console.log(
        `  [${scenario.id}] Without response: ${result.withoutResponse.responseText.length} chars, ` +
          `$${result.withoutResponse.costUsd.toFixed(3)}`,
      );
      console.log('');
    } catch (err) {
      console.error(`  [${scenario.id}] ERROR: ${err}`);
      console.error('  Skipping scenario.\n');
    }

    // Delay between scenarios
    if (scenario !== activeScenarios[activeScenarios.length - 1]) {
      await sleep(delayMs);
    }
  }

  if (collectedResults.length === 0) {
    console.error('No scenarios completed successfully. Exiting.');
    process.exit(1);
  }

  // ── Phase 3: Judge ────────────────────────────────────────────────────

  const scenarioResults: ScenarioResult[] = [];
  let totalJudgeCost = 0;

  if (skipJudge) {
    console.log('PHASE 3: Skipped (--skip-judge)');
    console.log('');

    // Use placeholder scores
    const zeroScores: JudgeScores = {
      session_awareness: 0,
      factual_accuracy: 0,
      helpfulness: 0,
      hallucination_resistance: 0,
      overall_quality: 0,
    };

    for (const {
      scenario,
      withResponse,
      withoutResponse,
    } of collectedResults) {
      scenarioResults.push({
        scenarioId: scenario.id,
        category: scenario.category,
        prompt: scenario.prompt,
        withResponse,
        withoutResponse,
        withScores: { ...zeroScores },
        withoutScores: { ...zeroScores },
        winner: 'tie',
      });
    }
  } else {
    console.log('PHASE 3: Judging responses with LLM-as-judge...');
    console.log('');

    for (const {
      scenario,
      withResponse,
      withoutResponse,
    } of collectedResults) {
      try {
        const { withScores, withoutScores, judgeCostUsd } = await judgeScenario(
          scenario,
          withResponse,
          withoutResponse,
          groundTruth,
          delayMs,
        );

        totalJudgeCost += judgeCostUsd;

        const winner = determineWinner(withScores, withoutScores);

        scenarioResults.push({
          scenarioId: scenario.id,
          category: scenario.category,
          prompt: scenario.prompt,
          withResponse,
          withoutResponse,
          withScores,
          withoutScores,
          winner,
        });

        console.log(
          `  [${scenario.id}] Winner: ${winner} ` +
            `(with: ${withScores.overall_quality}, without: ${withoutScores.overall_quality})`,
        );
        console.log('');
      } catch (err) {
        console.error(`  [${scenario.id}] Judge ERROR: ${err}`);
      }

      // Delay between judge calls
      await sleep(delayMs);
    }
  }

  // ── Phase 4: Report ───────────────────────────────────────────────────

  console.log('PHASE 4: Generating report...');
  console.log('');

  const aggregate = computeAggregates(scenarioResults);

  const wins = scenarioResults.filter((s) => s.winner === 'with').length;
  const losses = scenarioResults.filter((s) => s.winner === 'without').length;
  const ties = scenarioResults.filter((s) => s.winner === 'tie').length;

  const withArmCost = collectedResults.reduce(
    (sum, r) => sum + r.withResponse.costUsd,
    0,
  );
  const withoutArmCost = collectedResults.reduce(
    (sum, r) => sum + r.withoutResponse.costUsd,
    0,
  );

  const report: BenchmarkReport = {
    timestamp: new Date().toISOString(),
    scenarios: scenarioResults,
    aggregate,
    summary: { wins, losses, ties },
    costs: {
      withArmUsd: withArmCost,
      withoutArmUsd: withoutArmCost,
      judgeUsd: totalJudgeCost,
      totalUsd: withArmCost + withoutArmCost + totalJudgeCost,
    },
  };

  // Console output
  const consoleReport = generateConsoleReport(report);
  console.log(consoleReport);

  // JSON file
  const jsonPath = path.join(BENCH_DIR, 'benchmark-report.json');
  writeJsonReport(report, jsonPath);

  // Also write to a well-known location for easy retrieval
  const reportDir = path.join(path.dirname(__dirname), 'benchmark-results');
  try {
    fs.mkdirSync(reportDir, { recursive: true });
    const stablePath = path.join(
      reportDir,
      `e2e-${new Date().toISOString().replace(/[:.]/g, '-')}.json`,
    );
    writeJsonReport(report, stablePath);
  } catch {
    // Non-fatal — temp dir copy already exists
  }

  // ── Cleanup info ──────────────────────────────────────────────────────

  console.log(`Temp directory preserved at: ${BENCH_DIR}`);
  console.log('To clean up:');
  console.log(`  rm -rf ${BENCH_DIR}`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
