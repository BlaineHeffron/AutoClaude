import { logger } from '../util/logger';
import { getConfig } from '../util/config';
import { estimateTokens } from '../util/tokens';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PruneResult {
  prunedText: string;
  originalTokens: number;
  prunedTokens: number;
  reductionPercent: number;
}

interface PrunerHealthResponse {
  status: string;
}

interface PrunerPruneResponse {
  pruned_code: string;
}

// ---------------------------------------------------------------------------
// URL resolution — env var overrides config (useful for testing)
// ---------------------------------------------------------------------------

function getPrunerUrl(): string {
  return process.env.AUTOCLAUDE_PRUNER_URL || getConfig().pruner.url;
}

// ---------------------------------------------------------------------------
// Health check cache
// ---------------------------------------------------------------------------

let cachedAvailable: boolean | null = null;
let cacheTimestamp = 0;
const CACHE_TTL_MS = 60_000; // 60 seconds

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Checks if the SWE-Pruner server is reachable.
 * Caches the result for 60 seconds to avoid hammering /health.
 */
export async function isAvailable(): Promise<boolean> {
  const config = getConfig();
  if (!config.pruner.enabled) return false;

  const now = Date.now();
  if (cachedAvailable !== null && now - cacheTimestamp < CACHE_TTL_MS) {
    return cachedAvailable;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    const url = getPrunerUrl();
    const res = await fetch(`${url}/health`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (res.ok) {
      const body = (await res.json()) as PrunerHealthResponse;
      cachedAvailable = body.status === 'ok' || body.status === 'healthy';
    } else {
      cachedAvailable = false;
    }
  } catch {
    cachedAvailable = false;
  }

  cacheTimestamp = now;
  logger.debug(`[pruner] health check: available=${cachedAvailable}`);
  return cachedAvailable;
}

/**
 * Sends text to the SWE-Pruner server for neural pruning.
 * Returns a PruneResult with compression stats.
 * Throws on network/server errors — callers should use pruneIfAvailable() for safe usage.
 */
export async function prune(
  text: string,
  query: string,
  options?: { threshold?: number; timeoutMs?: number },
): Promise<PruneResult> {
  const config = getConfig();
  const threshold = options?.threshold ?? config.pruner.threshold;
  const timeoutMs = options?.timeoutMs ?? config.pruner.timeout;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url = getPrunerUrl();
    const res = await fetch(`${url}/prune`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: text, query, threshold }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      throw new Error(`Pruner returned ${res.status}: ${res.statusText}`);
    }

    const body = (await res.json()) as PrunerPruneResponse;
    const originalTokens = estimateTokens(text);
    const prunedTokens = estimateTokens(body.pruned_code);
    const reductionPercent =
      originalTokens > 0
        ? ((originalTokens - prunedTokens) / originalTokens) * 100
        : 0;

    logger.info(
      `[pruner] pruned ${originalTokens} → ${prunedTokens} tokens (${reductionPercent.toFixed(1)}% reduction)`,
    );

    return {
      prunedText: body.pruned_code,
      originalTokens,
      prunedTokens,
      reductionPercent,
    };
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

/**
 * Attempts to prune text, returning the original on any failure.
 * Safe to call from hooks and non-critical paths — never throws.
 */
export async function pruneIfAvailable(
  text: string,
  query: string,
  options?: { threshold?: number; timeoutMs?: number },
): Promise<PruneResult> {
  const originalTokens = estimateTokens(text);
  const fallback: PruneResult = {
    prunedText: text,
    originalTokens,
    prunedTokens: originalTokens,
    reductionPercent: 0,
  };

  try {
    const available = await isAvailable();
    if (!available) return fallback;

    return await prune(text, query, options);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(
      `[pruner] pruneIfAvailable failed (returning original): ${msg}`,
    );
    return fallback;
  }
}

/**
 * Computes an adaptive pruning threshold based on context utilization.
 * As utilization increases, the threshold decreases (more aggressive pruning).
 *
 * - At 0% utilization: returns base threshold unchanged
 * - At warnUtilization (55%): starts lowering threshold
 * - At criticalUtilization (70%): threshold reduced by ~40%
 * - At 100% utilization: threshold reduced by ~60%
 */
export function getAdaptiveThreshold(
  baseThreshold: number,
  utilization: number,
): number {
  const config = getConfig();

  if (
    !config.pruner.adaptiveThreshold ||
    utilization < config.metrics.warnUtilization
  ) {
    return baseThreshold;
  }

  // Linear interpolation: at warn -> 100% utilization, scale from 1.0 down to 0.4
  const range = 1.0 - config.metrics.warnUtilization;
  const progress = Math.min(
    (utilization - config.metrics.warnUtilization) / range,
    1.0,
  );
  const scale = 1.0 - progress * 0.6;

  return Math.max(baseThreshold * scale, 0.1);
}

/**
 * Resets the cached health check state. Useful for testing.
 */
export function resetCache(): void {
  cachedAvailable = null;
  cacheTimestamp = 0;
}
