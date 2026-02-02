import type { HookInput, HookOutput } from './types';
import { insertPrompt, findSimilarPrompts, insertMetric } from '../core/memory';
import { estimateUtilization } from '../core/metrics';
import { getConfig } from '../util/config';
import { logger } from '../util/logger';

// ---------------------------------------------------------------------------
// Handler: UserPromptSubmit
// ---------------------------------------------------------------------------

/**
 * Extracts the user prompt text from the hook input.
 * UserPromptSubmit hooks receive the prompt in tool_input or as a direct field.
 */
function extractPromptText(input: HookInput): string {
  // The prompt may come as tool_input.prompt, tool_input.content, or as a string
  if (input.tool_input) {
    if (typeof input.tool_input === 'string') return input.tool_input;
    const ti = input.tool_input as Record<string, unknown>;
    if (ti.prompt) return String(ti.prompt);
    if (ti.content) return String(ti.content);
  }
  return '';
}

export async function handleUserPrompt(input: HookInput): Promise<HookOutput> {
  const messages: string[] = [];

  try {
    const sessionId = input.session_id;
    const projectPath = input.cwd ?? process.cwd();
    const config = getConfig();
    const promptText = extractPromptText(input);

    logger.info(
      `[user-prompt] session=${sessionId} promptLen=${promptText.length}`,
    );

    // Log the prompt if we have text
    if (promptText.length > 0) {
      insertPrompt({
        session_id: sessionId,
        project_path: projectPath,
        prompt: promptText,
      });

      // Check for repeated instructions via FTS similarity
      try {
        // Build an FTS5 OR query from significant words in the prompt.
        // FTS5 defaults to AND, which is too strict for similarity detection.
        // We extract meaningful words (>3 chars) and join with OR.
        const stopWords = new Set([
          'the',
          'and',
          'for',
          'that',
          'this',
          'with',
          'from',
          'have',
          'will',
          'been',
          'they',
          'were',
          'their',
          'what',
          'when',
          'make',
          'like',
          'just',
          'over',
          'such',
          'into',
          'than',
          'some',
          'could',
          'them',
          'would',
          'each',
          'which',
          'about',
          'help',
        ]);
        const words = promptText
          .slice(0, 200)
          .replace(/[^a-zA-Z0-9\s]/g, ' ')
          .toLowerCase()
          .split(/\s+/)
          .filter((w) => w.length > 3 && !stopWords.has(w));

        const searchQuery = words.slice(0, 10).join(' OR ');

        if (words.length >= 3) {
          const similar = findSimilarPrompts(
            searchQuery,
            projectPath,
            sessionId,
            3,
          );

          if (similar.length > 0) {
            // FTS5 rank is negative; more negative = better match.
            // Typical good matches are in the -1 to -3 range.
            const bestMatch = similar[0];
            if (bestMatch.rank < -1) {
              messages.push(
                `[AutoClaude] This instruction appears similar to one from a previous session. ` +
                  `The prior context may already be captured in memory.`,
              );
              logger.info(
                `[user-prompt] Repeated instruction detected (rank=${bestMatch.rank.toFixed(1)}, session=${bestMatch.session_id})`,
              );
            }
          }
        }
      } catch {
        // FTS errors should not block the hook
      }
    }

    // Check utilization
    if (input.transcript_path && config.metrics.enabled) {
      const util = estimateUtilization(input.transcript_path);
      insertMetric(sessionId, 'context_utilization', util.utilization);

      if (util.utilization >= config.metrics.criticalUtilization) {
        messages.push(
          `[AutoClaude] Context utilization is at ${(util.utilization * 100).toFixed(0)}%. ` +
            `Consider running /compact to free up context space.`,
        );
      } else if (util.utilization >= config.metrics.warnUtilization) {
        messages.push(
          `[AutoClaude] Context utilization is at ${(util.utilization * 100).toFixed(0)}%. ` +
            `Approaching capacity — be concise to extend the session.`,
        );
      }
    }

    logger.debug(
      `[user-prompt] Logged prompt for session ${sessionId} (${promptText.length} chars)`,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[user-prompt] ${msg}`);
  }

  if (messages.length > 0) {
    return {
      continue: true,
      hookSpecificOutput: {
        systemMessage: messages.join('\n'),
      },
    };
  }

  return { continue: true };
}
