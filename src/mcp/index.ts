/**
 * AutoClaude MCP Server
 *
 * Exposes memory store tools to Claude via the Model Context Protocol:
 * - autoclaude_search: Full-text search across sessions, decisions, learnings
 * - autoclaude_record_decision: Record an architectural decision
 * - autoclaude_record_learning: Record a gotcha, pattern, or insight
 * - autoclaude_metrics: Get session and project performance metrics
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
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
} from "../core/memory";
import type { SearchResult } from "../core/memory";
import { logger } from "../util/logger";
import { getConfig } from "../util/config";

// ---------------------------------------------------------------------------
// Initialize
// ---------------------------------------------------------------------------

const config = getConfig();
logger.setLevel(config.logging.level as any);
if (config.logging.file) {
  logger.setLogFile(config.logging.file);
}

logger.info("[mcp] autoclaude MCP server starting");

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
  return process.env.AUTOCLAUDE_SESSION_ID || "unknown";
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
  if (results.length === 0) return "No results found.";

  const lines: string[] = [];
  for (const r of results) {
    const source =
      r.source === "sessions"
        ? "Session"
        : r.source === "decisions"
          ? "Decision"
          : "Learning";
    const snippet = r.snippet
      .replace(/<b>/g, "**")
      .replace(/<\/b>/g, "**");
    lines.push(`[${source} #${r.id}] ${snippet}`);
  }
  return lines.join("\n\n");
}

// ---------------------------------------------------------------------------
// Server setup
// ---------------------------------------------------------------------------

const server = new McpServer(
  {
    name: "autoclaude-memory",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  },
);

// ---------------------------------------------------------------------------
// Tool: autoclaude_search
// ---------------------------------------------------------------------------

server.tool(
  "autoclaude_search",
  "Search past session history, decisions, and learnings for the current project",
  {
    query: z.string().describe("Natural language search query"),
    category: z
      .enum(["sessions", "decisions", "learnings", "all"])
      .default("all")
      .describe("Category to search within"),
    limit: z
      .number()
      .default(5)
      .describe("Maximum number of results to return"),
  },
  async (args) => {
    try {
      const results = searchMemory(
        args.query,
        args.category as "sessions" | "decisions" | "learnings" | "all",
        args.limit,
      );

      // Boost relevance of any returned learnings
      for (const r of results) {
        if (r.source === "learnings") {
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
            type: "text" as const,
            text: formatted,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] search error: ${msg}`);
      return {
        content: [{ type: "text" as const, text: `Search error: ${msg}` }],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: autoclaude_record_decision
// ---------------------------------------------------------------------------

server.tool(
  "autoclaude_record_decision",
  "Record an architectural decision or convention for future reference",
  {
    decision: z.string().describe("The decision that was made"),
    rationale: z.string().describe("Why this decision was made"),
    category: z
      .string()
      .optional()
      .describe(
        "Category: architecture, pattern, library, convention, bugfix",
      ),
    files_affected: z
      .array(z.string())
      .optional()
      .describe("List of file paths affected by this decision"),
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
            type: "text" as const,
            text: `Decision recorded (id: ${id}). Category: ${args.category || "general"}. This will be included in future session context injection.`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] record_decision error: ${msg}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to record decision: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: autoclaude_record_learning
// ---------------------------------------------------------------------------

server.tool(
  "autoclaude_record_learning",
  "Record a gotcha, pattern, or insight discovered during development",
  {
    learning: z
      .string()
      .describe("The gotcha, pattern, or insight discovered"),
    category: z
      .string()
      .optional()
      .describe("Category: gotcha, pattern, performance, security, convention"),
    context: z
      .string()
      .optional()
      .describe("What was happening when this was learned"),
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
            type: "text" as const,
            text: `Learning recorded (id: ${id}). Category: ${args.category || "general"}. Relevance score: 1.0 (will decay over time unless referenced).`,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] record_learning error: ${msg}`);
      return {
        content: [
          {
            type: "text" as const,
            text: `Failed to record learning: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  },
);

// ---------------------------------------------------------------------------
// Tool: autoclaude_metrics
// ---------------------------------------------------------------------------

server.tool(
  "autoclaude_metrics",
  "Get context utilization and session performance metrics",
  {
    period: z
      .enum(["session", "day", "week"])
      .default("session")
      .describe("Time period for metrics aggregation"),
  },
  async (args) => {
    try {
      const projectPath = getProjectPath();
      const lines: string[] = [];

      if (args.period === "session") {
        const sessionId = getSessionId();
        const metrics = getSessionMetrics(sessionId);
        const actions = getSessionActions(sessionId);

        lines.push(`## Session Metrics (${sessionId})`);
        lines.push(`- Actions recorded: ${actions.length}`);

        if (metrics.length > 0) {
          lines.push("- Tracked metrics:");
          for (const m of metrics) {
            lines.push(`  - ${m.metric_name}: ${m.metric_value}`);
          }
        }

        // Action breakdown
        const byType: Record<string, number> = {};
        let failures = 0;
        for (const a of actions) {
          const t = a.action_type || "other";
          byType[t] = (byType[t] || 0) + 1;
          if (a.outcome === "failure") failures++;
        }
        if (Object.keys(byType).length > 0) {
          lines.push("- Action breakdown:");
          for (const [type, count] of Object.entries(byType)) {
            lines.push(`  - ${type}: ${count}`);
          }
        }
        if (failures > 0) {
          lines.push(`- Failures: ${failures}`);
        }
      } else {
        // Project-level metrics
        const sessions = getRecentSessions(
          projectPath,
          args.period === "day" ? 10 : 50,
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
        content: [{ type: "text" as const, text: lines.join("\n") }],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`[mcp] metrics error: ${msg}`);
      return {
        content: [
          { type: "text" as const, text: `Metrics error: ${msg}` },
        ],
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
    logger.info("[mcp] autoclaude MCP server running on stdio");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[mcp] failed to start: ${msg}`);
    process.exit(1);
  }
}

main();
