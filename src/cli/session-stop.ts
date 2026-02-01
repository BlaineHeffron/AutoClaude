import type { HookInput, HookOutput } from "./types";
import {
  getSessionActions,
  updateSession,
} from "../core/memory";
import { summarizeSession, collectUniqueFiles } from "../core/summarizer";
import { extractLearningsFromSession } from "../core/analyzer";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Handler: Stop
// ---------------------------------------------------------------------------

export async function handleSessionStop(input: HookInput): Promise<HookOutput> {
  try {
    const sessionId = input.session_id;
    const actions = getSessionActions(sessionId);

    // Generate structured summary using the summarizer module
    const summary = summarizeSession(actions);
    const filesModified = collectUniqueFiles(actions);

    // Extract learnings from error→fix sequences
    const projectPath = input.cwd ?? process.cwd();
    extractLearningsFromSession(actions, sessionId, projectPath);

    updateSession(sessionId, {
      summary,
      files_modified: JSON.stringify(filesModified),
      ended_at: new Date().toISOString(),
    });

    logger.info(
      `[session-stop] Session ${sessionId} stopped. ${actions.length} actions, summary: ${summary.slice(0, 120)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-stop] ${msg}`);
  }

  return { continue: true };
}
