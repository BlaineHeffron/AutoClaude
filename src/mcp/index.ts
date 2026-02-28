/**
 * AutoClaude MCP Server
 *
 * Exposes SWE-Pruner tools to coding agents via the Model Context Protocol:
 * - prune: Neural line-level pruning for large context
 * - compress: Token compression (prune + truncation fallback)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { insertMetric } from '../core/memory';
import { logger } from '../util/logger';
import type { LogLevel } from '../util/logger';
import { getConfig } from '../util/config';
import { estimateTokens, truncateToTokenBudget } from '../util/tokens';
import { prune, pruneIfAvailable } from '../core/pruner';

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

const config = getConfig();
logger.setLevel(config.logging.level as LogLevel);
if (config.logging.file) {
  logger.setLogFile(config.logging.file);
}

logger.info('[mcp] autoclaude MCP server starting');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Detects the current session ID from environment.
 */
const FALLBACK_SESSION_ID = `manual-${process.pid}`;

function getSessionId(): string {
  return (
    process.env.AUTOCLAUDE_SESSION_ID ||
    process.env.CODEX_THREAD_ID ||
    FALLBACK_SESSION_ID
  );
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: 'autoclaude-memory',
    version: '1.1.4',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool: prune
// ---------------------------------------------------------------------------

server.tool(
  'prune',
  'Prune code or text using neural SWE-Pruner, keeping only lines relevant to a query',
  {
    text: z.string().describe('The code or text to prune'),
    query: z
      .string()
      .describe('What to keep — lines relevant to this query survive pruning'),
    threshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe(
        'Pruning threshold (0–1). Lower = more aggressive. Defaults to config value.',
      ),
  },
  async (args) => {
    try {
      const sessionId = getSessionId();
      const result = await prune(args.text, args.query, {
        threshold: args.threshold,
      });

      // Record metrics
      insertMetric(sessionId, 'pruner_calls', 1);
      insertMetric(
        sessionId,
        'pruner_tokens_saved',
        result.originalTokens - result.prunedTokens,
      );

      logger.info(
        `[mcp] prune: ${result.originalTokens}→${result.prunedTokens} tokens (${result.reductionPercent.toFixed(1)}% reduction)`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Pruned ${result.originalTokens} → ${result.prunedTokens} tokens (${result.reductionPercent.toFixed(1)}% reduction)`,
              '',
              result.prunedText,
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] prune error: ${msg}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Prune error: ${msg}. Is the SWE-Pruner server running? Start it with ~/swe-pruner/start-pruner.sh`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: compress
// ---------------------------------------------------------------------------

server.tool(
  'compress',
  'Intelligently compress text: uses neural pruning if available and focus is provided, otherwise truncates to token limit',
  {
    text: z.string().describe('The text to compress'),
    focus: z
      .string()
      .optional()
      .describe(
        'Focus query — if provided and pruner is available, uses neural pruning to keep relevant lines',
      ),
    max_tokens: z
      .number()
      .optional()
      .describe(
        'Maximum output tokens. Defaults to half the input token count.',
      ),
  },
  async (args) => {
    try {
      const sessionId = getSessionId();
      const inputTokens = estimateTokens(args.text);
      const maxTokens = args.max_tokens ?? Math.ceil(inputTokens / 2);
      let outputText: string;
      let method: string;

      if (args.focus) {
        // Try neural pruning first
        const result = await pruneIfAvailable(args.text, args.focus);
        if (result.reductionPercent > 0) {
          // Pruner worked — further truncate if still over budget
          outputText =
            estimateTokens(result.prunedText) > maxTokens
              ? truncateToTokenBudget(result.prunedText, maxTokens)
              : result.prunedText;
          method = 'neural-prune';

          insertMetric(sessionId, 'pruner_calls', 1);
          insertMetric(
            sessionId,
            'pruner_tokens_saved',
            result.originalTokens - result.prunedTokens,
          );
        } else {
          // Pruner unavailable — fall back to truncation
          outputText = truncateToTokenBudget(args.text, maxTokens);
          method = 'truncate';
        }
      } else {
        // No focus query — just truncate
        outputText = truncateToTokenBudget(args.text, maxTokens);
        method = 'truncate';
      }

      const outputTokens = estimateTokens(outputText);
      const reductionPercent =
        inputTokens > 0
          ? ((inputTokens - outputTokens) / inputTokens) * 100
          : 0;

      logger.info(
        `[mcp] compress: ${inputTokens}→${outputTokens} tokens via ${method} (${reductionPercent.toFixed(1)}% reduction)`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: [
              `Compressed ${inputTokens} → ${outputTokens} tokens via ${method} (${reductionPercent.toFixed(1)}% reduction)`,
              '',
              outputText,
            ].join('\n'),
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] compress error: ${msg}`);
      return {
        content: [{ type: 'text' as const, text: `Compress error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------

async function main() {
  try {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    logger.info('[mcp] autoclaude MCP server running on stdio');
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[mcp] failed to start: ${msg}`);
    process.exit(1);
  }
}

main();
