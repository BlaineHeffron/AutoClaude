import type { HookInput, HookOutput } from './types';
import {
  createSession,
  decayLearnings,
  garbageCollect,
  insertMetric,
} from '../core/memory';
import { buildInjectionContext } from '../core/injector';
import { estimateUtilization } from '../core/metrics';
import { estimateTokens } from '../util/tokens';
import { getConfig } from '../util/config';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Handler: SessionStart
// ---------------------------------------------------------------------------

export async function handleSessionStart(
  input: HookInput,
): Promise<HookOutput> {
  try {
    const { session_id, cwd, source } = input;
    const projectPath = cwd ?? process.cwd();

    logger.info(
      `session-start: id=${session_id} source=${source ?? 'startup'} project=${projectPath}`,
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

    // 4. Record utilization metric if transcript is available
    let systemMessage: string | undefined;
    let currentUtilization = 0;

    if (input.transcript_path && config.metrics.enabled) {
      const util = estimateUtilization(input.transcript_path);
      currentUtilization = util.utilization;
      insertMetric(session_id, 'context_utilization', util.utilization);

      if (util.utilization >= config.metrics.criticalUtilization) {
        systemMessage =
          `[AutoClaude] Context utilization is at ${(util.utilization * 100).toFixed(0)}%. ` +
          `Consider running /compact to free up context space.`;
        logger.warn(
          `session-start: utilization critical at ${(util.utilization * 100).toFixed(1)}%`,
        );
      } else if (util.utilization >= config.metrics.warnUtilization) {
        systemMessage =
          `[AutoClaude] Context utilization is at ${(util.utilization * 100).toFixed(0)}%. ` +
          `Approaching capacity — be concise to extend the session.`;
        logger.info(
          `session-start: utilization warning at ${(util.utilization * 100).toFixed(1)}%`,
        );
      }
    }

    // 5. If injection is disabled, return early (but still include utilization warning)
    if (!config.injection.enabled) {
      logger.debug('session-start: injection disabled, skipping context build');
      if (systemMessage) {
        return { continue: true, hookSpecificOutput: { systemMessage } };
      }
      return { continue: true };
    }

    // 6. Build injection context using the injector module
    //    Pass utilization so the injector can adaptively reduce budget
    const context = buildInjectionContext(
      projectPath,
      session_id,
      source,
      config,
      { utilization: currentUtilization },
    );

    if (!context && !systemMessage) {
      logger.debug('session-start: no context to inject');
      return { continue: true };
    }

    if (context) {
      logger.info(
        `session-start: injecting ~${estimateTokens(context)} tokens of context`,
      );
    }

    return {
      continue: true,
      hookSpecificOutput: {
        ...(context ? { additionalContext: context } : {}),
        ...(systemMessage ? { systemMessage } : {}),
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[session-start] ${msg}`);
    return { continue: true };
  }
}
