# AutoClaude — Project Instructions

## What This Is

AutoClaude provides persistent memory and token minimization for both Claude Code and Codex.
Claude uses full plugin hooks; Codex uses MCP + skill mode (`npm run install:codex`).

## Architecture

- `src/cli/` — Hook handlers (session-start, capture-action, user-prompt, pre-compact, session-stop, session-end) + CLI commands (backup, export, gc, query, stats)
- `src/core/` — Engine: db.ts (SQLite), memory.ts (18 public DAL functions), injector.ts (token-budgeted context assembly), analyzer.ts (decision/learning extraction), summarizer.ts, metrics.ts
- `src/mcp/` — MCP server with 6 tools (search, record_decision, record_learning, prune, compress, metrics)
- `src/util/` — config.ts, logger.ts, tokens.ts
- `codex-skill/autoclaude-codex/` — Codex skill package
- `tests/` — 19 test files, 123 tests including 26 benchmark assertions. Node.js built-in test runner, real SQLite (no mocks).
- `sql/schema.sql` — 7 tables + FTS5 indexes + sync triggers
- `hooks/hooks.json` — 6 lifecycle hooks
- `skills/` — 3 skills: status, recall, snapshot

## Key Design Decisions

- All hooks return `{continue: true}` — never block Claude
- Data scoped by project_path (CWD)
- Token budget priority: snapshot > decisions > learnings > sessions
- Relevance decay: `score *= (1 - dailyRate)` each session start
- FTS5 for full-text search across sessions, decisions, learnings, prompts
- SQLite WAL mode for concurrent reads

## Development

```bash
npm run build      # esbuild production bundle
npm run build:tsc  # TypeScript with type checking
npm test           # build tests + run (includes benchmarks)
npm run lint       # ESLint
npm run format     # Prettier
npm run install:codex  # install Codex skill + MCP wiring
```

## Testing

Tests use temp SQLite databases in /tmp. The env var `AUTOCLAUDE_DB` is set BEFORE imports so modules use the test DB. The benchmark suite (tests/benchmark.test.ts) tests 6 dimensions: context injection relevance, FTS search precision/recall, token budget efficiency, relevance decay, session continuity, repeated instruction detection.
