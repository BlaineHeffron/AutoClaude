import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface AutoClaudeConfig {
  /** Context injection settings — controls what gets injected on session start. */
  injection: {
    /** Whether context injection is enabled at all. Default: true. */
    enabled: boolean;
    /** Maximum token budget for injected context. Range: 100–10000. Default: 1000. */
    maxTokens: number;
    /** Number of recent sessions to include in injection. Range: 0–20. Default: 3. */
    includeSessions: number;
    /** Include active architectural decisions. Default: true. */
    includeDecisions: boolean;
    /** Include learnings (gotchas, patterns). Default: true. */
    includeLearnings: boolean;
    /** Include pre-compaction snapshots on resume/compact. Default: true. */
    includeSnapshot: boolean;
  };
  /** Action capture settings — controls which tool uses are recorded. */
  capture: {
    /** Whether action capture is enabled. Default: true. */
    enabled: boolean;
    /** Whether to capture actions asynchronously (non-blocking). Default: true. */
    asyncActions: boolean;
    /** List of tool names to capture (matched against hook PostToolUse). Default: ["Edit", "Write", "Bash"]. */
    captureTools: string[];
  };
  /** Metrics and utilization tracking settings. */
  metrics: {
    /** Whether metrics collection is enabled. Default: true. */
    enabled: boolean;
    /** Context utilization threshold (0–1) for a warning message. Default: 0.55. */
    warnUtilization: number;
    /** Context utilization threshold (0–1) for a critical/compact message. Default: 0.7. */
    criticalUtilization: number;
  };
  /** Relevance decay settings for learnings garbage collection. */
  decay: {
    /** Daily relevance decay rate (0–1). Applied each time gc runs. Default: 0.05. */
    dailyRate: number;
    /** Relevance boost when a learning is referenced. Default: 0.1. */
    referenceBoost: number;
    /** Minimum relevance score before a learning is garbage-collected. Range: 0–1. Default: 0.1. */
    gcThreshold: number;
  };
  /** Logging configuration. */
  logging: {
    /** Log level: "debug", "info", "warn", or "error". Default: "info". */
    level: string;
    /** Path to log file. Supports ~ for home directory. Default: "~/.autoclaude/logs/autoclaude.log". */
    file: string;
  };
  /** SWE-Pruner integration settings. */
  pruner: {
    /** Whether pruner integration is enabled. Default: true. */
    enabled: boolean;
    /** URL of the SWE-Pruner FastAPI server. Default: "http://localhost:8000". */
    url: string;
    /** Base pruning threshold (0–1). Lower = more aggressive pruning. Default: 0.5. */
    threshold: number;
    /** HTTP request timeout in milliseconds. Default: 5000. */
    timeout: number;
    /** Whether to lower threshold adaptively at high context utilization. Default: true. */
    adaptiveThreshold: boolean;
  };
}

const DEFAULT_CONFIG: AutoClaudeConfig = {
  injection: {
    enabled: true,
    maxTokens: 1000,
    includeSessions: 3,
    includeDecisions: true,
    includeLearnings: true,
    includeSnapshot: true,
  },
  capture: {
    enabled: true,
    asyncActions: true,
    captureTools: ['Edit', 'Write', 'Bash'],
  },
  metrics: {
    enabled: true,
    warnUtilization: 0.55,
    criticalUtilization: 0.7,
  },
  decay: {
    dailyRate: 0.05,
    referenceBoost: 0.1,
    gcThreshold: 0.1,
  },
  logging: {
    level: 'info',
    file: '~/.autoclaude/logs/autoclaude.log',
  },
  pruner: {
    enabled: true,
    url: 'http://localhost:8000',
    threshold: 0.5,
    timeout: 5000,
    adaptiveThreshold: true,
  },
};

const CONFIG_PATH = path.join(os.homedir(), '.autoclaude', 'config.json');

function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Record<string, unknown>,
): T {
  const result = { ...defaults };

  for (const key of Object.keys(overrides)) {
    if (!(key in defaults)) continue;

    const defaultVal = (defaults as Record<string, unknown>)[key];
    const overrideVal = overrides[key];

    if (
      defaultVal !== null &&
      overrideVal !== null &&
      typeof defaultVal === 'object' &&
      typeof overrideVal === 'object' &&
      !Array.isArray(defaultVal) &&
      !Array.isArray(overrideVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        defaultVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>,
      );
    } else {
      (result as Record<string, unknown>)[key] = overrideVal;
    }
  }

  return result;
}

/**
 * Validates config values are within expected ranges.
 * Logs warnings and resets to defaults for any out-of-range values.
 */
