/**
 * AutoClaude MCP Server
 *
 * Exposes memory store tools to Claude via the Model Context Protocol:
 * - search: Full-text search across sessions, decisions, learnings
 * - record_decision: Record an architectural decision
 * - record_learning: Record a gotcha, pattern, or insight
 * - metrics: Get session and project performance metrics
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import {
  searchMemory,
  createSession,
  getSession,
  insertDecision,
  insertLearning,
  incrementLearningReference,
  getRecentSessions,
  getActiveDecisions,
  getTopLearnings,
  getSessionMetrics,
  getSessionActions,
} from '../core/memory';
import type { SearchResult } from '../core/memory';
import { logger } from '../util/logger';
import type { LogLevel } from '../util/logger';
import { getConfig } from '../util/config';
import { estimateTokens, truncateToTokenBudget } from '../util/tokens';
import {
  prune,
  pruneIfAvailable,
  isAvailable as isPrunerAvailable,
} from '../core/pruner';

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
 * Detects the current project path from environment or cwd.
 */
function getProjectPath(): string {
  return process.env.AUTOCLAUDE_PROJECT_PATH || process.cwd();
}

/**
 * Detects the current session ID from environment.
 */
function getSessionId(): string {
  return process.env.AUTOCLAUDE_SESSION_ID || 'unknown';
}

/**
 * Ensures a session record exists for the given session ID.
 * Required because better-sqlite3 enforces FK constraints and
 * decisions/learnings reference session IDs.
 */
function ensureSession(sessionId: string, projectPath: string): void {
  if (!getSession(sessionId)) {
    createSession(sessionId, projectPath);
    logger.debug(`[mcp] Created session record for ${sessionId}`);
  }
}

/**
 * Formats search results as readable text.
 */
function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return 'No results found.';

  const lines: string[] = [];
  for (const r of results) {
    const source =
      r.source === 'sessions'
        ? 'Session'
        : r.source === 'decisions'
          ? 'Decision'
          : 'Learning';
    const snippet = r.snippet.replace(/<b>/g, '**').replace(/<\/b>/g, '**');
    lines.push(`[${source} #${r.id}] ${snippet}`);
  }
  return lines.join('\n\n');
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: 'autoclaude-memory',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool: search
// ---------------------------------------------------------------------------

