---
name: autoclaude-codex
description: Token-minimization and memory workflow for Codex using AutoClaude MCP tools. Use when you need to reduce context size, prune or compress large code/text blocks, recall prior project decisions, or persist new decisions and learnings for future sessions.
---

# AutoClaude Codex

Use AutoClaude through MCP tool calls, not Claude hook commands.

## Workflow

1. Start by checking memory and session state.
2. Use compression tools before adding large content to context.
3. Persist useful outcomes (decisions and learnings).
4. Re-query memory when context gets large or task scope changes.

## Tool Usage

- `search`
  - Use for recall before implementing changes, especially on multi-session work.
  - Query by feature, file, error message, or decision keyword.

- `compress`
  - Use on long text or logs before including them in context.
  - Provide `focus` when possible to keep only task-relevant content.
  - Prefer this for generic text where line-level pruning is not required.

- `prune`
  - Use on large code blocks when you need line-level relevance filtering.
  - Provide a concrete query tied to the current task.

- `record_decision`
  - Call after architectural or convention decisions.
  - Include rationale and affected files whenever available.

- `record_learning`
  - Call after fixing failures or discovering reusable gotchas/patterns.
  - Include the practical context of the learning.

- `metrics`
  - Use `period="session"` to check current pressure.
  - Use `period="day"` or `period="week"` to spot recurring context bloat.

## Default Behaviors

- Prefer `compress`/`prune` before quoting big file snippets.
- Record only durable information with reuse value.
- Keep memory entries concise, specific, and implementation-facing.
