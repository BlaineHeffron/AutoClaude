/**
 * Report generation for the E2E benchmark.
 * Produces ASCII table console output and a JSON file for programmatic analysis.
 */

import * as fs from 'node:fs';
import type {
  BenchmarkReport,
  DimensionName,
  JudgeScores,
  ScenarioResult,
} from './types';
import { DIMENSION_LABELS } from './types';

const DIMENSIONS: DimensionName[] = [
  'session_awareness',
  'factual_accuracy',
  'helpfulness',
  'hallucination_resistance',
  'overall_quality',
];

function pad(s: string, width: number): string {
  return s.length >= width
    ? s.slice(0, width)
    : s + ' '.repeat(width - s.length);
}

function rpad(s: string, width: number): string {
  return s.length >= width
    ? s.slice(0, width)
    : ' '.repeat(width - s.length) + s;
}

function fmtScore(n: number): string {
  return n.toFixed(1);
}

function fmtDelta(n: number): string {
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(1)}`;
}

/**
 * Determines the winner for a scenario based on overall_quality,
 * with tie-breaking on session_awareness.
 */
export function determineWinner(
  withScores: JudgeScores,
  withoutScores: JudgeScores,
): 'with' | 'without' | 'tie' {
  const diff = withScores.overall_quality - withoutScores.overall_quality;
  if (diff > 0.5) return 'with';
  if (diff < -0.5) return 'without';

  // Tie-break on session_awareness
  const saDiff = withScores.session_awareness - withoutScores.session_awareness;
  if (saDiff > 0.5) return 'with';
  if (saDiff < -0.5) return 'without';

  return 'tie';
}

/**
 * Computes aggregate scores across all scenarios.
 */
export function computeAggregates(scenarios: ScenarioResult[]): {
  withAvg: JudgeScores;
  withoutAvg: JudgeScores;
  delta: JudgeScores;
} {
  const n = scenarios.length;
  if (n === 0) {
    const zero: JudgeScores = {
      session_awareness: 0,
      factual_accuracy: 0,
      helpfulness: 0,
      hallucination_resistance: 0,
      overall_quality: 0,
    };
    return {
      withAvg: { ...zero },
      withoutAvg: { ...zero },
      delta: { ...zero },
    };
  }

  const withAvg: JudgeScores = {
    session_awareness: 0,
    factual_accuracy: 0,
    helpfulness: 0,
    hallucination_resistance: 0,
    overall_quality: 0,
  };
  const withoutAvg: JudgeScores = { ...withAvg };

  for (const s of scenarios) {
    for (const d of DIMENSIONS) {
      withAvg[d] += s.withScores[d];
      withoutAvg[d] += s.withoutScores[d];
    }
  }

  const delta: JudgeScores = { ...withAvg };
  for (const d of DIMENSIONS) {
    withAvg[d] /= n;
    withoutAvg[d] /= n;
    delta[d] = withAvg[d] - withoutAvg[d];
  }

  return { withAvg, withoutAvg, delta };
}

/**
 * Generates the ASCII table report for console output.
 */
export function generateConsoleReport(report: BenchmarkReport): string {
  const lines: string[] = [];
  const W = 66;

  lines.push('');
  lines.push('='.repeat(W));
  lines.push('  AUTOCLAUDE E2E BENCHMARK RESULTS');
  lines.push('='.repeat(W));
  lines.push('');

  // Per-scenario results
  lines.push('SCENARIO RESULTS');
  const hdrLine =
    pad('Scenario', 20) +
    ' ' +
    pad('Dimension', 24) +
    ' ' +
    rpad('With', 5) +
    ' ' +
    rpad('W/out', 5) +
    ' ' +
    rpad('Delta', 6);
  lines.push('-'.repeat(W));
  lines.push(hdrLine);
  lines.push('-'.repeat(W));

  for (const s of report.scenarios) {
    let first = true;
    for (const d of DIMENSIONS) {
      const label = first ? s.scenarioId : '';
      const dimLabel = DIMENSION_LABELS[d];
      const withVal = fmtScore(s.withScores[d]);
      const withoutVal = fmtScore(s.withoutScores[d]);
      const deltaVal = fmtDelta(s.withScores[d] - s.withoutScores[d]);

      lines.push(
        pad(label, 20) +
          ' ' +
          pad(dimLabel, 24) +
          ' ' +
          rpad(withVal, 5) +
          ' ' +
          rpad(withoutVal, 5) +
          ' ' +
          rpad(deltaVal, 6),
      );
      first = false;
    }
    lines.push('');
  }

  // Aggregate scores
  lines.push('AGGREGATE SCORES');
  lines.push('-'.repeat(50));
  lines.push(
    pad('Dimension', 24) +
      ' ' +
      rpad('With', 6) +
      ' ' +
      rpad('W/out', 6) +
      ' ' +
      rpad('Delta', 6),
  );
  lines.push('-'.repeat(50));

  for (const d of DIMENSIONS) {
    lines.push(
      pad(DIMENSION_LABELS[d], 24) +
        ' ' +
        rpad(fmtScore(report.aggregate.withAvg[d]), 6) +
        ' ' +
        rpad(fmtScore(report.aggregate.withoutAvg[d]), 6) +
        ' ' +
        rpad(fmtDelta(report.aggregate.delta[d]), 6),
    );
  }

  lines.push('');

  // Summary
  const { wins, losses, ties } = report.summary;
  const total = wins + losses + ties;
  lines.push(
    `SUMMARY: AutoClaude wins ${wins}/${total} scenarios, ` +
      `loses ${losses}/${total}, ties ${ties}/${total}`,
  );

  const { withArmUsd, withoutArmUsd, judgeUsd, totalUsd } = report.costs;
  lines.push(
    `Total cost: $${totalUsd.toFixed(2)} ` +
      `(with: $${withArmUsd.toFixed(2)}, ` +
      `without: $${withoutArmUsd.toFixed(2)}, ` +
      `judge: $${judgeUsd.toFixed(2)})`,
  );

  lines.push('');

  return lines.join('\n');
}

/**
 * Writes the full JSON report to a file.
 */
export function writeJsonReport(
  report: BenchmarkReport,
  outputPath: string,
): void {
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
  console.log(`JSON report written to: ${outputPath}`);
}
