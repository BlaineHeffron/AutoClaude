/**
 * Wraps `claude --print` invocations for both experimental arms.
 *
 * - "with-autoclaude": loads the plugin via --plugin-dir, points AUTOCLAUDE_DB
 *   at the seeded test database
 * - "without-autoclaude": no plugin, --setting-sources "" to prevent user plugins
 */

import { execFile } from 'node:child_process';
import type { ArmResponse, ClaudeJsonOutput, Scenario } from './types';

export interface RunnerConfig {
  /** Path to the autoclaude plugin root (this repo). */
  pluginDir: string;
  /** Path to the seeded test database file. */
  dbPath: string;
  /** Model to use (default: sonnet). */
  model: string;
  /** Max budget per call in USD (default: 0.15). */
  maxBudgetUsd: number;
  /** Delay between calls in ms to avoid rate limiting (default: 1000). */
  delayMs: number;
  /** Working directory for claude invocations. */
  cwd: string;
  /**
   * Pre-built injection context to prepend to prompts for the "with" arm.
   * Needed because --print mode does not fire plugin hooks, so we inject
   * the memory context directly into the prompt.
   */
  injectionContext?: string;
}

const DEFAULT_CONFIG: Partial<RunnerConfig> = {
  model: 'sonnet',
  maxBudgetUsd: 0.15,
  delayMs: 1000,
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function runClaude(
  args: string[],
  env: Record<string, string>,
  cwd: string,
  timeoutMs: number = 120_000,
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    const proc = execFile(
      'claude',
      args,
      {
        env: { ...process.env, ...env },
        cwd,
        maxBuffer: 10 * 1024 * 1024, // 10MB
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (error && !stdout) {
          reject(
            new Error(
              `claude exited with error: ${error.message}\nstderr: ${stderr}`,
            ),
          );
          return;
        }
        // claude may exit non-zero but still produce output (e.g. budget exceeded)
        resolve({ stdout, stderr, durationMs });
      },
    );

    // Close stdin so claude --print doesn't wait for piped input
    proc.stdin?.end();

    // Safety: kill if timeout fires before execFile's timeout
    const timer = setTimeout(() => {
      proc.kill('SIGTERM');
    }, timeoutMs + 5000);
    proc.on('exit', () => clearTimeout(timer));
  });
}

function parseClaudeOutput(stdout: string): {
  text: string;
  json: ClaudeJsonOutput | null;
  cost: number;
} {
  try {
    const parsed = JSON.parse(stdout) as ClaudeJsonOutput;
    return {
      text: parsed.result ?? '',
      json: parsed,
      cost: parsed.total_cost_usd ?? parsed.cost_usd ?? 0,
    };
  } catch {
    // Fallback: treat as plain text (--output-format json may have failed)
    return { text: stdout, json: null, cost: 0 };
  }
}

/**
 * Runs a scenario with the AutoClaude plugin loaded.
 */
export async function runWithAutoclaude(
  scenario: Scenario,
  config: RunnerConfig,
): Promise<ArmResponse> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  // Prepend injection context to the prompt so Claude has memory context.
  // This is necessary because --print mode does not fire plugin hooks.
  const fullPrompt = cfg.injectionContext
    ? `<autoclaude-context>\n${cfg.injectionContext}\n</autoclaude-context>\n\n${scenario.prompt}`
    : scenario.prompt;

  const args = [
    '--print',
    '--setting-sources',
    '',
    '--model',
    cfg.model!,
    '--no-session-persistence',
    '--max-budget-usd',
    String(cfg.maxBudgetUsd),
    '--output-format',
    'json',
    fullPrompt,
  ];

  const env: Record<string, string> = {
    AUTOCLAUDE_DB: cfg.dbPath,
  };

  const { stdout, durationMs } = await runClaude(args, env, cfg.cwd);
  const { text, json, cost } = parseClaudeOutput(stdout);

  return {
    arm: 'with-autoclaude',
    scenarioId: scenario.id,
    responseText: text,
    rawJson: json,
    durationMs,
    costUsd: cost,
  };
}

/**
 * Runs a scenario without any plugin (vanilla Claude Code).
 */
export async function runWithoutAutoclaude(
  scenario: Scenario,
  config: RunnerConfig,
): Promise<ArmResponse> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  const args = [
    '--print',
    '--setting-sources',
    '',
    '--model',
    cfg.model!,
    '--no-session-persistence',
    '--max-budget-usd',
    String(cfg.maxBudgetUsd),
    '--output-format',
    'json',
    scenario.prompt,
  ];

  // Set HOME to a temp dir to prevent any user-level plugin loading
  const env: Record<string, string> = {};

  const { stdout, durationMs } = await runClaude(args, env, cfg.cwd);
  const { text, json, cost } = parseClaudeOutput(stdout);

  return {
    arm: 'without-autoclaude',
    scenarioId: scenario.id,
    responseText: text,
    rawJson: json,
    durationMs,
    costUsd: cost,
  };
}

/**
 * Runs both arms for a single scenario with a delay between calls.
 */
export async function runScenario(
  scenario: Scenario,
  config: RunnerConfig,
): Promise<{ withResponse: ArmResponse; withoutResponse: ArmResponse }> {
  const cfg = { ...DEFAULT_CONFIG, ...config };

  console.log(`  [${scenario.id}] Running with-autoclaude...`);
  const withResponse = await runWithAutoclaude(scenario, config);

  await sleep(cfg.delayMs!);

  console.log(`  [${scenario.id}] Running without-autoclaude...`);
  const withoutResponse = await runWithoutAutoclaude(scenario, config);

  return { withResponse, withoutResponse };
}
