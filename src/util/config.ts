import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface AutoClaudeConfig {
  injection: {
    enabled: boolean;
    maxTokens: number;
    includeSessions: number;
    includeDecisions: boolean;
    includeLearnings: boolean;
    includeSnapshot: boolean;
  };
  capture: {
    enabled: boolean;
    asyncActions: boolean;
    captureTools: string[];
  };
  metrics: {
    enabled: boolean;
    warnUtilization: number;
    criticalUtilization: number;
  };
  decay: {
    dailyRate: number;
    referenceBoost: number;
    gcThreshold: number;
  };
  logging: {
    level: string;
    file: string;
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
    captureTools: ["Edit", "Write", "Bash"],
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
    level: "info",
    file: "~/.autoclaude/logs/autoclaude.log",
  },
};

const CONFIG_PATH = path.join(os.homedir(), ".autoclaude", "config.json");

function deepMerge<T extends Record<string, unknown>>(
  defaults: T,
  overrides: Record<string, unknown>
): T {
  const result = { ...defaults };

  for (const key of Object.keys(overrides)) {
    if (!(key in defaults)) continue;

    const defaultVal = (defaults as Record<string, unknown>)[key];
    const overrideVal = overrides[key];

    if (
      defaultVal !== null &&
      overrideVal !== null &&
      typeof defaultVal === "object" &&
      typeof overrideVal === "object" &&
      !Array.isArray(defaultVal) &&
      !Array.isArray(overrideVal)
    ) {
      (result as Record<string, unknown>)[key] = deepMerge(
        defaultVal as Record<string, unknown>,
        overrideVal as Record<string, unknown>
      );
    } else {
      (result as Record<string, unknown>)[key] = overrideVal;
    }
  }

  return result;
}

export function getConfig(): AutoClaudeConfig {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, "utf-8");
    const userConfig = JSON.parse(raw) as Record<string, unknown>;
    return deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, userConfig) as unknown as AutoClaudeConfig;
  } catch {
    // File doesn't exist or is invalid JSON - return defaults
    return { ...DEFAULT_CONFIG };
  }
}
