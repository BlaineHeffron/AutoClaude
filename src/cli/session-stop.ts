import type { HookInput, HookOutput } from "./types";
import {
  getSession,
  getSessionActions,
  insertMetric,
  updateSession,
} from "../core/memory";
import { summarizeSession, collectUniqueFiles } from "../core/summarizer";
import { extractLearningsFromSession } from "../core/analyzer";
import { estimateUtilization } from "../core/metrics";
import { getConfig } from "../util/config";
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

    // Record final utilization metric
    const config = getConfig();
    const updates: Record<string, unknown> = {
      summary,
      files_modified: JSON.stringify(filesModified),
      ended_at: new Date().toISOString(),
    };

    if (input.transcript_path && config.metrics.enabled) {
      const util = estimateUtilization(input.transcript_path);
      insertMetric(sessionId, "context_utilization", util.utilization);

      // Update peak utilization
      const session = getSession(sessionId);
      const peak = session?.context_utilization_peak ?? 0;
      if (util.utilization > peak) {
        updates.context_utilization_peak = util.utilization;
      }
    }

    updateSession(sessionId, updates);

    logger.info(
      `[session-stop] Session ${sessionId} stopped. ${actions.length} actions, summary: ${summary.slice(0, 120)}`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-stop] ${msg}`);
  }

  return { continue: true };
}
