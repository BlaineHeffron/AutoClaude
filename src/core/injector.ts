import {
  getRecentSummarizedSessions,
  getActiveDecisions,
  getTopLearnings,
  getLatestProjectSnapshot,
} from './memory';
import type {
  SessionRecord,
  DecisionRecord,
  LearningRecord,
  SnapshotRecord,
} from './memory';
import { estimateTokens, truncateToTokenBudget } from '../util/tokens';
import type { AutoClaudeConfig } from '../util/config';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface InjectionOptions {
  /** Current context utilization (0–1). Used for adaptive budget reduction. */
  utilization?: number;
  /** Current task description. Reserved for future pruner-focused injection. */
  currentTask?: string;
}

/**
 * Builds the full context injection string for a session start.
 *
 * Queries the memory store for recent sessions, active decisions, top
 * learnings, and (if resuming/compacting) the latest snapshot. Formats
 * each section as markdown and assembles them under a priority-based
 * token budget.
 *
 * When utilization is provided, the budget is reduced proportionally:
 * - Below warnUtilization (55%): full budget
 * - At warnUtilization: budget scaled down to 50%
 * - At criticalUtilization (70%): budget slashed to 30%, sessions/learnings skipped
 *
 * Returns an empty string when there is nothing to inject.
 */
export function buildInjectionContext(
  projectPath: string,
  sessionId: string,
  source: string | undefined,
  config: AutoClaudeConfig,
  options?: InjectionOptions,
): string {
  const utilization = options?.utilization ?? 0;

  // Compute effective token budget based on utilization
  let effectiveBudget = config.injection.maxTokens;
  let skipSessions = false;
  let skipLearnings = false;

  if (utilization >= config.metrics.criticalUtilization) {
    // Critical: slash to 30%, skip sessions and learnings
    effectiveBudget = Math.floor(config.injection.maxTokens * 0.3);
    skipSessions = true;
    skipLearnings = true;
    logger.info(
      `injector: critical utilization (${(utilization * 100).toFixed(0)}%), budget reduced to ${effectiveBudget} tokens`,
    );
  } else if (utilization >= config.metrics.warnUtilization) {
    // Warning: scale budget proportionally from 100% down to 50%
    const range =
      config.metrics.criticalUtilization - config.metrics.warnUtilization;
    const progress = (utilization - config.metrics.warnUtilization) / range;
    const scale = 1.0 - progress * 0.5; // 1.0 at warn, 0.5 at critical
    effectiveBudget = Math.floor(config.injection.maxTokens * scale);
    logger.info(
      `injector: elevated utilization (${(utilization * 100).toFixed(0)}%), budget reduced to ${effectiveBudget} tokens`,
    );
  }

  // 1. Gather raw data from memory store
  let sessionsSection = '';
  if (!skipSessions && config.injection.includeSessions > 0) {
    const sessions = getRecentSummarizedSessions(
      projectPath,
      config.injection.includeSessions,
    );
    sessionsSection = formatSessionsSection(sessions);
  }

  let decisionsSection = '';
  if (config.injection.includeDecisions) {
    const decisions = getActiveDecisions(projectPath);
    decisionsSection = formatDecisionsSection(decisions);
  }

  let learningsSection = '';
  if (!skipLearnings && config.injection.includeLearnings) {
    const learnings = getTopLearnings(projectPath, 10);
    learningsSection = formatLearningsSection(learnings);
  }

  let snapshotSection = '';
  if (
    config.injection.includeSnapshot &&
    (source === 'compact' || source === 'resume')
  ) {
    snapshotSection = loadSnapshotSection(projectPath, sessionId);
  }

  // 2. Assemble under effective token budget
  const context = assembleContext(
    {
      snapshot: snapshotSection,
      decisions: decisionsSection,
      learnings: learningsSection,
      sessions: sessionsSection,
    },
    effectiveBudget,
  );

  if (context) {
    logger.info(
      `injector: built ~${estimateTokens(context)} tokens of context (budget: ${effectiveBudget})`,
    );
  }

  return context;
}

