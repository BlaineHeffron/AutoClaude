# AutoClaude — Project Instructions

## What This Is

AutoClaude provides structured memory management, token minimization, and intelligent
context for Claude Code. It complements Claude Code's native memory (MEMORY.md)
by adding features native memory lacks: FTS5 search, relevance decay, token budgeting,
implicit decision extraction, error-fix learning, and pre-compaction snapshots.

## Architecture

- `src/cli/` — Hook handlers (session-start, capture-action, user-prompt, pre-compact, session-stop, session-end) + CLI commands (backup, export, gc, query, stats)
- `src/core/` — Engine: db.ts (SQLite), memory.ts (18 public DAL functions), injector.ts (token-budgeted context assembly), analyzer.ts (decision/learning extraction), summarizer.ts, metrics.ts, native-memory.ts (bridge to Claude Code's native memory)
- `src/mcp/` — MCP server with 6 tools (search, record_decision, record_learning, prune, compress, metrics)
- `src/util/` — config.ts, logger.ts, tokens.ts
- `tests/` — Test files with Node.js built-in test runner, real SQLite (no mocks).
- `sql/schema.sql` — 7 tables + FTS5 indexes + sync triggers
- `hooks/hooks.json` — 6 lifecycle hooks
- `skills/` — 1 skill: snapshot

## Key Design Decisions

- All hooks return `{continue: true}` — never block Claude
- Data scoped by project_path (CWD)
- Token budget priority: snapshot > decisions > learnings (sessions removed — handled by native memory)
- Relevance decay: `score *= (1 - dailyRate)` each session start
- FTS5 for full-text search across sessions, decisions, learnings, prompts
- SQLite WAL mode for concurrent reads
- Native memory bridge: syncs decisions/learnings to `~/.claude/projects/<project>/memory/` on session stop

## Development

```bash
npm run build      # esbuild production bundle
npm run build:tsc  # TypeScript with type checking
npm test           # build tests + run (includes benchmarks)
npm run lint       # ESLint
npm run format     # Prettier
npm run install:codex  # remove legacy Codex skill + MCP wiring
```

## Testing

Tests use temp SQLite databases in /tmp. The env var `AUTOCLAUDE_DB` is set BEFORE imports so modules use the test DB. The benchmark suite (tests/benchmark.test.ts) tests 6 dimensions: context injection relevance, FTS search precision/recall, token budget efficiency, relevance decay, session continuity, repeated instruction detection.
