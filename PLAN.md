# AutoClaude: Automated Context Management for Claude Code Sessions

## Vision

A Claude Code plugin that automatically manages context across sessions: capturing session state, persisting decisions and learnings to structured memory, injecting relevant context on session start, and monitoring context window utilization to trigger compaction before reasoning degrades. The goal is to keep context utilization below 60% while maximizing task success rate and minimizing repeated instructions.

---

## Architecture Overview

```
                         ┌─────────────────────────────┐
                         │      Claude Code Session     │
                         └──────────┬──────────────────-┘
                                    │
          ┌─────────────────────────┼─────────────────────────┐
          │                         │                         │
          ▼                         ▼                         ▼
   ┌──────────────┐     ┌───────────────────┐     ┌──────────────────┐
   │  Hook Layer   │     │  Skill Layer      │     │  MCP Server      │
   │  (Lifecycle)  │     │  (User Commands)  │     │  (Memory Store)  │
   └──────┬───────┘     └────────┬──────────┘     └────────┬─────────┘
          │                      │                         │
          ▼                      ▼                         ▼
   ┌─────────────────────────────────────────────────────────────────┐
   │                     Core Engine (Node.js)                       │
   │                                                                 │
   │  ┌──────────────┐  ┌──────────────┐  ┌───────────────────────┐ │
   │  │ Context       │  │ Session      │  │ Metrics               │ │
   │  │ Analyzer      │  │ State Manager│  │ Tracker               │ │
   │  └──────┬───────┘  └──────┬───────┘  └───────────┬───────────┘ │
   │         │                 │                       │             │
   │         ▼                 ▼                       ▼             │
   │  ┌──────────────────────────────────────────────────────────┐  │
   │  │              SQLite + FTS5 Memory Store                  │  │
   │  └──────────────────────────────────────────────────────────┘  │
   └─────────────────────────────────────────────────────────────────┘
          │
          ▼
   ┌──────────────────────┐
   │  CLAUDE.md Generator  │
   │  (Dynamic Injection)  │
   └──────────────────────┘
```

---

## Component Breakdown

### Component 1: Hook Layer (Lifecycle Event Capture)

The hook layer is the nervous system. It fires on every meaningful lifecycle event and feeds data to the core engine.

#### Events to Hook

| Event | Purpose | Hook Type |
|-------|---------|-----------|
| `SessionStart` | Inject relevant context from memory store, initialize metrics | `command` |
| `UserPromptSubmit` | Log task intent, check context utilization | `command` |
| `PostToolUse` | Capture file edits, test results, meaningful actions | `command` |
| `PreCompact` | Snapshot session state before compaction, generate handoff | `command` |
| `Stop` | Capture session summary, decisions made, learnings | `command` |
| `SessionEnd` | Finalize session record, update memory store | `command` |

#### Hook Configuration (`hooks/hooks.json`)

```json
{
  "description": "AutoClaude context management hooks",
  "hooks": {
    "SessionStart": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude session-start",
            "timeout": 10,
            "statusMessage": "Loading session context..."
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "Edit|Write|Bash",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude capture-action",
            "timeout": 5,
            "async": true
          }
        ]
      }
    ],
    "PreCompact": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude pre-compact",
            "timeout": 15,
            "statusMessage": "Saving context snapshot..."
          }
        ]
      }
    ],
    "Stop": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude session-stop",
            "timeout": 15
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude session-end",
            "timeout": 10
          }
        ]
      }
    ]
  }
}
```

#### Hook Input/Output Contract

Each hook receives JSON on stdin with session metadata:

```json
{
  "session_id": "abc123",
  "transcript_path": "/home/user/.claude/projects/.../transcript.jsonl",
  "cwd": "/home/user/my-project",
  "hook_event_name": "PostToolUse"
}
```