// ---------------------------------------------------------------------------
// Section formatters
// ---------------------------------------------------------------------------

function formatDate(isoString: string): string {
  try {
    const d = new Date(isoString);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return isoString;
  }
}

function formatSessionsSection(sessions: SessionRecord[]): string {
  if (sessions.length === 0) return '';

  const lines = sessions
    .filter((s) => s.summary)
    .map((s) => `- [${formatDate(s.started_at)}]: ${s.summary}`);

  if (lines.length === 0) return '';

  return `## Recent Sessions\n${lines.join('\n')}`;
}

function formatDecisionsSection(decisions: DecisionRecord[]): string {
  if (decisions.length === 0) return '';

  const lines = decisions.map(
    (d) => `- ${d.category ? `[${d.category}]` : '[general]'}: ${d.decision}`,
  );

  return `## Active Decisions\n${lines.join('\n')}`;
}

function formatLearningsSection(learnings: LearningRecord[]): string {
  if (learnings.length === 0) return '';

  const lines = learnings.map(
    (l) => `- ${l.category ? `[${l.category}]` : '[general]'}: ${l.learning}`,
  );

  return `## Learnings\n${lines.join('\n')}`;
}

function formatSnapshotSection(snapshot: SnapshotRecord): string {
  const parts: string[] = ['## Snapshot (Resuming)'];

  if (snapshot.current_task) {
    parts.push(`**Task:** ${snapshot.current_task}`);
  }
  if (snapshot.progress_summary) {
    parts.push(`**Progress:** ${snapshot.progress_summary}`);
  }
  if (snapshot.next_steps) {
    let steps: string;
    try {
      const parsed = JSON.parse(snapshot.next_steps);
      if (Array.isArray(parsed)) {
        steps = parsed.map((s: string) => `  - ${s}`).join('\n');
      } else {
        steps = `  - ${snapshot.next_steps}`;
      }
    } catch {
      const lines = snapshot.next_steps
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean);
      steps = lines.map((l) => `  - ${l}`).join('\n');
    }
    parts.push(`**Next Steps:**\n${steps}`);
  }

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Snapshot loader
// ---------------------------------------------------------------------------

/**
 * Loads the most recent snapshot from a prior session in this project.
 * Uses a project-wide snapshot query to avoid missing snapshots when
 * multiple sessions exist between the snapshot and the current session.
 */
function loadSnapshotSection(
  projectPath: string,
  currentSessionId: string,
): string {
  const snapshot = getLatestProjectSnapshot(projectPath, currentSessionId);
  if (!snapshot) return '';

  return formatSnapshotSection(snapshot);
}

// ---------------------------------------------------------------------------
// Token-budgeted assembly
// ---------------------------------------------------------------------------

/**
 * Assembles context sections in priority order (snapshot > decisions >
 * learnings > sessions) and trims the combined output to fit within
 * the token budget.
 */
function assembleContext(
  sections: {
    snapshot: string;
    decisions: string;
    learnings: string;
    sessions: string;
  },
  maxTokens: number,
): string {
  const header = '# [autoclaude] Session Context\n';
  const headerTokens = estimateTokens(header);
  let remaining = maxTokens - headerTokens;

  if (remaining <= 0) {
    return truncateToTokenBudget(header, maxTokens);
  }

  // Priority order: snapshot > decisions > learnings > sessions
  const ordered: string[] = [];

  for (const section of [
    sections.snapshot,
    sections.decisions,
    sections.learnings,
    sections.sessions,
  ]) {
    if (!section) continue;

    const sectionTokens = estimateTokens(section);
    if (sectionTokens <= remaining) {
      ordered.push(section);
      remaining -= sectionTokens;
    } else if (remaining > 0) {
      ordered.push(truncateToTokenBudget(section, remaining));
      remaining = 0;
    }
  }

  if (ordered.length === 0) {
    return '';
  }

  return header + '\n' + ordered.join('\n\n');
}
