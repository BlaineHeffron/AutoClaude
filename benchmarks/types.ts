/**
 * Shared types for the E2E benchmark.
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