PostToolUse also receives the tool name and result. The hook scripts parse this, delegate to the core engine, and return JSON:

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "additionalContext": "Relevant context injected here (SessionStart only)"
  }
}
```

---

### Component 2: SQLite Memory Store

The persistent brain. All session data, decisions, and learnings live here.

#### Database Schema

```sql
-- Core session tracking
CREATE TABLE sessions (
    id TEXT PRIMARY KEY,
    project_path TEXT NOT NULL,
    started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    ended_at DATETIME,
    summary TEXT,
    task_description TEXT,
    files_modified TEXT,          -- JSON array
    decisions_made TEXT,          -- JSON array
    learnings TEXT,               -- JSON array
    context_utilization_peak REAL,
    tokens_used_input INTEGER,
    tokens_used_output INTEGER,
    compaction_count INTEGER DEFAULT 0,
    parent_session_id TEXT,       -- for resumed/continued sessions
    FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);

-- Granular action log (from PostToolUse)
CREATE TABLE actions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    tool_name TEXT NOT NULL,
    file_path TEXT,
    action_type TEXT,             -- 'edit', 'create', 'delete', 'test', 'build', 'commit'
    description TEXT,
    outcome TEXT,                 -- 'success', 'failure', 'partial'
    error_message TEXT,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Decisions and architectural choices
CREATE TABLE decisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    category TEXT,                -- 'architecture', 'pattern', 'library', 'convention', 'bugfix'
    decision TEXT NOT NULL,
    rationale TEXT,
    files_affected TEXT,          -- JSON array
    supersedes_id INTEGER,       -- if this replaces a previous decision
    FOREIGN KEY (session_id) REFERENCES sessions(id),
    FOREIGN KEY (supersedes_id) REFERENCES decisions(id)
);

-- Learnings (mistakes, gotchas, patterns discovered)
CREATE TABLE learnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    project_path TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    category TEXT,                -- 'gotcha', 'pattern', 'performance', 'security', 'convention'
    learning TEXT NOT NULL,
    context TEXT,                 -- what was happening when this was learned
    relevance_score REAL DEFAULT 1.0,  -- decays over time, reinforced by use
    times_referenced INTEGER DEFAULT 0,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Pre-compaction snapshots (handoff files)
