/**
 * Codex E2E benchmark: compares responses with and without autoclaude-memory.
 *
 * This runs real `codex exec --json` sessions in isolated HOME directories:
 * - "with-autoclaude-memory": MCP server + skill installed
 * - "without-autoclaude-memory": no MCP server, no skill
 *
 * It seeds an isolated AutoClaude DB, executes identical prompts in both arms,
 * and reports keyword coverage + MCP usage evidence.
 */

import { execFile } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { SCENARIOS } from './scenarios';

type ArmName = 'with-autoclaude-memory' | 'without-autoclaude-memory';

interface RunOptions {
  model: string;
  mode: 'passive' | 'guided';
  scenarioIds: string[] | null;
  outputFile: string;
  keepTemp: boolean;
  timeoutMs: number;
}

interface JsonEvent {
  type: string;
  item?: {
    type?: string;
    text?: string;
    server?: string;
    tool?: string;
  };
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

interface ScenarioArmResult {
  output: string;
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
  mcpCalls: number;
  durationMs: number;
  inputTokens: number;
  outputTokens: number;
}

interface ScenarioComparison {
  id: string;
  category: string;
  prompt: string;
  expectedKeywords: string[];
  withArm: ScenarioArmResult;
  withoutArm: ScenarioArmResult;
  coverageDelta: number;
}

function parseArgs(argv: string[]): RunOptions {
  let model = process.env.CODEX_BENCH_MODEL || 'gpt-5.3-codex';
  let mode: 'passive' | 'guided' = 'passive';
  let scenarioIds: string[] | null = null;
  let outputFile = 'benchmark-results/codex-e2e-latest.json';
  let keepTemp = false;
  let timeoutMs = 180000;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--model' && argv[i + 1]) {
      model = argv[++i];
      continue;
    }
    if (arg === '--scenarios' && argv[i + 1]) {
      scenarioIds = argv[++i]
        .split(',')
        .map((v) => v.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === '--mode' && argv[i + 1]) {
      const raw = argv[++i];
      mode = raw === 'guided' ? 'guided' : 'passive';
      continue;
    }
    if (arg === '--output' && argv[i + 1]) {
      outputFile = argv[++i];
      continue;
    }
    if (arg === '--timeout-ms' && argv[i + 1]) {
      timeoutMs = Number(argv[++i]);
      continue;
    }
    if (arg === '--keep-temp') {
      keepTemp = true;
      continue;
    }
  }

  return { model, mode, scenarioIds, outputFile, keepTemp, timeoutMs };
}

function runExecFile(
  cmd: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; durationMs: number }> {
  return new Promise((resolve, reject) => {
    const start = Date.now();
    execFile(
      cmd,
      args,
      {
        cwd,
        env: { ...process.env, ...env },
        timeout: timeoutMs,
        maxBuffer: 20 * 1024 * 1024,
      },
      (err, stdout, stderr) => {
        const durationMs = Date.now() - start;
        if (err) {
          reject(
            new Error(
              `${cmd} ${args.join(' ')} failed: ${err.message}\n${stderr}`,
            ),
          );
          return;
        }
        resolve({ stdout, stderr, durationMs });
      },
    );
  });
}

function copyDirRecursive(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath);
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

function buildPrompt(
  prompt: string,
  mode: 'passive' | 'guided',
  expectedKeywords: string[],
): string {
  if (mode === 'guided') {
    const hintTerms = expectedKeywords.slice(0, 5).join(' ');
    return [
      'Answer concisely.',
      'If MCP server `autoclaude-memory` is available, call its `search` tool before answering.',
      `If available, include search terms related to: ${hintTerms}.`,
      'Base the answer on returned memory results and avoid fabrication.',
      'If memory tools are unavailable, explicitly say that first.',
      '',
      prompt,
    ].join('\n');
  }

  return [
    'Answer concisely.',
    'Use available project memory/context tools if present.',
    'If no memory tools are available, say so briefly and answer from what you can verify.',
    '',
    prompt,
  ].join('\n');
}

function parseJsonLines(stdout: string): JsonEvent[] {
  const events: JsonEvent[] = [];
  for (const line of stdout.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('{')) continue;
    try {
      events.push(JSON.parse(trimmed) as JsonEvent);
    } catch {
      // ignore non-json lines
    }
  }
  return events;
}

