import type { HookInput, HookOutput } from "./types";
import {
  getSession,
  getSessionActions,
  updateSession,
} from "../core/memory";
import { summarizeSession, collectUniqueFiles } from "../core/summarizer";
import { logger } from "../util/logger";

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

    // Ensure a summary exists (fallback if session-stop didn't run)
    if (!session.summary) {
      const actions = getSessionActions(sessionId);
      updates.summary = summarizeSession(actions);

      if (!session.files_modified) {
        updates.files_modified = JSON.stringify(collectUniqueFiles(actions));
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
