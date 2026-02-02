/**
 * LLM-as-judge scoring module.
 *
 * Evaluates each response independently (not side-by-side) to avoid
 * position bias. Each response is scored against ground truth on 5
 * dimensions (0-5).
 */

import { execFile } from 'node:child_process';
import type {
  ArmResponse,
  DimensionName,
  GroundTruth,
  JudgeScores,
  Scenario,
} from './types';

const JUDGE_MODEL = 'sonnet';
const JUDGE_BUDGET = 0.08;

function runClaudeJudge(
  prompt: string,
  timeoutMs: number = 60_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const args = [
      '--print',
      '--setting-sources',
      '',
      '--model',
      JUDGE_MODEL,
      '--no-session-persistence',
      '--max-budget-usd',
      String(JUDGE_BUDGET),
      prompt,
    ];

    execFile(
      'claude',
      args,
      {
        env: { ...process.env },
        maxBuffer: 10 * 1024 * 1024,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        if (error && !stdout) {
          reject(
            new Error(`Judge call failed: ${error.message}\nstderr: ${stderr}`),
          );
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function buildGroundTruthDoc(groundTruth: GroundTruth): string {
  const lines: string[] = [];

  lines.push('## Ground Truth: Seeded Project Context');
  lines.push('');
  lines.push('### Session History');
  for (const s of groundTruth.sessions) {
    lines.push(`- **${s.topic}**: ${s.summary}`);
  }

  lines.push('');
  lines.push('### Architecture Decisions');
  for (const d of groundTruth.decisions) {
    lines.push(`- **${d.decision}** (${d.category}): ${d.rationale}`);
  }

  lines.push('');
  lines.push('### Learnings / Gotchas');
  for (const l of groundTruth.learnings) {
    lines.push(`- **${l.learning}** (${l.category}): ${l.context}`);
  }

  lines.push('');
  lines.push('### Most Recent Work');
  lines.push(`- Task: ${groundTruth.recentWork.task}`);
  lines.push(`- Progress: ${groundTruth.recentWork.progress}`);
  lines.push(`- Next Steps: ${groundTruth.recentWork.nextSteps.join(', ')}`);

  lines.push('');
  lines.push('### Prior Prompts (for repeated instruction detection)');
  for (const p of groundTruth.priorPrompts) {
    lines.push(`- "${p}"`);
  }

  return lines.join('\n');
}

function buildJudgePrompt(
  scenario: Scenario,
  response: ArmResponse,
  groundTruth: GroundTruth,
): string {
  const groundTruthDoc = buildGroundTruthDoc(groundTruth);

  return `You are a benchmark evaluator. Score the following AI assistant response on 5 dimensions using a 0-5 scale.

## Context
A user is working on a software project. The project has the following known context (ground truth):

${groundTruthDoc}

## User Prompt
"${scenario.prompt}"

## Scenario Category
${scenario.category}: ${scenario.description}

## AI Response Being Evaluated
${response.responseText}

## Scoring Rubric (0-5 each)

1. **session_awareness** — Does the response reference or demonstrate knowledge of prior session context? (0 = no awareness, 5 = specific references to prior sessions/tasks)
2. **factual_accuracy** — Are the decisions, learnings, and facts mentioned actually correct per the ground truth? (0 = fabricated facts, 5 = all facts match ground truth)
3. **helpfulness** — Is the response actionable and useful for the user? (0 = useless, 5 = highly actionable)
4. **hallucination_resistance** — Does the response avoid fabricating specific details not in the ground truth? (0 = heavy hallucination, 5 = no hallucination, only verifiable claims)
5. **overall_quality** — Holistic assessment of the response quality. (0 = terrible, 5 = excellent)

## Instructions
Respond ONLY with a JSON object. No explanation, no markdown code fences, no other text.
The JSON must have exactly these 5 keys with numeric values 0-5:
{"session_awareness": N, "factual_accuracy": N, "helpfulness": N, "hallucination_resistance": N, "overall_quality": N}`;
}

const DEFAULT_SCORES: JudgeScores = {
  session_awareness: 0,
  factual_accuracy: 0,
  helpfulness: 0,
  hallucination_resistance: 0,
  overall_quality: 0,
};

const DIMENSION_KEYS: DimensionName[] = [
  'session_awareness',
  'factual_accuracy',
  'helpfulness',
  'hallucination_resistance',
  'overall_quality',
];

function parseJudgeResponse(raw: string): JudgeScores {
  // Try to extract JSON from the response (may have surrounding text)
  const jsonMatch = raw.match(/\{[^}]*\}/);
  if (!jsonMatch) {
    console.warn('  [judge] Could not find JSON in response, using defaults');
    return { ...DEFAULT_SCORES };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;
    const scores: JudgeScores = { ...DEFAULT_SCORES };

    for (const key of DIMENSION_KEYS) {
      const val = parsed[key];
      if (typeof val === 'number' && val >= 0 && val <= 5) {
        scores[key] = val;
      }
    }

    return scores;
  } catch {
    console.warn('  [judge] Failed to parse JSON, using defaults');
    return { ...DEFAULT_SCORES };
  }
}

/**
 * Judges a single response against ground truth.
 * Returns scores on 5 dimensions (0-5).
 */
export async function judgeResponse(
  scenario: Scenario,
  response: ArmResponse,
  groundTruth: GroundTruth,
): Promise<{ scores: JudgeScores; costUsd: number }> {
  const prompt = buildJudgePrompt(scenario, response, groundTruth);

  try {
    const raw = await runClaudeJudge(prompt);
    const scores = parseJudgeResponse(raw);
    // Rough cost estimate for judge call
    const costUsd = 0.03;
    return { scores, costUsd };
  } catch (err) {
    console.warn(
      `  [judge] Error judging ${response.arm} for ${scenario.id}: ${err}`,
    );
    return { scores: { ...DEFAULT_SCORES }, costUsd: 0 };
  }
}

/**
 * Judges both arms for a scenario.
 * Runs sequentially to avoid rate limiting.
 */
export async function judgeScenario(
  scenario: Scenario,
  withResponse: ArmResponse,
  withoutResponse: ArmResponse,
  groundTruth: GroundTruth,
  delayMs: number = 1000,
): Promise<{
  withScores: JudgeScores;
  withoutScores: JudgeScores;
  judgeCostUsd: number;
}> {
  console.log(`  [${scenario.id}] Judging with-autoclaude response...`);
  const withResult = await judgeResponse(scenario, withResponse, groundTruth);

  await new Promise((resolve) => setTimeout(resolve, delayMs));

  console.log(`  [${scenario.id}] Judging without-autoclaude response...`);
  const withoutResult = await judgeResponse(
    scenario,
    withoutResponse,
    groundTruth,
  );

  return {
    withScores: withResult.scores,
    withoutScores: withoutResult.scores,
    judgeCostUsd: withResult.costUsd + withoutResult.costUsd,
  };
}
