import type { HookInput, HookOutput } from "./types";
import {
  getSessionActions,
  updateSession,
} from "../core/memory";
import type { ActionRecord } from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Collect unique file paths that were modified during the session.
 */
function collectFilesModified(actions: ActionRecord[]): string[] {
  const files = new Set<string>();

  for (const action of actions) {
    if (action.file_path) {
      files.add(action.file_path);
    }
  }

  return [...files];
}

/**
 * Count actions grouped by action_type.
 */
function countByType(actions: ActionRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};

  for (const action of actions) {
    const type = action.action_type ?? "other";
    counts[type] = (counts[type] ?? 0) + 1;
  }

  return counts;
}

/**
 * Build a structured summary string from actions.
 */
function buildSummary(actions: ActionRecord[]): string {
  if (actions.length === 0) {
    return "Session completed with no recorded actions.";
  }

  const filesModified = collectFilesModified(actions);
  const typeCounts = countByType(actions);
  const failedActions = actions.filter((a) => a.outcome === "failure");

  const lines: string[] = [];

  // Action counts
  const countParts: string[] = [];
  for (const [type, count] of Object.entries(typeCounts)) {
    countParts.push(`${count} ${type}${count !== 1 ? "s" : ""}`);
  }
  lines.push(`Actions: ${countParts.join(", ")}`);

  // Files modified
  lines.push(`Files modified: ${filesModified.length}`);
  if (filesModified.length > 0 && filesModified.length <= 10) {
    for (const f of filesModified) {
      lines.push(`  - ${f}`);
    }
  }

  // Failed actions
  if (failedActions.length > 0) {
    lines.push(`Failures: ${failedActions.length}`);
    for (const f of failedActions.slice(0, 5)) {
      lines.push(`  - ${f.description ?? f.tool_name}: ${f.error_message?.slice(0, 100) ?? "unknown error"}`);
    }
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler: Stop
// ---------------------------------------------------------------------------

export async function handleSessionStop(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const actions = getSessionActions(sessionId);
    const summary = buildSummary(actions);
    const filesModified = collectFilesModified(actions);

    updateSession(sessionId, {
      summary,
      files_modified: JSON.stringify(filesModified),
      ended_at: new Date().toISOString(),
    });

    logger.info(
      `[session-stop] Session ${sessionId} stopped. ${actions.length} actions recorded.`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-stop] ${msg}`);
  }

  return { continue: true };
}