function validateConfig(config: AutoClaudeConfig): AutoClaudeConfig {
  const warnings: string[] = [];

  // injection.maxTokens: 100–10000
  if (config.injection.maxTokens < 100 || config.injection.maxTokens > 10000) {
    warnings.push(
      `injection.maxTokens=${config.injection.maxTokens} out of range [100, 10000], using default ${DEFAULT_CONFIG.injection.maxTokens}`,
    );
    config.injection.maxTokens = DEFAULT_CONFIG.injection.maxTokens;
  }

  // injection.includeSessions: 0–20
  if (
    config.injection.includeSessions < 0 ||
    config.injection.includeSessions > 20
  ) {
    warnings.push(
      `injection.includeSessions=${config.injection.includeSessions} out of range [0, 20], using default ${DEFAULT_CONFIG.injection.includeSessions}`,
    );
    config.injection.includeSessions = DEFAULT_CONFIG.injection.includeSessions;
  }

  // metrics.warnUtilization: 0–1
  if (
    config.metrics.warnUtilization < 0 ||
    config.metrics.warnUtilization > 1
  ) {
    warnings.push(
      `metrics.warnUtilization=${config.metrics.warnUtilization} out of range [0, 1], using default ${DEFAULT_CONFIG.metrics.warnUtilization}`,
    );
    config.metrics.warnUtilization = DEFAULT_CONFIG.metrics.warnUtilization;
  }

  // metrics.criticalUtilization: 0–1
  if (
    config.metrics.criticalUtilization < 0 ||
    config.metrics.criticalUtilization > 1
  ) {
    warnings.push(
      `metrics.criticalUtilization=${config.metrics.criticalUtilization} out of range [0, 1], using default ${DEFAULT_CONFIG.metrics.criticalUtilization}`,
    );
    config.metrics.criticalUtilization =
      DEFAULT_CONFIG.metrics.criticalUtilization;
  }

  // warn should be less than critical
  if (config.metrics.warnUtilization >= config.metrics.criticalUtilization) {
    warnings.push(
      `metrics.warnUtilization (${config.metrics.warnUtilization}) >= criticalUtilization (${config.metrics.criticalUtilization}), using defaults`,
    );
    config.metrics.warnUtilization = DEFAULT_CONFIG.metrics.warnUtilization;
    config.metrics.criticalUtilization =
      DEFAULT_CONFIG.metrics.criticalUtilization;
  }

  // decay.dailyRate: 0–1
  if (config.decay.dailyRate < 0 || config.decay.dailyRate > 1) {
    warnings.push(
      `decay.dailyRate=${config.decay.dailyRate} out of range [0, 1], using default ${DEFAULT_CONFIG.decay.dailyRate}`,
    );
    config.decay.dailyRate = DEFAULT_CONFIG.decay.dailyRate;
  }

  // decay.referenceBoost: 0–1
  if (config.decay.referenceBoost < 0 || config.decay.referenceBoost > 1) {
    warnings.push(
      `decay.referenceBoost=${config.decay.referenceBoost} out of range [0, 1], using default ${DEFAULT_CONFIG.decay.referenceBoost}`,
    );
    config.decay.referenceBoost = DEFAULT_CONFIG.decay.referenceBoost;
  }

  // decay.gcThreshold: 0–1
  if (config.decay.gcThreshold < 0 || config.decay.gcThreshold > 1) {
    warnings.push(
      `decay.gcThreshold=${config.decay.gcThreshold} out of range [0, 1], using default ${DEFAULT_CONFIG.decay.gcThreshold}`,
    );
    config.decay.gcThreshold = DEFAULT_CONFIG.decay.gcThreshold;
  }

  // pruner.threshold: 0–1
  if (config.pruner.threshold < 0 || config.pruner.threshold > 1) {
    warnings.push(
      `pruner.threshold=${config.pruner.threshold} out of range [0, 1], using default ${DEFAULT_CONFIG.pruner.threshold}`,
    );
    config.pruner.threshold = DEFAULT_CONFIG.pruner.threshold;
  }

  // pruner.timeout: 1000–30000
  if (config.pruner.timeout < 1000 || config.pruner.timeout > 30000) {
    warnings.push(
      `pruner.timeout=${config.pruner.timeout} out of range [1000, 30000], using default ${DEFAULT_CONFIG.pruner.timeout}`,
    );
    config.pruner.timeout = DEFAULT_CONFIG.pruner.timeout;
  }

  // logging.level: must be valid
  const validLevels = ['debug', 'info', 'warn', 'error'];
  if (!validLevels.includes(config.logging.level)) {
    warnings.push(
      `logging.level="${config.logging.level}" invalid, using default "${DEFAULT_CONFIG.logging.level}"`,
    );
    config.logging.level = DEFAULT_CONFIG.logging.level;
  }

  if (warnings.length > 0) {
    for (const w of warnings) {
      console.error(`[autoclaude] config warning: ${w}`);
    }
  }

  return config;
}

export function getConfig(): AutoClaudeConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    const userConfig = JSON.parse(raw) as Record<string, unknown>;
    const merged = deepMerge(
      DEFAULT_CONFIG as unknown as Record<string, unknown>,
      userConfig,
    ) as unknown as AutoClaudeConfig;
    return validateConfig(merged);
  } catch {
    // File doesn't exist or is invalid JSON - return defaults
    return { ...DEFAULT_CONFIG };
  }
}

export { DEFAULT_CONFIG };
