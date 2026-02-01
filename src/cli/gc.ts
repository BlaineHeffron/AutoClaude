import type { HookInput, HookOutput } from "./types";
import { decayLearnings, garbageCollect } from "../core/memory";
import { getConfig } from "../util/config";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Garbage collection handler
// ---------------------------------------------------------------------------

export async function handleGc(_input: HookInput): Promise<HookOutput> {
  try {
    const config = getConfig();
    const dailyRate = config.decay.dailyRate;
    const gcThreshold = config.decay.gcThreshold;

    // Step 1: Apply relevance decay to all learnings
    decayLearnings(dailyRate);

    // Step 2: Remove learnings whose relevance has fallen below the threshold
    const { removed } = garbageCollect(gcThreshold);

    const message =
      `Garbage collection complete. ` +
      `Applied ${(dailyRate * 100).toFixed(1)}% decay. ` +
      `Removed ${removed} entr${removed === 1 ? "y" : "ies"} below threshold ${gcThreshold}.`;

    logger.info(`[gc] ${message}`);

    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: message,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[gc] ${msg}`);
    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: `Garbage collection failed: ${msg}`,
      },
    };
  }
}