CREATE TABLE snapshots (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    trigger TEXT,                 -- 'manual', 'auto', 'session_end'
    current_task TEXT,
    progress_summary TEXT,
    open_questions TEXT,          -- JSON array
    next_steps TEXT,              -- JSON array
    working_files TEXT,           -- JSON array of {path, state, changes}
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Metrics for performance tracking
CREATE TABLE metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    metric_name TEXT NOT NULL,    -- 'context_utilization', 'tokens_in', 'tokens_out', 'tool_calls'
    metric_value REAL NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

-- Full-text search index
CREATE VIRTUAL TABLE sessions_fts USING fts5(
    summary, task_description, content='sessions', content_rowid='rowid'
);

CREATE VIRTUAL TABLE decisions_fts USING fts5(
    decision, rationale, content='decisions', content_rowid='rowid'
);

CREATE VIRTUAL TABLE learnings_fts USING fts5(
    learning, context, content='learnings', content_rowid='rowid'
);
```

#### Storage Location

```
~/.autoclaude/
├── memory.db               # SQLite database
├── config.json             # User configuration
└── logs/
    └── autoclaude.log      # Debug logs
```

---

### Component 3: Core Engine (Node.js CLI)

A single `bin/autoclaude` executable that handles all hook commands.

#### Command Interface

```bash
autoclaude session-start    # Read stdin hook input, inject context
autoclaude capture-action   # Read stdin PostToolUse input, log action
autoclaude pre-compact      # Snapshot state before compaction
autoclaude session-stop     # Generate session summary
autoclaude session-end      # Finalize and persist
autoclaude query <text>     # Search memory (for MCP/skill use)
autoclaude stats            # Show metrics dashboard
autoclaude gc               # Garbage collect old/irrelevant data
```

#### Session Start Flow (Context Injection)

This is the most critical path. On every session start, the engine:

```
1. Read hook stdin → extract session_id, cwd, source (startup|resume|compact|clear)
2. Identify project from cwd
3. Query memory store:
   a. Last 3 session summaries for this project
   b. All active decisions for this project (not superseded)
   c. Top 10 learnings by relevance_score (decayed by time, boosted by references)
   d. Most recent snapshot if source == 'compact' or 'resume'
4. Format as concise markdown (target: 500-1000 tokens)
5. Output JSON with additionalContext field
```

**Token Budget for Injection:**

| Category | Target Tokens | Content |
|----------|--------------|---------|
| Recent session summaries | 200-300 | What was done recently |
| Active decisions | 100-200 | Architectural choices still in effect |
| Relevant learnings | 100-200 | Gotchas and patterns for this project |
| Snapshot (if resuming) | 200-400 | Current task, progress, next steps |
| **Total** | **500-1000** | Keeps injection lean |

#### Action Capture Flow (PostToolUse)

Runs async to avoid blocking:

```
1. Read hook stdin → extract tool_name, input, output
2. Classify action:
   - Edit/Write → file modification (extract path, description)
   - Bash(npm test) → test run (extract pass/fail)
   - Bash(npm run build) → build (extract success/failure)
   - Bash(git commit) → commit (extract message)
3. Insert into actions table
4. Exit 0 (no output needed, async)
```

#### Pre-Compact Flow

```
1. Read hook stdin → extract trigger (manual|auto), custom_instructions
2. Read recent actions from current session
3. Generate snapshot:
   - Current task (from most recent UserPromptSubmit)
   - Progress (completed actions)
   - Open questions
   - Modified files with current state
   - Next steps
4. Insert into snapshots table
5. Output JSON with systemMessage: "Context snapshot saved"
```

#### Session Stop Flow

```
1. Read all actions for current session
2. Generate structured summary:
   - What was accomplished
   - Files modified
   - Decisions made (extracted from conversation patterns)
   - Learnings (errors encountered, patterns discovered)
3. Update sessions table with summary
4. Output summary as additionalContext (Claude sees it before stopping)
```

---

### Component 4: MCP Server (Memory Query Interface)

An MCP server that gives Claude direct access to search the memory store during a session.

#### Tools Exposed

```json
{
  "tools": [
    {
      "name": "autoclaude_search",
      "description": "Search past session history, decisions, and learnings for the current project",
      "inputSchema": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "Natural language search query" },
          "category": {
            "type": "string",
            "enum": ["sessions", "decisions", "learnings", "all"],
            "default": "all"
          },
          "limit": { "type": "number", "default": 5 }
        },
        "required": ["query"]
      }
    },
    {
      "name": "autoclaude_record_decision",
      "description": "Record an architectural decision or convention for future reference",
      "inputSchema": {
        "type": "object",
        "properties": {
          "decision": { "type": "string" },
          "rationale": { "type": "string" },
          "category": { "type": "string" },
          "files_affected": { "type": "array", "items": { "type": "string" } }
        },
        "required": ["decision", "rationale"]
      }
    },
    {
      "name": "autoclaude_record_learning",
      "description": "Record a gotcha, pattern, or insight discovered during development",
      "inputSchema": {
        "type": "object",
        "properties": {
          "learning": { "type": "string" },
          "category": { "type": "string" },
          "context": { "type": "string" }
        },
        "required": ["learning"]
      }
    },
    {
      "name": "autoclaude_metrics",
      "description": "Get context utilization and session performance metrics",
      "inputSchema": {
        "type": "object",
        "properties": {
          "period": { "type": "string", "enum": ["session", "day", "week"], "default": "session" }
        }
      }
    }
  ]
}
```

#### MCP Server Implementation

```
autoclaude-mcp/
├── index.ts          # MCP server entry point (stdio transport)
├── handlers.ts       # Tool handler implementations
└── db.ts            # Shared SQLite access layer
```

The MCP server runs as a stdio process, started by the plugin's `.mcp.json`:

```json
{
  "autoclaude-memory": {
    "command": "${CLAUDE_PLUGIN_ROOT}/bin/autoclaude-mcp",
    "env": {
      "AUTOCLAUDE_DB": "${HOME}/.autoclaude/memory.db"
    }
  }
}
```

---

### Component 5: Skills (User-Facing Commands)

#### Skill: `/autoclaude:status`

```yaml
---
name: status
description: Show current session context utilization and memory stats
user-invocable: true
disable-model-invocation: true
allowed-tools: "Bash"
---

