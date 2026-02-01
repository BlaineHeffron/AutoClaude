import type { HookInput, HookOutput } from "./types";
import {
  getSession,
  getSessionActions,
  updateSession,
} from "../core/memory";
import type { ActionRecord } from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Generate a basic summary from actions when the session was not
 * properly stopped (e.g. crashed or timed out).
 */
function generateBasicSummary(actions: ActionRecord[]): string {
  if (actions.length === 0) {
    return "Session ended with no recorded actions.";
  }

  const typeCounts: Record<string, number> = {};
  const files = new Set<string>();

  for (const action of actions) {
    const type = action.action_type ?? "other";
    typeCounts[type] = (typeCounts[type] ?? 0) + 1;
    if (action.file_path) {
      files.add(action.file_path);
    }
  }

  const countParts: string[] = [];
  for (const [type, count] of Object.entries(typeCounts)) {
    countParts.push(`${count} ${type}${count !== 1 ? "s" : ""}`);
  }

  return `Session ended. Actions: ${countParts.join(", ")}. Files touched: ${files.size}.`;
}

// ---------------------------------------------------------------------------
// Handler: SessionEnd
// ---------------------------------------------------------------------------

export async function handleSessionEnd(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const session = getSession(sessionId);

    if (!session) {
      logger.warn(`[session-end] No session record found for ${sessionId}`);
      return { continue: true };
    }

    const updates: Record<string, unknown> = {};

    // Ensure ended_at is set
    if (!session.ended_at) {
      updates.ended_at = new Date().toISOString();
    }

    // Ensure a summary exists
    if (!session.summary) {
      const actions = getSessionActions(sessionId);
      updates.summary = generateBasicSummary(actions);

      // Also populate files_modified if missing
      if (!session.files_modified) {
        const files = new Set<string>();
        for (const action of actions) {
          if (action.file_path) {
            files.add(action.file_path);
          }
        }
        updates.files_modified = JSON.stringify([...files]);
      }
    }

    if (Object.keys(updates).length > 0) {
      updateSession(sessionId, updates);
      logger.info(
        `[session-end] Finalized session ${sessionId} (updated: ${Object.keys(updates).join(", ")})`,
      );
    } else {
      logger.debug(
        `[session-end] Session ${sessionId} already finalized, no updates needed.`,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-end] ${msg}`);
  }

  return { continue: true };
}
