import type { HookInput, HookOutput } from "./types";
import {
  createSession,
  decayLearnings,
  garbageCollect,
} from "../core/memory";
import { buildInjectionContext } from "../core/injector";
import { estimateTokens } from "../util/tokens";
import { getConfig } from "../util/config";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Handler: SessionStart
// ---------------------------------------------------------------------------

export async function handleSessionStart(
  input: HookInput,
): Promise<HookOutput> {
  const { session_id, cwd, source } = input;
  const projectPath = cwd ?? process.cwd();

  logger.info(
    `session-start: id=${session_id} source=${source ?? "startup"} project=${projectPath}`,
  );

  // 1. Create the session record
  createSession(session_id, projectPath);

  // 2. Load configuration
  const config = getConfig();

  // 3. Run garbage collection on learnings (decay + prune)
  try {
    decayLearnings(config.decay.dailyRate);
    const gc = garbageCollect(config.decay.gcThreshold);
    if (gc.removed > 0) {
      logger.info(`session-start: pruned ${gc.removed} stale learnings`);
    }
  } catch (err) {
    logger.error(
      `session-start: gc failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // 4. If injection is disabled, return early
  if (!config.injection.enabled) {
    logger.debug("session-start: injection disabled, skipping context build");
    return { continue: true };
  }

  // 5. Build injection context using the injector module
  const context = buildInjectionContext(
    projectPath,
    session_id,
    source,
    config,
  );

  if (!context) {
    logger.debug("session-start: no context to inject");
    return { continue: true };
  }

  logger.info(
    `session-start: injecting ~${estimateTokens(context)} tokens of context`,
  );

  return {
    continue: true,
    hookSpecificOutput: {
      additionalContext: context,
    },
  };
}
