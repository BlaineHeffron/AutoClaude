import type { HookInput, HookOutput } from "./types";
import {
  getSession,
  getSessionActions,
  insertSnapshot,
} from "../core/memory";
import type { ActionRecord } from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable progress summary from a list of actions,
 * e.g. "5 edits, 2 tests, 1 build".
 */
function buildProgressSummary(actions: ActionRecord[]): string {
  const counts: Record<string, number> = {};

  for (const action of actions) {
    const type = action.action_type ?? "other";
    counts[type] = (counts[type] ?? 0) + 1;
  }

  const parts: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    parts.push(`${count} ${type}${count !== 1 ? "s" : ""}`);
  }

  return parts.length > 0 ? parts.join(", ") : "no actions recorded";
}

/**
 * Extract unique file paths from actions as a JSON array string.
 */
function extractWorkingFiles(actions: ActionRecord[]): string {
  const files = new Set<string>();

  for (const action of actions) {
    if (action.file_path) {
      files.add(action.file_path);
    }
  }

  return JSON.stringify([...files]);
}

// ---------------------------------------------------------------------------
// Handler: PreCompact
// ---------------------------------------------------------------------------

export async function handlePreCompact(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const actions = getSessionActions(sessionId);
    const session = getSession(sessionId);

    const currentTask = session?.task_description ?? null;
    const progressSummary = buildProgressSummary(actions);
    const workingFiles = extractWorkingFiles(actions);

    insertSnapshot({
      session_id: sessionId,
      trigger: "pre-compact",
      current_task: currentTask,
      progress_summary: progressSummary,
      open_questions: JSON.stringify([]),
      next_steps: JSON.stringify([]),
      working_files: workingFiles,
    });

    logger.info(
      `[pre-compact] Snapshot saved for session ${sessionId}: ${progressSummary}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[pre-compact] ${msg}`);
  }

  return {
    continue: true,
    hookSpecificOutput: {
      systemMessage: "Context snapshot saved to memory",
    },
  };
}
