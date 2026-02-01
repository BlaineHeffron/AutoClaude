import type { ActionRecord, DecisionRecord, LearningRecord } from "./memory";
import { insertDecision, insertLearning } from "./memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Config file patterns → decision extraction
// ---------------------------------------------------------------------------

const CONFIG_FILE_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /tsconfig.*\.json$/, category: "convention" },
  { pattern: /package\.json$/, category: "library" },
  { pattern: /\.eslint/, category: "convention" },
  { pattern: /\.prettier/, category: "convention" },
  { pattern: /webpack\.config/, category: "architecture" },
  { pattern: /vite\.config/, category: "architecture" },
  { pattern: /rollup\.config/, category: "architecture" },
  { pattern: /esbuild/, category: "architecture" },
  { pattern: /\.babelrc|babel\.config/, category: "convention" },
  { pattern: /jest\.config|vitest\.config/, category: "convention" },
  { pattern: /docker/, category: "architecture" },
  { pattern: /\.env/, category: "convention" },
  { pattern: /nginx|caddy/, category: "architecture" },
  { pattern: /Makefile$/, category: "architecture" },
  { pattern: /\.github\/workflows/, category: "architecture" },
];

const LIBRARY_INSTALL_PATTERN =
  /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+(?:add|install))\s+(.+)/;

// ---------------------------------------------------------------------------
// Public API: Single-action analysis (called from capture-action)
// ---------------------------------------------------------------------------

/**
 * Analyzes a single captured action for implicit decisions. Called from the
 * PostToolUse handler after each action is recorded. Extracts decisions from:
 *
 * - Config file modifications (tsconfig, eslintrc, etc.)
 * - Library installations (npm install, yarn add)
 */
export function analyzeActionForDecisions(
  action: ActionRecord,
  projectPath: string,
): void {
  try {
    // Check for config file edits
    if (
      action.file_path &&
      (action.action_type === "edit" || action.action_type === "create")
    ) {
      for (const { pattern, category } of CONFIG_FILE_PATTERNS) {
        if (pattern.test(action.file_path)) {
          const shortPath = action.file_path.split("/").slice(-2).join("/");
          insertDecision({
            session_id: action.session_id,
            project_path: projectPath,
            category,
            decision: `Modified ${shortPath}: ${action.description || "configuration change"}`,
            rationale: `Detected from ${action.action_type} action on config file`,
            files_affected: JSON.stringify([action.file_path]),
            supersedes_id: null,
          });
          logger.debug(
            `[analyzer] Extracted ${category} decision from ${shortPath}`,
          );
          break;
        }
      }
    }

    // Check for library installations via Bash
    if (action.tool_name === "Bash" && action.description) {
      const match = action.description.match(LIBRARY_INSTALL_PATTERN);
      if (!match) {
        // Also check the raw action outcome for install commands
        const toolDesc = action.description || "";
        if (
          /\b(?:npm\s+(?:install|i|add)|yarn\s+add|pnpm\s+add)\b/.test(
            toolDesc,
          )
        ) {
          insertDecision({
            session_id: action.session_id,
            project_path: projectPath,
            category: "library",
            decision: `Installed packages: ${toolDesc}`,
            rationale: "Detected from package manager invocation",
            files_affected: JSON.stringify(["package.json"]),
            supersedes_id: null,
          });
          logger.debug(`[analyzer] Extracted library decision from install`);
        }
      } else {
        const packages = match[1]
          .split(/\s+/)
          .filter((p) => !p.startsWith("-"))
          .join(", ");
        if (packages) {
          insertDecision({
            session_id: action.session_id,
            project_path: projectPath,
            category: "library",
            decision: `Added dependency: ${packages}`,
            rationale: "Detected from package manager install command",
            files_affected: JSON.stringify(["package.json"]),
            supersedes_id: null,
          });
          logger.debug(
            `[analyzer] Extracted library decision: ${packages}`,
          );
        }
      }
    }
  } catch (err) {
    logger.error(
      `[analyzer] analyzeActionForDecisions: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Public API: Session-end analysis (called from session-stop)
// ---------------------------------------------------------------------------

/**
 * Analyzes the full action history of a session to extract learnings from
 * error→fix sequences. Called at session end when the complete action log
 * is available.
 *
 * Detects patterns:
 * - Test failure → file edits → test success
 * - Build failure → file edits → build success
 * - Any failure → edits on same file → success
 */
export function extractLearningsFromSession(
  actions: ActionRecord[],
  sessionId: string,
  projectPath: string,
): void {
  try {
    const learnings = detectErrorFixSequences(actions);

    for (const learning of learnings) {
      insertLearning({
        session_id: sessionId,
        project_path: projectPath,
        category: learning.category,
        learning: learning.text,
        context: learning.context,
        relevance_score: 1.0,
        times_referenced: 0,
      });
      logger.debug(`[analyzer] Extracted learning: ${learning.text.slice(0, 80)}`);
    }

    if (learnings.length > 0) {
      logger.info(
        `[analyzer] Extracted ${learnings.length} learning(s) from session ${sessionId}`,
      );
    }
  } catch (err) {
    logger.error(
      `[analyzer] extractLearningsFromSession: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Internal: Error→Fix sequence detection
// ---------------------------------------------------------------------------

interface ExtractedLearning {
  category: string;
  text: string;
  context: string;
}

function detectErrorFixSequences(
  actions: ActionRecord[],
): ExtractedLearning[] {
  const learnings: ExtractedLearning[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.outcome !== "failure") continue;

    // Look ahead for a fix: edits followed by a success of the same type
    const failureType = action.action_type; // "test", "build", etc.
    const failureFile = action.file_path;
    const errorSnippet = (action.error_message || action.description || "")
      .slice(0, 200);

    // Scan forward for edits and then a matching success
    const editFiles: string[] = [];
    let fixFound = false;

    for (let j = i + 1; j < actions.length && j <= i + 15; j++) {
      const next = actions[j];

      // Collect edit files between failure and fix
      if (next.action_type === "edit" || next.action_type === "create") {
        if (next.file_path) editFiles.push(next.file_path);
      }

      // Check if this is a successful retry of the same operation
      if (
        next.action_type === failureType &&
        next.outcome === "success" &&
        editFiles.length > 0
      ) {
        fixFound = true;
        break;
      }

      // If same file had a failure then later a success (any type)
      if (
        failureFile &&
        next.file_path === failureFile &&
        next.outcome === "success"
      ) {
        fixFound = true;
        break;
      }

      // Stop if we hit another failure of the same type (nested issue)
      if (next.action_type === failureType && next.outcome === "failure") {
        break;
      }
    }

    if (fixFound && editFiles.length > 0) {
      const key = `${failureType}:${editFiles.sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);

      const uniqueFiles = [...new Set(editFiles)];
      const fileList = uniqueFiles
        .map((f) => f.split("/").pop())
        .join(", ");

      let category: string;
      let text: string;

      if (failureType === "test") {
        category = "gotcha";
        text = `Test failure fixed by editing ${fileList}. Error: ${errorSnippet.slice(0, 100)}`;
      } else if (failureType === "build") {
        category = "gotcha";
        text = `Build failure resolved by editing ${fileList}. Error: ${errorSnippet.slice(0, 100)}`;
      } else {
        category = "pattern";
        text = `${failureType || "Operation"} failure fixed by modifying ${fileList}`;
      }

      learnings.push({
        category,
        text,
        context: `Error→fix sequence: ${failureType} failed, then ${uniqueFiles.length} file(s) edited, then ${failureType} succeeded`,
      });
    }
  }

  return learnings;
}