function extractRunStats(events: JsonEvent[]): {
  output: string;
  mcpCalls: number;
  inputTokens: number;
  outputTokens: number;
} {
  const agentMessages = events.filter(
    (e) => e.type === 'item.completed' && e.item?.type === 'agent_message',
  );
  const lastMessage = agentMessages.at(-1)?.item?.text || '';

  const mcpCalls = events.filter(
    (e) =>
      e.type === 'item.completed' &&
      e.item?.type === 'mcp_tool_call' &&
      e.item?.server === 'autoclaude-memory',
  ).length;

  const turnCompleted = events
    .filter((e) => e.type === 'turn.completed')
    .at(-1);

  return {
    output: lastMessage,
    mcpCalls,
    inputTokens: turnCompleted?.usage?.input_tokens || 0,
    outputTokens: turnCompleted?.usage?.output_tokens || 0,
  };
}

function scoreKeywordCoverage(
  text: string,
  expectedKeywords: string[],
): {
  coverage: number;
  matchedKeywords: string[];
  missingKeywords: string[];
} {
  const normalized = text.toLowerCase();
  const matched = expectedKeywords.filter((k) =>
    normalized.includes(k.toLowerCase()),
  );
  const missing = expectedKeywords.filter(
    (k) => !normalized.includes(k.toLowerCase()),
  );
  const coverage = expectedKeywords.length
    ? matched.length / expectedKeywords.length
    : 1;

  return {
    coverage,
    matchedKeywords: matched,
    missingKeywords: missing,
  };
}

function writeConfigToml(
  configPath: string,
  projectDir: string,
  model: string,
): void {
  const escapedProject = projectDir.replace(/\\/g, '\\\\');
  const lines = [
    `model = "${model}"`,
    'model_reasoning_effort = "low"',
    '',
    `[projects."${escapedProject}"]`,
    'trust_level = "trusted"',
    '',
  ];
  fs.writeFileSync(configPath, lines.join('\n'));
}

async function prepareArmHome(
  arm: ArmName,
  rootDir: string,
  projectDir: string,
  dbPath: string,
  model: string,
  repoRoot: string,
): Promise<string> {
  const homeDir = path.join(rootDir, arm);
  const codexDir = path.join(homeDir, '.codex');
  fs.mkdirSync(codexDir, { recursive: true });
  fs.mkdirSync(path.join(codexDir, 'skills'), { recursive: true });

  const realAuthPath = path.join(os.homedir(), '.codex', 'auth.json');
  if (!fs.existsSync(realAuthPath)) {
    throw new Error(`Missing auth file at ${realAuthPath}`);
  }
  fs.copyFileSync(realAuthPath, path.join(codexDir, 'auth.json'));
  writeConfigToml(path.join(codexDir, 'config.toml'), projectDir, model);

  if (arm === 'with-autoclaude-memory') {
    const skillSrc = path.join(repoRoot, 'codex-skill', 'autoclaude-codex');
    const skillDest = path.join(codexDir, 'skills', 'autoclaude-codex');
    copyDirRecursive(skillSrc, skillDest);

    const mcpEntry = path.join(repoRoot, 'dist', 'mcp', 'index.js');
    const env = {
      HOME: homeDir,
      CODEX_HOME: codexDir,
    };

    await runExecFile(
      'codex',
      [
        'mcp',
        'add',
        'autoclaude-memory',
        '--env',
        `AUTOCLAUDE_DB=${dbPath}`,
        '--',
        'node',
        mcpEntry,
      ],
      repoRoot,
      env,
      30000,
    );
  }

  return homeDir;
}

