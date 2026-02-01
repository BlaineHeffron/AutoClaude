import type { ActionRecord } from "./memory";

/**
 * Generates a concise 2-3 sentence natural language summary from session actions.
 * Uses heuristics only (no LLM) per the design principle of offline capability.
 */
export function summarizeSession(actions: ActionRecord[]): string {
  if (actions.length === 0) {
    return "Session completed with no recorded actions.";
  }

  const edits = actions.filter(
    (a) => a.action_type === "edit" || a.action_type === "create",
  );
  const tests = actions.filter((a) => a.action_type === "test");
  const builds = actions.filter((a) => a.action_type === "build");
  const commits = actions.filter((a) => a.action_type === "commit");
  const deletes = actions.filter((a) => a.action_type === "delete");
  const failures = actions.filter((a) => a.outcome === "failure");

  const files = collectUniqueFiles(actions);

  const sentences: string[] = [];

  // Sentence 1: Primary activity
  sentences.push(buildActivitySentence(edits, tests, builds, commits, deletes, files));

  // Sentence 2: Outcome
  const outcome = buildOutcomeSentence(failures, commits, tests, builds);
  if (outcome) sentences.push(outcome);

  // Sentence 3: Scope detail (only if we have files and no outcome sentence covered them)
  const scope = buildScopeSentence(files, edits);
  if (scope && sentences.length < 3) sentences.push(scope);

  return sentences.join(" ");
}

/**
 * Collects unique modified file paths from actions (short basenames for readability).
 */
export function collectUniqueFiles(actions: ActionRecord[]): string[] {
  const files = new Set<string>();
  for (const a of actions) {
    if (a.file_path) files.add(a.file_path);
  }
  return [...files];
}

/**
 * Counts actions grouped by action_type.
 */
export function countByType(actions: ActionRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const a of actions) {
    const type = a.action_type ?? "other";
    counts[type] = (counts[type] ?? 0) + 1;
  }
  return counts;
}

// ---------------------------------------------------------------------------
// Sentence builders
// ---------------------------------------------------------------------------

function buildActivitySentence(
  edits: ActionRecord[],
  tests: ActionRecord[],
  builds: ActionRecord[],
  commits: ActionRecord[],
  deletes: ActionRecord[],
  files: string[],
): string {
  const parts: string[] = [];

  if (edits.length > 0) {
    parts.push(`${edits.length} file edit${edits.length !== 1 ? "s" : ""}`);
  }
  if (tests.length > 0) {
    parts.push(`${tests.length} test run${tests.length !== 1 ? "s" : ""}`);
  }
  if (builds.length > 0) {
    parts.push(`${builds.length} build${builds.length !== 1 ? "s" : ""}`);
  }
  if (commits.length > 0) {
    parts.push(`${commits.length} commit${commits.length !== 1 ? "s" : ""}`);
  }
  if (deletes.length > 0) {
    parts.push(`${deletes.length} deletion${deletes.length !== 1 ? "s" : ""}`);
  }

  // Fallback for actions that don't fit the above categories
  if (parts.length === 0) {
    const total = edits.length + tests.length + builds.length + commits.length + deletes.length;
    const other = files.length > 0
      ? `Performed operations across ${files.length} file${files.length !== 1 ? "s" : ""}.`
      : "Performed miscellaneous operations.";
    return total === 0 ? other : other;
  }

  return `Session performed ${parts.join(", ")} across ${files.length} file${files.length !== 1 ? "s" : ""}.`;
}

function buildOutcomeSentence(
  failures: ActionRecord[],
  commits: ActionRecord[],
  tests: ActionRecord[],
  builds: ActionRecord[],
): string {
  const parts: string[] = [];

  if (failures.length > 0) {
    parts.push(
      `${failures.length} action${failures.length !== 1 ? "s" : ""} failed`,
    );
  }

  const passedTests = tests.filter((t) => t.outcome === "success");
  const failedTests = tests.filter((t) => t.outcome === "failure");
  if (passedTests.length > 0 && failedTests.length === 0) {
    parts.push("all tests passed");
  } else if (failedTests.length > 0) {
    parts.push(
      `${failedTests.length}/${tests.length} test${tests.length !== 1 ? "s" : ""} failed`,
    );
  }

  const passedBuilds = builds.filter((b) => b.outcome === "success");
  if (passedBuilds.length > 0) {
    parts.push("build succeeded");
  }

  if (commits.length > 0) {
    // Extract commit messages from descriptions
    const msgs = commits
      .map((c) => c.description)
      .filter(Boolean)
      .slice(0, 2);
    if (msgs.length > 0) {
      parts.push(`committed: ${msgs.join("; ")}`);
    }
  }

  if (parts.length === 0) return "";
  // Capitalize first letter
  const joined = parts.join(", ");
  return joined.charAt(0).toUpperCase() + joined.slice(1) + ".";
}

function buildScopeSentence(
  files: string[],
  edits: ActionRecord[],
): string {
  if (files.length === 0) return "";
  if (files.length <= 3) {
    const names = files.map(shortName);
    return `Key files: ${names.join(", ")}.`;
  }
  if (files.length <= 8) {
    return `Touched ${files.length} files including ${shortName(files[0])} and ${shortName(files[1])}.`;
  }
  return `Broad changes across ${files.length} files.`;
}

function shortName(filePath: string): string {
  const parts = filePath.split("/");
  return parts[parts.length - 1] || filePath;
}
