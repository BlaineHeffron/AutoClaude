# AutoClaude — Project Instructions

## What This Is

AutoClaude provides structured memory management, token minimization, and intelligent
context for Claude Code and Codex. It complements Claude Code's native memory by adding
FTS5 search, relevance decay, token budgeting, implicit decision extraction,
error-fix learning, and pre-compaction snapshots.

## Key Facts

- TypeScript source files across 4 layers (cli, core, mcp, util)
- Test files with Node.js built-in test runner, real SQLite (no mocks)
- Hooks always return `{continue: true}` — never block Claude
- Data stored in `~/.autoclaude/memory.db` (SQLite, WAL mode)
- Token budget priority: snapshot > decisions > learnings
- FTS5 indexes on sessions, decisions, learnings, prompts
- MCP exposes `search`, `record_decision`, `record_learning`, `prune`, `compress`, `metrics`
- Native memory bridge syncs decisions/learnings to Claude Code's `~/.claude/projects/` on session stop

## Commands

```bash
npm run build   # production build (esbuild)
npm test        # build tests + run all (includes benchmarks)
npm run lint    # ESLint
npm run install:codex  # install Codex skill + MCP wiring
```