async function runScenario(
  arm: ArmName,
  homeDir: string,
  projectDir: string,
  model: string,
  prompt: string,
  timeoutMs: number,
): Promise<ScenarioArmResult> {
  const env = {
    HOME: homeDir,
    CODEX_HOME: path.join(homeDir, '.codex'),
  };

  const cmdArgs = [
    'exec',
    '--json',
    '--skip-git-repo-check',
    '-C',
    projectDir,
    '--model',
    model,
    prompt,
  ];

  const { stdout, durationMs } = await runExecFile(
    'codex',
    cmdArgs,
    projectDir,
    env,
    timeoutMs,
  );

  const events = parseJsonLines(stdout);
  const stats = extractRunStats(events);
  const coverage = scoreKeywordCoverage(stats.output, []);

  return {
    output: stats.output,
    coverage: coverage.coverage,
    matchedKeywords: [],
    missingKeywords: [],
    mcpCalls: stats.mcpCalls,
    durationMs,
    inputTokens: stats.inputTokens,
    outputTokens: stats.outputTokens,
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const repoRoot = path.resolve(__dirname, '..', '..');
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'autoclaude-codex-'));
  const projectDir = path.join(tempRoot, 'project');
  const dbPath = path.join(tempRoot, 'bench.db');

  fs.mkdirSync(projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(projectDir, 'package.json'),
    JSON.stringify({ name: 'codex-e2e-bench', version: '0.0.1' }, null, 2),
  );

  process.env.AUTOCLAUDE_DB = dbPath;
  const { seedBenchmarkDb, closeSeedDb } = await import('./seed');
  seedBenchmarkDb(projectDir);
  closeSeedDb();

  const withHome = await prepareArmHome(
    'with-autoclaude-memory',
    tempRoot,
    projectDir,
    dbPath,
    options.model,
    repoRoot,
  );
  const withoutHome = await prepareArmHome(
    'without-autoclaude-memory',
    tempRoot,
    projectDir,
    dbPath,
    options.model,
    repoRoot,
  );

  const activeScenarios = options.scenarioIds
    ? SCENARIOS.filter((s) => options.scenarioIds!.includes(s.id))
    : SCENARIOS;
  if (activeScenarios.length === 0) {
    throw new Error('No scenarios selected.');
  }

  const comparisons: ScenarioComparison[] = [];

  console.log(
    `Running Codex E2E benchmark with ${activeScenarios.length} scenarios...`,
  );
  console.log(`Model: ${options.model}`);
  console.log(`Temp root: ${tempRoot}`);

  for (let i = 0; i < activeScenarios.length; i++) {
    const scenario = activeScenarios[i];
    const prompt = buildPrompt(
      scenario.prompt,
      options.mode,
      scenario.expectedKeywords,
    );
    console.log(`[${i + 1}/${activeScenarios.length}] ${scenario.id}`);

    const withRaw = await runScenario(
      'with-autoclaude-memory',
      withHome,
      projectDir,
      options.model,
      prompt,
      options.timeoutMs,
    );
    const withoutRaw = await runScenario(
      'without-autoclaude-memory',
      withoutHome,
      projectDir,
      options.model,
      prompt,
      options.timeoutMs,
    );

    const withScore = scoreKeywordCoverage(
      withRaw.output,
      scenario.expectedKeywords,
    );
    const withoutScore = scoreKeywordCoverage(
      withoutRaw.output,
      scenario.expectedKeywords,
    );

    const withArm: ScenarioArmResult = {
      ...withRaw,
      ...withScore,
      coverage: withScore.coverage,
    };
    const withoutArm: ScenarioArmResult = {
      ...withoutRaw,
      ...withoutScore,
      coverage: withoutScore.coverage,
    };

    comparisons.push({
      id: scenario.id,
      category: scenario.category,
      prompt: scenario.prompt,
      expectedKeywords: scenario.expectedKeywords,
      withArm,
      withoutArm,
      coverageDelta: withArm.coverage - withoutArm.coverage,
    });
  }

  const avgWith =
    comparisons.reduce((sum, c) => sum + c.withArm.coverage, 0) /
    comparisons.length;
  const avgWithout =
    comparisons.reduce((sum, c) => sum + c.withoutArm.coverage, 0) /
    comparisons.length;
  const avgDelta = avgWith - avgWithout;

  const withWins = comparisons.filter((c) => c.coverageDelta > 0).length;
  const ties = comparisons.filter((c) => c.coverageDelta === 0).length;
  const withoutWins = comparisons.filter((c) => c.coverageDelta < 0).length;

  const withMcpCalls = comparisons.reduce((s, c) => s + c.withArm.mcpCalls, 0);
  const withoutMcpCalls = comparisons.reduce(
    (s, c) => s + c.withoutArm.mcpCalls,
    0,
  );

  const result = {
    createdAt: new Date().toISOString(),
    model: options.model,
    mode: options.mode,
    scenarios: comparisons,
    summary: {
      scenarioCount: comparisons.length,
      averageKeywordCoverage: {
        withAutoclaudeMemory: avgWith,
        withoutAutoclaudeMemory: avgWithout,
        delta: avgDelta,
      },
      wins: {
        withAutoclaudeMemory: withWins,
        withoutAutoclaudeMemory: withoutWins,
        ties,
      },
      mcpCalls: {
        withAutoclaudeMemory: withMcpCalls,
        withoutAutoclaudeMemory: withoutMcpCalls,
      },
    },
  };

  const outputPath = path.join(repoRoot, options.outputFile);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2));

  console.log('');
  console.log('=== Codex E2E Summary ===');
  console.log(
    `Avg keyword coverage: with=${avgWith.toFixed(3)} without=${avgWithout.toFixed(3)} delta=${avgDelta.toFixed(3)}`,
  );
  console.log(
    `Wins: with=${withWins} without=${withoutWins} ties=${ties} (scenarios=${comparisons.length})`,
  );
  console.log(
    `MCP calls: with=${withMcpCalls} without=${withoutMcpCalls} (autoclaude-memory)`,
  );
  console.log(`Saved result to: ${outputPath}`);

  if (!options.keepTemp) {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept temp artifacts at: ${tempRoot}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
