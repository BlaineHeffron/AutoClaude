/**
 * Shared types for the E2E benchmark comparing AutoClaude vs vanilla Claude Code.
 */

export type ScenarioCategory =
  | 'session-continuity'
  | 'project-knowledge'
  | 'cold-start'
  | 'repeated-instruction';

export interface Scenario {
  id: string;
  category: ScenarioCategory;
  prompt: string;
  /** Keywords from seeded ground truth that the "with" arm should surface. */
  expectedKeywords: string[];
  /** Human-readable description of what this scenario tests. */
  description: string;
}

export interface ArmResponse {
  arm: 'with-autoclaude' | 'without-autoclaude';
  scenarioId: string;
  responseText: string;
  /** Raw JSON output from `claude --print --output-format json` */
  rawJson: ClaudeJsonOutput | null;
  durationMs: number;
  costUsd: number;
}

export interface ClaudeJsonOutput {
  result: string;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  num_turns?: number;
  usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

export type DimensionName =
  | 'session_awareness'
  | 'factual_accuracy'
  | 'helpfulness'
  | 'hallucination_resistance'
  | 'overall_quality';

export const DIMENSION_LABELS: Record<DimensionName, string> = {
  session_awareness: 'Session Awareness',
  factual_accuracy: 'Factual Accuracy',
  helpfulness: 'Helpfulness',
  hallucination_resistance: 'Hallucination Resistance',
  overall_quality: 'Overall Quality',
};

export type JudgeScores = Record<DimensionName, number>;

export interface ScenarioResult {
  scenarioId: string;
  category: ScenarioCategory;
  prompt: string;
  withResponse: ArmResponse;
  withoutResponse: ArmResponse;
  withScores: JudgeScores;
  withoutScores: JudgeScores;
  winner: 'with' | 'without' | 'tie';
}

export interface BenchmarkReport {
  timestamp: string;
  scenarios: ScenarioResult[];
  aggregate: {
    withAvg: JudgeScores;
    withoutAvg: JudgeScores;
    delta: JudgeScores;
  };
  summary: {
    wins: number;
    losses: number;
    ties: number;
  };
  costs: {
    withArmUsd: number;
    withoutArmUsd: number;
    judgeUsd: number;
    totalUsd: number;
  };
}

export interface GroundTruth {
  sessions: Array<{
    topic: string;
    summary: string;
  }>;
  decisions: Array<{
    decision: string;
    category: string;
    rationale: string;
  }>;
  learnings: Array<{
    learning: string;
    category: string;
    context: string;
  }>;
  recentWork: {
    task: string;
    progress: string;
    nextSteps: string[];
  };
  priorPrompts: string[];
}