server.tool(
  'search',
  'Search past session history, decisions, and learnings for the current project',
  {
    query: z.string().describe('Natural language search query'),
    category: z
      .enum(['sessions', 'decisions', 'learnings', 'all'])
      .default('all')
      .describe('Category to search within'),
    limit: z
      .number()
      .default(5)
      .describe('Maximum number of results to return'),
  },
  async (args) => {
    try {
      const results = searchMemory(
        args.query,
        args.category as 'sessions' | 'decisions' | 'learnings' | 'all',
        args.limit,
      );

      // Boost relevance of any returned learnings
      for (const r of results) {
        if (r.source === 'learnings') {
          incrementLearningReference(r.id);
        }
      }

      const formatted = formatSearchResults(results);

      logger.info(
        `[mcp] search: query="${args.query}" category=${args.category} results=${results.length}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: formatted,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] search error: ${msg}`);
      return {
        content: [{ type: 'text' as const, text: `Search error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: record_decision
// ---------------------------------------------------------------------------

server.tool(
  'record_decision',
  'Record an architectural decision or convention for future reference',
  {
    decision: z.string().describe('The decision that was made'),
    rationale: z.string().describe('Why this decision was made'),
    category: z
      .string()
      .optional()
      .describe('Category: architecture, pattern, library, convention, bugfix'),
    files_affected: z
      .array(z.string())
      .optional()
      .describe('List of file paths affected by this decision'),
  },
  async (args) => {
    try {
      const projectPath = getProjectPath();
      const sessionId = getSessionId();

      ensureSession(sessionId, projectPath);

      const id = insertDecision({
        session_id: sessionId,
        project_path: projectPath,
        category: args.category ?? null,
        decision: args.decision,
        rationale: args.rationale,
        files_affected: args.files_affected
          ? JSON.stringify(args.files_affected)
          : null,
        supersedes_id: null,
      });

      logger.info(
        `[mcp] recorded decision #${id}: ${args.decision.slice(0, 80)}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Decision recorded (id: ${id}). Category: ${args.category || 'general'}. This will be included in future session context injection.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] record_decision error: ${msg}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to record decision: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: record_learning
// ---------------------------------------------------------------------------

server.tool(
  'record_learning',
  'Record a gotcha, pattern, or insight discovered during development',
  {
    learning: z.string().describe('The gotcha, pattern, or insight discovered'),
    category: z
      .string()
      .optional()
      .describe('Category: gotcha, pattern, performance, security, convention'),
    context: z
      .string()
      .optional()
      .describe('What was happening when this was learned'),
  },
  async (args) => {
    try {
      const projectPath = getProjectPath();
      const sessionId = getSessionId();

      ensureSession(sessionId, projectPath);

      const id = insertLearning({
        session_id: sessionId,
        project_path: projectPath,
        category: args.category ?? null,
        learning: args.learning,
        context: args.context ?? null,
        relevance_score: 1.0,
        times_referenced: 0,
      });

      logger.info(
        `[mcp] recorded learning #${id}: ${args.learning.slice(0, 80)}`,
      );

      return {
        content: [
          {
            type: 'text' as const,
            text: `Learning recorded (id: ${id}). Category: ${args.category || 'general'}. Relevance score: 1.0 (will decay over time unless referenced).`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] record_learning error: ${msg}`);
      return {
        content: [
          {
            type: 'text' as const,
            text: `Failed to record learning: ${msg}`,
          },
        ],
        isError: true,
      };
    }
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
// Tool: metrics
// ---------------------------------------------------------------------------

server.tool(
  'metrics',
  'Get context utilization and session performance metrics (includes pruner stats)',
  {
    period: z
      .enum(['session', 'day', 'week'])
      .default('session')
      .describe('Time period for metrics aggregation'),
  },
  async (args) => {
    try {
      const projectPath = getProjectPath();
      const lines: string[] = [];

      if (args.period === 'session') {
        const sessionId = getSessionId();
        const metrics = getSessionMetrics(sessionId);
        const actions = getSessionActions(sessionId);
        const prunerUp = await isPrunerAvailable();

        lines.push(`## Session Metrics (${sessionId})`);
        lines.push(`- Actions recorded: ${actions.length}`);
        lines.push(`- SWE-Pruner: ${prunerUp ? 'available' : 'unavailable'}`);

        if (metrics.length > 0) {
          lines.push('- Tracked metrics:');
          for (const m of metrics) {
            lines.push(`  - ${m.metric_name}: ${m.metric_value}`);
          }
        }

        // Action breakdown
        const byType: Record<string, number> = {};
        let failures = 0;
        for (const a of actions) {
          const t = a.action_type || 'other';
          byType[t] = (byType[t] || 0) + 1;
          if (a.outcome === 'failure') failures++;
        }
        if (Object.keys(byType).length > 0) {
          lines.push('- Action breakdown:');
          for (const [type, count] of Object.entries(byType)) {
            lines.push(`  - ${type}: ${count}`);
          }
        }
        if (failures > 0) {
          lines.push(`- Failures: ${failures}`);
        }

        // Pruner stats from metrics
        const prunerCalls = metrics
          .filter((m) => m.metric_name === 'pruner_calls')
          .reduce((sum, m) => sum + m.metric_value, 0);
        const tokensSaved = metrics
          .filter((m) => m.metric_name === 'pruner_tokens_saved')
          .reduce((sum, m) => sum + m.metric_value, 0);
        if (prunerCalls > 0) {
          lines.push('- Pruner:');
          lines.push(`  - Calls: ${prunerCalls}`);
          lines.push(`  - Tokens saved: ${tokensSaved}`);
        }
      } else {
        // Project-level metrics
        const sessions = getRecentSessions(
          projectPath,
          args.period === 'day' ? 10 : 50,
        );
        const decisions = getActiveDecisions(projectPath);
        const learnings = getTopLearnings(projectPath, 100);

        lines.push(`## Project Metrics (${args.period})`);
        lines.push(`- Sessions: ${sessions.length}`);
        lines.push(`- Active decisions: ${decisions.length}`);
        lines.push(`- Learnings: ${learnings.length}`);

        if (learnings.length > 0) {
          const avgRelevance =
            learnings.reduce((s, l) => s + l.relevance_score, 0) /
            learnings.length;
          lines.push(`- Avg learning relevance: ${avgRelevance.toFixed(3)}`);
        }

        // Count total actions across sessions
        let totalActions = 0;
        for (const s of sessions.slice(0, 10)) {
          const actions = getSessionActions(s.id);
          totalActions += actions.length;
        }
        lines.push(
          `- Total actions (recent ${Math.min(sessions.length, 10)} sessions): ${totalActions}`,
        );
      }

      return {
        content: [{ type: 'text' as const, text: lines.join('\n') }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] metrics error: ${msg}`);
      return {
        content: [{ type: 'text' as const, text: `Metrics error: ${msg}` }],
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
