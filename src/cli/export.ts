import type { HookInput, HookOutput } from './types';
import { getDb } from '../core/db';
import { logger } from '../util/logger';

export async function handleExport(_input: HookInput): Promise<HookOutput> {
  try {
    const db = getDb();
    if (!db) {
      return {
        continue: true,
        hookSpecificOutput: {
          additionalContext: 'Error: Could not open database.',
        },
      };
    }

    const sessions = db
      .prepare('SELECT * FROM sessions ORDER BY started_at DESC')
      .all();
    const decisions = db
      .prepare('SELECT * FROM decisions ORDER BY timestamp DESC')
      .all();
    const learnings = db
      .prepare('SELECT * FROM learnings ORDER BY relevance_score DESC')
      .all();

    const exported = {
      exported_at: new Date().toISOString(),
      sessions,
      decisions,
      learnings,
    };

    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: JSON.stringify(exported, null, 2),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[export] ${msg}`);
    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: `Export failed: ${msg}`,
      },
    };
  }
}