Run `${CLAUDE_PLUGIN_ROOT}/bin/autoclaude stats` and display the results.
Show: current session token usage, context utilization %, active decisions count,
recent learnings count, and recommendation (compact now / continue / review decisions).
```

#### Skill: `/autoclaude:recall`

```yaml
---
name: recall
description: Search past sessions and decisions for relevant context
argument-hint: "[search query]"
user-invocable: true
disable-model-invocation: false
allowed-tools: "Bash"
---

Search the autoclaude memory store for: $ARGUMENTS

Run `${CLAUDE_PLUGIN_ROOT}/bin/autoclaude query "$ARGUMENTS"` and present the results
in a structured format showing sessions, decisions, and learnings that match.
```

#### Skill: `/autoclaude:snapshot`

```yaml
---
name: snapshot
description: Manually capture current session state to memory
user-invocable: true
disable-model-invocation: true
allowed-tools: "Bash"
---

Capture the current session state. Summarize:
1. What task is currently in progress
2. What has been accomplished so far
3. What files have been modified
4. Any open questions or blockers
5. Recommended next steps

Then run `${CLAUDE_PLUGIN_ROOT}/bin/autoclaude snapshot` with this summary piped to stdin.
```

---

### Component 6: Metrics & Monitoring

#### Tracked Metrics

| Metric | How Measured | Target |
|--------|-------------|--------|
| Context window utilization | Estimated from transcript size + tool outputs | < 60% |
| Tokens per successful commit | Sum input tokens between commits | Trending down |
| Compaction frequency | Count of PreCompact events per session | < 2 per session |
| Repeated instruction rate | FTS5 similarity of UserPromptSubmit across sessions | Trending down |
| Decision recall accuracy | Times a decision was referenced vs re-explained | > 80% |
| Session continuity score | How much context survived across clear/compact | > 70% |

#### Context Utilization Estimation

Since Claude Code doesn't expose exact token counts to hooks, we estimate:

```
1. Read transcript_path (JSONL file)
2. Count bytes of recent messages (rough proxy: 1 token ~ 4 bytes English)
3. Estimate utilization: transcript_bytes / (200000 * 4)
4. If > 55%, inject warning via systemMessage
5. If > 70%, suggest /compact in systemMessage
```

This is imprecise but directionally useful. The warning at 55% gives a buffer before the 60% degradation threshold.

#### Relevance Decay Algorithm

Learnings and decisions lose relevance over time unless reinforced:

```
relevance_score = base_score * decay_factor * reference_boost

where:
  decay_factor = 0.95 ^ days_since_created     (5% daily decay)
  reference_boost = 1 + (0.1 * times_referenced) (10% boost per reference)
  base_score = 1.0 (default)
