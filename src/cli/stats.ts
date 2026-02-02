import type { HookInput, HookOutput } from './types';
import {
  getSession,
  getSessionActions,
  getSessionMetrics,
  getActiveDecisions,
  getTopLearnings,
  getProjectMetrics,
} from '../core/memory';
import { estimateUtilization } from '../core/metrics';
import { countByType } from '../core/summarizer';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Stats handler — comprehensive per-session and per-project rollups
// ---------------------------------------------------------------------------

export async function handleStats(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const session = getSession(sessionId);
    const projectPath = session?.project_path ?? input.cwd ?? process.cwd();

    // Check for --project or --session flags in argv
    const flags = process.argv.slice(3);
    const showProjectOnly = flags.includes('--project');
    const showSessionOnly = flags.includes('--session');

    const lines: string[] = [];

    lines.push('## AutoClaude Stats Dashboard');
    lines.push('');

    // -----------------------------------------------------------------
    // Session section (skip if --project flag)
    // -----------------------------------------------------------------
    if (!showProjectOnly) {
      lines.push('### Current Session');

      if (session) {
        lines.push(`- **ID:** \`${session.id}\``);
        lines.push(`- **Project:** ${session.project_path}`);
        lines.push(`- **Started:** ${session.started_at}`);
        lines.push(`- **Status:** ${session.ended_at ? 'ended' : 'active'}`);
        if (session.task_description) {
          lines.push(`- **Task:** ${session.task_description}`);
        }
        lines.push(`- **Compactions:** ${session.compaction_count}`);

        // Live utilization from transcript
        if (input.transcript_path) {
          const util = estimateUtilization(input.transcript_path);
          const pct = (util.utilization * 100).toFixed(1);
          const bar = renderBar(util.utilization);
          lines.push(
            `- **Utilization:** ${bar} ${pct}% (~${formatTokens(util.estimatedTokens)} tokens)`,
          );

          if (session.context_utilization_peak) {
            lines.push(
              `- **Peak utilization:** ${(session.context_utilization_peak * 100).toFixed(1)}%`,
            );
          }
        }
      } else {
        lines.push('No session record found.');
      }
      lines.push('');

      // Action breakdown
      const actions = getSessionActions(sessionId);
      lines.push('### Actions (this session)');
      if (actions.length === 0) {
        lines.push('No actions recorded.');
      } else {
        const typeCounts = countByType(actions);
        let failures = 0;
        for (const a of actions) {
          if (a.outcome === 'failure') failures++;
        }

        lines.push(`- **Total:** ${actions.length}`);
        for (const [type, count] of Object.entries(typeCounts)) {
          lines.push(`  - ${type}: ${count}`);
        }
        if (failures > 0) {
          lines.push(`- **Failures:** ${failures}`);
        }
      }
      lines.push('');

      // Session metrics
      const metrics = getSessionMetrics(sessionId);
      if (metrics.length > 0) {
        lines.push('### Metrics (this session)');
        // Group by metric name, show latest value
        const latest = new Map<string, number>();
        for (const m of metrics) {
          latest.set(m.metric_name, m.metric_value);
        }
        for (const [name, value] of latest) {
          if (name === 'context_utilization') {
            lines.push(`- ${name}: ${(value * 100).toFixed(1)}%`);
          } else {
            lines.push(`- ${name}: ${value}`);
          }
        }
        lines.push('');
      }

      // Recommendation
      lines.push('### Recommendation');
      if (input.transcript_path) {
        const util = estimateUtilization(input.transcript_path);
        if (util.utilization >= 0.7) {
          lines.push('Run `/compact` now to free context space.');
        } else if (util.utilization >= 0.55) {
          lines.push(
            'Context is filling up. Consider compacting soon or being concise.',
          );
        } else {
          lines.push('Context utilization is healthy. Continue working.');
        }
      } else {
        lines.push(
          'Transcript path not available — cannot estimate utilization.',
        );
      }
      lines.push('');
    }

    // -----------------------------------------------------------------
    // Project section (skip if --session flag)
    // -----------------------------------------------------------------
    if (!showSessionOnly) {
      lines.push('### Project Overview');

      const pm = getProjectMetrics(projectPath);
      lines.push(`- **Sessions:** ${pm.sessionCount}`);
      lines.push(`- **Total actions:** ${pm.totalActions}`);
      lines.push(`- **Total failures:** ${pm.totalFailures}`);
      if (pm.avgUtilization > 0) {
        lines.push(
          `- **Avg peak utilization:** ${(pm.avgUtilization * 100).toFixed(1)}%`,
        );
      }
      lines.push(`- **Total compactions:** ${pm.totalCompactions}`);
      if (pm.sessionCount > 0) {
        lines.push(
          `- **Compaction frequency:** ${(pm.totalCompactions / pm.sessionCount).toFixed(1)} per session`,
        );
      }
      lines.push(`- **Prompts logged:** ${pm.promptCount}`);
      lines.push('');

      // Decisions
      const decisions = getActiveDecisions(projectPath, 100);
      lines.push(`### Decisions (${decisions.length} active)`);
      if (decisions.length === 0) {
        lines.push('No active decisions.');
      } else {
        for (const d of decisions.slice(0, 10)) {
          const cat = d.category ? `[${d.category}]` : '';
          lines.push(`- ${cat} ${d.decision.slice(0, 120)}`);
        }
        if (decisions.length > 10) {
          lines.push(`  ...and ${decisions.length - 10} more`);
        }
      }
      lines.push('');

      // Learnings
      const learnings = getTopLearnings(projectPath, 20);
      lines.push(`### Learnings (${learnings.length} total, by relevance)`);
      if (learnings.length === 0) {
        lines.push('No learnings recorded.');
      } else {
        for (const l of learnings.slice(0, 10)) {
          const cat = l.category ? `[${l.category}]` : '';
          const score = l.relevance_score.toFixed(2);
          const refs =
            l.times_referenced > 0 ? ` (ref: ${l.times_referenced}x)` : '';
          lines.push(
            `- ${cat} ${l.learning.slice(0, 120)} — relevance: ${score}${refs}`,
          );
        }
        if (learnings.length > 10) {
          lines.push(`  ...and ${learnings.length - 10} more`);
        }

        // Average relevance
        const avgRelevance =
          learnings.reduce((sum, l) => sum + l.relevance_score, 0) /
          learnings.length;
        lines.push(`- **Avg relevance:** ${avgRelevance.toFixed(3)}`);
      }
      lines.push('');
    }

    const formatted = lines.join('\n');

    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: formatted,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[stats] ${msg}`);
    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: `Error generating stats: ${msg}`,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderBar(utilization: number): string {
  const filled = Math.round(utilization * 20);
  const empty = 20 - filled;
  return '[' + '█'.repeat(filled) + '░'.repeat(empty) + ']';
}

function formatTokens(tokens: number): string {
  if (tokens >= 1000) {
    return `${(tokens / 1000).toFixed(1)}k`;
  }
  return String(tokens);
}
