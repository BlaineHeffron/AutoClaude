import type { HookInput, HookOutput } from "./types";
import {
  getSession,
  getSessionActions,
  getSessionMetrics,
  getActiveDecisions,
  getTopLearnings,
  getRecentSessions,
} from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Stats handler
// ---------------------------------------------------------------------------

export async function handleStats(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const session = getSession(sessionId);
    const projectPath = session?.project_path ?? input.cwd ?? process.cwd();

    const lines: string[] = [];

    lines.push("## Autoclaude Stats Dashboard");
    lines.push("");

    // --- Current session info ---
    lines.push("### Current Session");
    if (session) {
      lines.push(`  ID:       ${session.id}`);
      lines.push(`  Project:  ${session.project_path}`);
      lines.push(`  Started:  ${session.started_at}`);
      lines.push(`  Status:   ${session.ended_at ? "ended" : "active"}`);
      if (session.task_description) {
        lines.push(`  Task:     ${session.task_description}`);
      }
      lines.push(`  Compactions: ${session.compaction_count}`);
    } else {
      lines.push("  No session record found.");
    }
    lines.push("");

    // --- Action counts ---
    const actions = getSessionActions(sessionId);
    lines.push("### Actions (this session)");
    if (actions.length === 0) {
      lines.push("  No actions recorded.");
    } else {
      const typeCounts: Record<string, number> = {};
      let failures = 0;
      for (const action of actions) {
        const type = action.action_type ?? "other";
        typeCounts[type] = (typeCounts[type] ?? 0) + 1;
        if (action.outcome === "failure") failures++;
      }

      lines.push(`  Total:    ${actions.length}`);
      for (const [type, count] of Object.entries(typeCounts)) {
        lines.push(`  ${type}: ${count}`);
      }
      if (failures > 0) {
        lines.push(`  Failures: ${failures}`);
      }
    }
    lines.push("");

    // --- Metrics ---
    const metrics = getSessionMetrics(sessionId);
    if (metrics.length > 0) {
      lines.push("### Metrics (this session)");
      for (const m of metrics) {
        lines.push(`  ${m.metric_name}: ${m.metric_value}`);
      }
      lines.push("");
    }

    // --- Memory stats ---
    lines.push("### Memory Stats (project-wide)");

    const recentSessions = getRecentSessions(projectPath, 1000);
    const decisions = getActiveDecisions(projectPath, 1000);
    const learnings = getTopLearnings(projectPath, 1000);

    lines.push(`  Total sessions:   ${recentSessions.length}`);
    lines.push(`  Active decisions: ${decisions.length}`);
    lines.push(`  Learnings:        ${learnings.length}`);

    if (learnings.length > 0) {
      const avgRelevance =
        learnings.reduce((sum, l) => sum + l.relevance_score, 0) /
        learnings.length;
      lines.push(`  Avg relevance:    ${avgRelevance.toFixed(3)}`);
    }

    const formatted = lines.join("\n");

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
