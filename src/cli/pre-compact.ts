import type { HookInput, HookOutput } from './types';
import {
  getSession,
  getSessionActions,
  insertSnapshot,
  insertMetric,
  updateSession,
} from '../core/memory';
import {
  summarizeSession,
  collectUniqueFiles,
  countByType,
} from '../core/summarizer';
import { estimateUtilization } from '../core/metrics';
import { getConfig } from '../util/config';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a human-readable progress summary from a list of actions,
 * e.g. "5 edits, 2 tests, 1 build".
 */
function buildProgressSummary(
  actions: import('../core/memory').ActionRecord[],
): string {
  const counts = countByType(actions);

  const parts: string[] = [];
  for (const [type, count] of Object.entries(counts)) {
    parts.push(`${count} ${type}${count !== 1 ? 's' : ''}`);
  }

  return parts.length > 0 ? parts.join(', ') : 'no actions recorded';
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
    const workingFiles = JSON.stringify(collectUniqueFiles(actions));

    // Save a snapshot for post-compact restoration
    insertSnapshot({
      session_id: sessionId,
      trigger: 'pre-compact',
      current_task: currentTask,
      progress_summary: progressSummary,
      open_questions: JSON.stringify([]),
      next_steps: JSON.stringify([]),
      working_files: workingFiles,
    });

    // Also persist a partial summary so the next session can reference it
    const summary = summarizeSession(actions);
    updateSession(sessionId, {
      summary,
      files_modified: workingFiles,
      compaction_count: (session?.compaction_count ?? 0) + 1,
    });

    // Record utilization metric at compaction time
    const config = getConfig();
    if (input.transcript_path && config.metrics.enabled) {
      const util = estimateUtilization(input.transcript_path);
      insertMetric(sessionId, 'context_utilization', util.utilization);
      // Update peak utilization on session
      const peak = session?.context_utilization_peak ?? 0;
      if (util.utilization > peak) {
        updateSession(sessionId, {
          context_utilization_peak: util.utilization,
        });
      }
    }

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
      systemMessage: 'Context snapshot saved to memory',
    },
  };
}