```

Garbage collection runs on `session-start` and removes entries where `relevance_score < 0.1`.

---

## Plugin File Structure

```
autoclaude/
├── .claude-plugin/
│   └── plugin.json
├── .mcp.json
├── hooks/
│   └── hooks.json
├── skills/
│   ├── status/
│   │   └── SKILL.md
│   ├── recall/
│   │   └── SKILL.md
│   └── snapshot/
│       └── SKILL.md
├── bin/
│   ├── autoclaude              # Main CLI (Node.js, compiled)
│   └── autoclaude-mcp          # MCP server (Node.js, compiled)
├── src/
│   ├── cli/
│   │   ├── index.ts            # CLI entry point + command router
│   │   ├── session-start.ts    # SessionStart hook handler
│   │   ├── capture-action.ts   # PostToolUse hook handler
│   │   ├── pre-compact.ts      # PreCompact hook handler
│   │   ├── session-stop.ts     # Stop hook handler
│   │   ├── session-end.ts      # SessionEnd hook handler
│   │   ├── query.ts            # Memory search command
│   │   ├── stats.ts            # Metrics display
│   │   └── gc.ts               # Garbage collection
│   ├── mcp/
│   │   ├── index.ts            # MCP server entry
│   │   └── handlers.ts         # Tool handlers
│   ├── core/
│   │   ├── db.ts               # SQLite connection + migrations
│   │   ├── memory.ts           # Read/write memory store
│   │   ├── analyzer.ts         # Classify actions, extract decisions/learnings
│   │   ├── summarizer.ts       # Generate session summaries (local, no LLM)
│   │   ├── injector.ts         # Format context for injection
│   │   └── metrics.ts          # Track and compute metrics
│   └── util/
│       ├── tokens.ts           # Token estimation
│       ├── logger.ts           # File-based logging
│       └── config.ts           # Configuration loader
├── sql/
│   └── schema.sql              # Database schema
├── package.json
├── tsconfig.json
└── README.md
```

---

## Implementation Phases

### Phase 1: Foundation

**Goal:** Core infrastructure that captures and persists session data.

**Deliverables:**
- [ ] Project scaffolding (package.json, tsconfig, build config)
- [ ] SQLite database layer with schema and migrations
- [ ] CLI skeleton with command routing
- [ ] `session-start` hook: read stdin, log session, output empty context (no injection yet)
- [ ] `session-end` hook: finalize session record
- [ ] `capture-action` hook: parse PostToolUse input, insert into actions table
- [ ] Plugin manifest (plugin.json, hooks.json)
- [ ] Install and test with Claude Code

**Validation:** Run a Claude Code session with the plugin enabled. Verify that actions are being logged to SQLite. Check `autoclaude stats` shows the session.

### Phase 2: Context Injection

**Goal:** Automatically inject relevant context on session start.

**Deliverables:**
- [ ] Session summary generator (analyze actions, produce 2-3 sentence summary)
- [ ] Context injector (query recent sessions, decisions, learnings; format markdown)
- [ ] Token budget enforcement (cap injection at 1000 tokens)
- [ ] `session-start` hook updated to inject context via `additionalContext`
- [ ] `pre-compact` hook: snapshot current state before compaction
- [ ] Snapshot restoration on `source: compact` and `source: resume`

**Validation:** Start a new session in a project where previous sessions exist. Verify Claude receives relevant context without being asked. Verify post-compact sessions restore state.

### Phase 3: Memory Intelligence

**Goal:** Record and retrieve decisions and learnings automatically.

**Deliverables:**
- [ ] Decision extraction from PostToolUse patterns (e.g., config changes, library additions)
- [ ] Learning extraction from error→fix sequences
- [ ] MCP server with `autoclaude_search`, `autoclaude_record_decision`, `autoclaude_record_learning`
- [ ] Relevance decay algorithm running on session-start gc
- [ ] FTS5 search across sessions, decisions, learnings
- [ ] `/autoclaude:recall` skill

**Validation:** After several sessions, search for a past decision using the MCP tool. Verify it returns relevant results. Verify old irrelevant learnings decay below threshold.

### Phase 4: Metrics & Optimization

**Goal:** Monitor context utilization and optimize injection strategy.

**Deliverables:**
- [ ] Context utilization estimator (transcript byte counting)
- [ ] Utilization warnings via systemMessage at 55% and 70%
- [ ] `/autoclaude:status` skill showing live metrics
- [ ] Metrics table populated on every hook event
- [ ] `autoclaude stats` CLI command with per-session and per-project rollups
- [ ] Repeated instruction detection (FTS5 similarity across UserPromptSubmit logs)
- [ ] `/autoclaude:snapshot` skill for manual state capture

**Validation:** Run a long session and verify utilization warnings appear. Check that stats show meaningful trends over multiple sessions.

### Phase 5: Polish & Distribution

**Goal:** Production-ready plugin with documentation and marketplace listing.

**Deliverables:**
- [ ] Error handling and graceful degradation (hooks must never block Claude)
- [ ] Configuration file (`~/.autoclaude/config.json`) for tuning thresholds
- [ ] Build pipeline (TypeScript → compiled binaries via `pkg` or `esbuild`)
- [ ] README with installation and usage guide
- [ ] Marketplace listing (plugin.json metadata)
- [ ] Integration tests (mock hook inputs, verify outputs)

---

## Design Principles

1. **Never block Claude.** All hooks have short timeouts. PostToolUse runs async. If the memory store is unavailable, hooks exit 0 silently.

2. **Token-efficient injection.** Context injection is budgeted at 500-1000 tokens. Use progressive disclosure: inject summaries, let Claude query for details via MCP.

3. **No LLM dependency for core operations.** Summaries and classifications use heuristics, not API calls. This keeps the plugin fast, free, and offline-capable.

4. **Decay over accumulation.** Memory entries lose relevance over time. Frequently referenced items survive. This prevents unbounded growth and stale context.

5. **Transparent operation.** Every injection includes a header like `[AutoClaude: injecting context from 3 previous sessions]` so the user knows what's happening.

6. **Project-scoped memory.** Each project gets its own memory namespace. Learnings from project A don't pollute project B (unless explicitly shared).

---

## Configuration

```json
{
  "injection": {
    "enabled": true,
    "maxTokens": 1000,
    "includeSessions": 3,
    "includeDecisions": true,
    "includeLearnings": true,
    "includeSnapshot": true
  },
  "capture": {
    "enabled": true,
    "asyncActions": true,
    "captureTools": ["Edit", "Write", "Bash"]
  },
  "metrics": {
    "enabled": true,
    "warnUtilization": 0.55,
    "criticalUtilization": 0.70
  },
  "decay": {
    "dailyRate": 0.05,
    "referenceBoost": 0.10,
    "gcThreshold": 0.10
  },
  "logging": {
    "level": "info",
    "file": "~/.autoclaude/logs/autoclaude.log"
  }
}
```

---

## Key Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Language | TypeScript (Node.js) | Claude Code plugins run in Node; shared ecosystem |
| Database | SQLite + FTS5 | Zero dependencies, fast, file-based, full-text search built in |
| Transport | stdio (MCP) + command (hooks) | Native Claude Code patterns, no HTTP server needed |
| Summarization | Heuristic (no LLM) | Speed, cost, offline capability |
| Token estimation | Byte-based proxy | No access to actual tokenizer in hooks; 4 bytes/token is sufficient |
| Distribution | Claude Code plugin marketplace | Native discovery and installation |

---

## Interaction with Existing Plugins

AutoClaude complements (does not replace) the plugins already installed:

| Plugin | Relationship |
|--------|-------------|
| **claude-mem** | Claude-mem captures everything; AutoClaude is more structured and selective. Users can run both, or disable claude-mem's injection if AutoClaude covers their needs. |
| **context7** | Context7 handles library documentation. AutoClaude handles project-specific memory. No overlap. |
| **repomix** | Repomix packs codebases for analysis. AutoClaude tracks session history. Complementary. |
| **code-review** | AutoClaude can log review outcomes as learnings for future sessions. |
| **feature-dev** | AutoClaude can capture feature development decisions and patterns. |

---

## Risk Mitigation

| Risk | Mitigation |
|------|-----------|
| Hook timeout blocking Claude | All timeouts set low (5-15s). Async where possible. Exit 0 on any error. |
| Memory store corruption | SQLite WAL mode. Graceful degradation if DB is locked/missing. |
| Token budget overflow | Hard cap on injection size. Truncate with priority (snapshot > decisions > learnings > sessions). |
| Stale context injection | Relevance decay + garbage collection. Decisions can be superseded. |
| Performance overhead | Async action capture. Minimal processing in hook scripts. Heavy work deferred to session-end. |
| Privacy | All data local. No network calls. No telemetry. User controls what's captured via config. |
