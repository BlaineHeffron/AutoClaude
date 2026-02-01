import type { HookInput, HookOutput } from "./types";
import { searchMemory } from "../core/memory";
import type { SearchResult } from "../core/memory";
import { logger } from "../util/logger";

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/**
 * Format a single search result as a readable text block.
 */
function formatResult(result: SearchResult, index: number): string {
  const sourceLabel =
    result.source === "sessions"
      ? "Session"
      : result.source === "decisions"
        ? "Decision"
        : "Learning";

  // Replace HTML bold tags from FTS snippets with markdown bold
  const cleanSnippet = result.snippet
    .replace(/<b>/g, "**")
    .replace(/<\/b>/g, "**");

  return `${index + 1}. [${sourceLabel} #${result.id}] ${cleanSnippet}`;
}

/**
 * Format search results as a markdown-style text block.
 */
function formatResults(queryText: string, results: SearchResult[]): string {
  const lines: string[] = [];

  lines.push(`## Memory Search: "${queryText}"`);
  lines.push("");

  if (results.length === 0) {
    lines.push("No results found.");
    return lines.join("\n");
  }

  lines.push(`Found ${results.length} result${results.length !== 1 ? "s" : ""}:`);
  lines.push("");

  for (let i = 0; i < results.length; i++) {
    lines.push(formatResult(results[i], i));
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Handler: query
// ---------------------------------------------------------------------------

export async function handleQuery(
  _input: HookInput,
  queryText: string,
): Promise<HookOutput> {
  try {
    if (!queryText || queryText.trim().length === 0) {
      return {
        continue: true,
        hookSpecificOutput: {
          additionalContext: "Error: No search query provided.",
        },
      };
    }

    const results = searchMemory(queryText.trim(), "all", 10);
    const formatted = formatResults(queryText, results);

    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: formatted,
      },
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[query] ${msg}`);
    return {
      continue: true,
      hookSpecificOutput: {
        additionalContext: `Error searching memory: ${msg}`,
      },
    };
  }
}
