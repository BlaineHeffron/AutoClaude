# AutoClaude

A Claude Code plugin that gives Claude persistent memory across sessions. It automatically captures decisions, learnings, and session state — then injects the most relevant context when you start a new session.

**The problem:** Every Claude Code session starts from scratch. Claude doesn't remember what it did last time, what decisions were made, or what gotchas were discovered. You end up repeating yourself, re-explaining architecture, and watching Claude make the same mistakes twice.

**The solution:** AutoClaude captures everything automatically via Claude Code's hook system, stores it in SQLite, and injects the most relevant prior context at the start of each session. No wrapper scripts, no changed workflows — just install the plugin and keep working.

## Install from Marketplace

```
/plugin marketplace add BlaineHeffron/autoclaude
/plugin install autoclaude@autoclaude
```

## Install from Source

```bash
git clone https://github.com/BlaineHeffron/autoclaude.git
cd autoclaude
npm install
npm run build
claude plugins add ./
```

Either way, AutoClaude is now active. Start a Claude Code session and it works automatically in the background.

## How It Works

AutoClaude is a **self-contained Claude Code plugin**. It does not wrap or replace Claude Code — it extends it using the official plugin API. When you run `claude plugins add ./`, three things get registered:

1. **Hooks** — Shell commands that run at specific lifecycle events (session start, tool use, session end, etc.)
2. **MCP Server** — A Model Context Protocol server that gives Claude tools to search and record memories
3. **Skills** — User-invocable slash commands (`/autoclaude:status`, `/autoclaude:recall`, `/autoclaude:snapshot`)

### Lifecycle

```
You start a Claude Code session
         │
         ▼
  ┌──────────────────┐   AutoClaude injects prior context:
  │   SessionStart   │──▶ recent session summaries, active decisions,
  └──────────────────┘   learnings, and snapshots (if resuming)
         │
         ▼
  ┌──────────────────┐   AutoClaude logs each prompt and
  │ UserPromptSubmit │──▶ checks for repeated instructions
  └──────────────────┘
         │
         ▼
  ┌──────────────────┐   AutoClaude records tool calls, extracts
  │   PostToolUse    │──▶ decisions from config edits and library
  └──────────────────┘   installs
         │
         ▼
  ┌──────────────────┐   AutoClaude saves a snapshot of current
  │   PreCompact     │──▶ task, progress, and next steps before
  └──────────────────┘   context window is compacted
         │
         ▼
  ┌──────────────────┐   AutoClaude generates a session summary,
  │      Stop        │──▶ extracts learnings from error→fix
  └──────────────────┘   sequences
```

### What Gets Captured (Automatically)

| What | How | Example |
|------|-----|---------|
| **Architectural decisions** | Config file edits detected | "Modified tsconfig.json: enabled strict mode" |
| **Library choices** | Package install commands parsed | "Added dependency: jsonwebtoken, bcryptjs" |
| **Learnings (gotchas)** | Error→fix sequences detected | "Test failure fixed by editing auth.ts. Error: JWT secret undefined" |
| **Session summaries** | Heuristic from action log | "5 file edits, 2 tests, 1 build across 3 files. All tests passed." |
| **Snapshots** | Captured before context compaction | Task, progress, open questions, next steps, working files |
| **Prompts** | Logged on submit | Full prompt text with FTS5 indexing for similarity detection |

### What Gets Injected (On Session Start)

The injector assembles context in priority order under a configurable token budget:

1. **Snapshot** (highest priority, only on resume/compact) — restores exactly where you left off
2. **Active decisions** — architectural choices that haven't been superseded
3. **Top learnings** — gotchas and patterns ranked by relevance score
4. **Recent session summaries** — what happened in the last N sessions

Example injected context (at default 1000-token budget):

```markdown
# [autoclaude] Session Context

## Active Decisions
- [architecture]: Use JWT with RS256 algorithm for stateless authentication
- [library]: Added dependency: jsonwebtoken, bcryptjs
- [convention]: Use Prisma as the primary ORM with raw SQL escape hatch

## Learnings
- [gotcha]: JWT refresh tokens must be stored in httpOnly cookies, not localStorage
- [gotcha]: bcrypt compareSync blocks the event loop; use compare (async)
- [gotcha]: Prisma generates client in node_modules/.prisma; must run prisma generate after npm install

## Recent Sessions
- [Jan 31, 10:30 AM]: Implemented JWT authentication with refresh tokens and RBAC middleware
- [Jan 30, 02:45 PM]: Set up PostgreSQL with Prisma ORM and connection pooling
```

## Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Claude Code                        │
│                                                      │
│  SessionStart  UserPrompt  PostToolUse  PreCompact  │
│       │            │            │            │       │
└───────┼────────────┼────────────┼────────────┼───────┘
        │            │            │            │
        ▼            ▼            ▼            ▼
┌─────────────────────────────────────────────────────┐
│              Hook Layer (CLI handlers)               │
│  session-start │ user-prompt │ capture-action │ ...  │
└───────────────────────┬─────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  Core Engine │ │  MCP Server  │ │    Skills    │
│  - injector  │ │  - search    │ │  - /status   │
│  - analyzer  │ │  - record    │ │  - /recall   │
│  - summarizer│ │  - metrics   │ │  - /snapshot │
│  - metrics   │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌─────────────────────────────────────────────────────┐
│           SQLite Memory Store (~/.autoclaude/)       │
│  sessions │ actions │ decisions │ learnings │ FTS5   │
└─────────────────────────────────────────────────────┘
```

AutoClaude is a **plugin, not a wrapper**. You keep using `claude` exactly as before. The plugin hooks into Claude Code's lifecycle events via the plugin API, captures context in the background, and injects it transparently. There is no separate process to manage, no changed CLI invocation, and no configuration required to get started.

### Why a Plugin (Not a Wrapper Script)

- **No changed workflow** — `claude` works exactly the same, AutoClaude runs in the background
- **Official API** — Uses Claude Code's plugin system (`hooks.json`, `.mcp.json`, `skills/`)
- **Non-blocking** — Hooks always return `{continue: true}`, never blocking Claude
- **Portable** — Install with `claude plugins add`, uninstall with `claude plugins remove`
- **Composable** — Works alongside other plugins without conflicts

## Installation

### Prerequisites

- Node.js 18+ (tested on 18, 20, 22)
- Claude Code CLI (`claude`)
- `better-sqlite3` native bindings (installed automatically via npm)

### Install

```bash
git clone https://github.com/blaine/autoclaude.git
cd autoclaude
npm install
npm run build
claude plugins add ./
```

### Verify

```bash
# Check plugin is registered
claude plugins list
# Should show "autoclaude" with hooks, MCP server, and skills

# Start a session — you should see injected context if prior sessions exist
claude
```

### Uninstall

```bash
claude plugins remove autoclaude
```

Data in `~/.autoclaude/` is preserved after uninstall. Delete it manually if you want a clean slate:

```bash
rm -rf ~/.autoclaude
```

## Usage

### Passive (Automatic)

Once installed, AutoClaude works automatically. No commands needed. Every session:

1. **Start** — Prior context injected, GC runs, session recorded
2. **During** — Tool calls captured, decisions extracted, prompts logged
3. **Compact** — Snapshot saved before context window compaction
4. **End** — Session summarized, learnings extracted from error→fix patterns

### Active (Skills)

Use these slash commands in Claude Code for on-demand access:

| Command | Description |
|---------|-------------|
| `/autoclaude:status` | Dashboard with metrics, utilization, action breakdown |
| `/autoclaude:recall <query>` | Full-text search across all memories |
| `/autoclaude:snapshot` | Manually capture current state for later restoration |

### Active (MCP Tools)

Claude can use these tools directly (the MCP server makes them available):

| Tool | Description |
|------|-------------|
| `search` | Search sessions, decisions, learnings via FTS5 |
| `record_decision` | Explicitly record an architectural decision |
| `record_learning` | Explicitly record a gotcha, pattern, or insight |
| `metrics` | Query utilization and performance metrics |

### Database Maintenance

```bash
# Create a timestamped backup
node dist/cli/index.js backup

# Export all data as JSON
node dist/cli/index.js export

# Run relevance decay and garbage collection
node dist/cli/index.js gc
```

## Configuration

Create `~/.autoclaude/config.json` to customize behavior. All fields are optional — missing fields use defaults.

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
    "criticalUtilization": 0.7
  },
  "decay": {
    "dailyRate": 0.05,
    "referenceBoost": 0.1,
    "gcThreshold": 0.1
  },
  "logging": {
    "level": "info",
    "file": "~/.autoclaude/logs/autoclaude.log"
  }
}
```

### Configuration Reference

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `injection.enabled` | boolean | `true` | Enable context injection on session start |
| `injection.maxTokens` | number | `1000` | Token budget for injected context (100–10000) |
| `injection.includeSessions` | number | `3` | Number of recent sessions to include (0–20) |
| `injection.includeDecisions` | boolean | `true` | Include active architectural decisions |
| `injection.includeLearnings` | boolean | `true` | Include learnings (gotchas, patterns) |
| `injection.includeSnapshot` | boolean | `true` | Include snapshot on resume/compact |
| `capture.enabled` | boolean | `true` | Enable action capture |
| `capture.asyncActions` | boolean | `true` | Non-blocking action capture |
| `capture.captureTools` | string[] | `["Edit","Write","Bash"]` | Tool names to capture |
| `metrics.enabled` | boolean | `true` | Enable utilization tracking |
| `metrics.warnUtilization` | number | `0.55` | Warning threshold (0–1) |
| `metrics.criticalUtilization` | number | `0.7` | Critical threshold (0–1) |
| `decay.dailyRate` | number | `0.05` | Daily relevance decay rate (0–1) |
| `decay.referenceBoost` | number | `0.1` | Boost when learning is referenced (0–1) |
| `decay.gcThreshold` | number | `0.1` | Minimum relevance before GC (0–1) |
| `logging.level` | string | `"info"` | Log level: debug, info, warn, error |
| `logging.file` | string | `"~/.autoclaude/logs/autoclaude.log"` | Log file path |

## Benchmarks

We maintain a benchmark suite (`tests/benchmark.test.ts`) that measures AutoClaude's context system against a "vanilla Claude Code" baseline (no memory, no injection). Run benchmarks with:

```bash
npm test  # runs all tests including benchmarks
```

### Results Summary

Tested with 5 realistic multi-topic sessions (auth, database, frontend, testing, devops) seeded with decisions, learnings, and session summaries.

#### Context Injection Relevance

| Metric | With AutoClaude | Vanilla Claude Code |
|--------|:---:|:---:|
| Tokens of prior context at session start | **563** | 0 |
| Knowledge sections available | **3** (decisions + learnings + sessions) | 0 |
| Cross-session decisions surfaced | **8 of 10** | 0 |
| Cross-session learnings surfaced | **9 of 10** | 0 |

AutoClaude injects relevant decisions and learnings from prior sessions that would otherwise require manual re-entry.

#### FTS Search Precision & Recall

| Query | Precision | Recall | False Positives |
|-------|:---------:|:------:|:---------------:|
| Auth (JWT/bcrypt) | **1.00** | **1.00+** | 0 |
| Database (Prisma/PostgreSQL) | **1.00** | **1.00** | 0 |
| Irrelevant (quantum/blockchain) | N/A | N/A | **0** |

FTS5 achieves perfect precision with zero false positives on unrelated queries.

#### Token Budget Efficiency

| Budget | Utilization | Sections Included |
|:------:|:-----------:|:-----------------:|
| 100 tokens | **98.0%** | 1 (priority-truncated) |
| 250 tokens | **99.6%** | 2 |
| 500 tokens | **100%** | 3 (all sections) |
| 1,000 tokens | 56.3% | 3 |
| 5,000 tokens | 11.3% | 3 |

At tight budgets (100–500 tokens), the priority-based assembly achieves 98–100% utilization. The system degrades gracefully — even a 100-token budget produces useful context.

#### Relevance Decay & Garbage Collection

| Metric | Result |
|--------|:------:|
| Decay accuracy (5 cycles at 5%) | **22.6%** (expected: 22.6%) |
| Stale items garbage collected | **1 removed** (IE11 polyfill, score < 0.1) |
| High-value learning preserved | **Yes** (parameterized SQL, 10 references) |

Decay math is precise. High-reference learnings survive while stale items are cleaned.

#### Session Continuity (Snapshot Restoration)

| Field | Restored on Resume | On Normal Startup |
|-------|:------------------:|:-----------------:|
| Current task | **Yes** | No (correct) |
| Progress summary | **Yes** | No (correct) |
| Next steps | **Yes** | No (correct) |
| Snapshot priority | **Yes** (even at 300-token budget) | N/A |

All 4 snapshot fields restore correctly on resume/compact. Snapshots take priority over other sections when budget is tight.

#### Repeated Instruction Detection

| Scenario | Result |
|----------|:------:|
| Exact duplicate prompt | **Detected** |
| Similar prompt (shortened) | **Detected** |
| Unrelated prompt | **0 false positives** |

FTS5-based similarity catches both exact and near-duplicate prompts with zero false positives.

### Benchmark Design

The benchmark suite (`tests/benchmark.test.ts`) seeds a real SQLite database with 5 multi-topic sessions containing realistic decisions, learnings, and session summaries. It then measures 6 dimensions:

1. **Context Injection Relevance** — Does the injector surface the right prior knowledge?
2. **FTS Search Precision & Recall** — Can FTS5 find specific decisions/learnings without false positives?
3. **Token Budget Efficiency** — How well does the priority-based assembler use limited budgets?
4. **Relevance Decay & GC** — Does decay correctly deprioritize stale knowledge?
5. **Session Continuity** — Are snapshots restored accurately across session boundaries?
6. **Repeated Instruction Detection** — Can FTS5 similarity catch duplicate prompts?

All benchmarks run as part of the standard test suite (26 assertions, ~63ms execution time).

### E2E Benchmarks (promptfoo)

We also run end-to-end benchmarks using [promptfoo](https://www.promptfoo.dev/) that compare AutoClaude-augmented Claude against vanilla Claude Code across 8 real-world scenarios. These call `claude --print` with and without injected memory context, then evaluate the responses.

```bash
npm run bench:e2e          # full run (8 scenarios × 2 providers)
npm run bench:e2e:view     # open interactive web UI to explore results
```

#### E2E Results (Keyword Coverage)

Each scenario checks whether the response contains expected domain-specific keywords. Scores range from 0.0 (no keywords found) to 1.0 (all keywords found).

| Scenario | Category | With AutoClaude | Without | Winner |
|----------|----------|:---:|:---:|--------|
| Recall last session | Session Continuity | **1.00** | 0.00 | AutoClaude |
| Continue auth feature | Session Continuity | **0.75** | 0.25 | AutoClaude |
| Architecture decisions | Project Knowledge | **1.00** | 0.00 | AutoClaude |
| Known gotchas | Project Knowledge | **1.00** | 0.00 | AutoClaude |
| Database setup | Project Knowledge | **1.00** | 0.40 | AutoClaude |
| Tech stack overview | Cold Start | **1.00** | 0.00 | AutoClaude |
| Detect duplicate TS fix | Repeated Instruction | 0.00 | 0.00 | Tie |
| Detect duplicate test req | Repeated Instruction | 0.00 | 0.00 | Tie |

**AutoClaude wins 6/8 scenarios.** The two ties are repeated-instruction detection, where neither arm flags the prompt as previously seen (this requires the MCP `search` tool, which `--print` mode doesn't invoke).

#### LLM-as-Judge Grading (Optional)

For richer evaluation across 5 dimensions (session awareness, factual accuracy, helpfulness, hallucination resistance, overall quality), enable the LLM-as-judge assertions:

1. Uncomment the `llm-rubric` blocks in `benchmarks/promptfooconfig.yaml`
2. Set your API key: `export ANTHROPIC_API_KEY=sk-ant-...`
3. Run: `npm run bench:e2e`

This uses Claude Sonnet as a grader with the seeded ground truth as reference. Results are cached on disk to avoid redundant API calls.

#### Filtering Scenarios

```bash
# Run a single scenario
npm run bench:e2e -- --filter-description "cont-1"

# Run multiple scenarios
npm run bench:e2e -- --filter-description "cont-1|know-1"
```

## Data Storage

All data is stored in `~/.autoclaude/memory.db` (SQLite with WAL mode). The database contains:

- **sessions** — Session records with summaries and utilization peaks
- **actions** — Granular tool-use log
- **decisions** — Architectural choices extracted from config edits and installs
- **learnings** — Error-to-fix patterns with relevance scores
- **snapshots** — Pre-compaction state captures
- **metrics** — Time-series utilization data
- **prompts** — User prompt history for repeated instruction detection
- **FTS5 indexes** — Full-text search across sessions, decisions, learnings, and prompts

## Troubleshooting

### Database locked errors

SQLite uses WAL mode for concurrent access, but simultaneous write operations from multiple processes can cause `SQLITE_BUSY` errors.

**Fix:** Ensure only one Claude Code session accesses the database at a time per project. If the error persists, close all sessions and delete the WAL file:

```bash
rm ~/.autoclaude/memory.db-wal ~/.autoclaude/memory.db-shm
```

### Hooks not firing

If AutoClaude hooks are not executing:

1. Verify the plugin is registered: `claude plugins list`
2. Re-register: `claude plugins add ./`
3. Check that the build output exists: `ls dist/cli/index.js`
4. Rebuild if needed: `npm run rebuild`
5. Check the log file for errors: `cat ~/.autoclaude/logs/autoclaude.log`

### MCP connection failures

If the MCP server is not responding:

1. Test the server manually: `node dist/mcp/index.js`
2. Verify the `.mcp.json` configuration points to the correct binary
3. Check that `better-sqlite3` native bindings match your Node version: `npm rebuild better-sqlite3`
4. Review logs: `tail -20 ~/.autoclaude/logs/autoclaude.log`

### Context injection not appearing

If session start context is not being injected:

1. Verify `injection.enabled` is `true` in config (default)
2. Check that previous sessions have summaries (summaries are generated at session end)
3. Ensure the project path matches between sessions (AutoClaude scopes data by `cwd`)
4. Increase `injection.maxTokens` if the token budget is too small
5. Check logs: `grep injector ~/.autoclaude/logs/autoclaude.log`

## Development

```bash
# TypeScript build (with type checking)
npm run build:tsc

# Production build (esbuild, fast)
npm run build

# Run tests (includes benchmarks)
npm test

# Lint
npm run lint

# Format code
npm run format

# Clean build output
npm run clean
```

### Project Structure

```
src/
├── cli/           # Hook handlers and CLI commands (13 modules)
│   ├── index.ts           # CLI router (stdin → handler → stdout)
│   ├── session-start.ts   # SessionStart hook: inject context, create session
│   ├── session-stop.ts    # Stop hook: summarize, extract learnings
│   ├── session-end.ts     # SessionEnd hook: finalize session record
│   ├── capture-action.ts  # PostToolUse hook: record actions, extract decisions
│   ├── user-prompt.ts     # UserPromptSubmit hook: log prompts, detect repeats
│   ├── pre-compact.ts     # PreCompact hook: save snapshot
│   ├── backup.ts          # Database backup command
│   ├── export.ts          # JSON export command
│   ├── gc.ts              # Garbage collection command
│   ├── query.ts           # Memory search command
│   └── stats.ts           # Metrics dashboard command
├── core/          # Core engine (7 modules)
│   ├── db.ts              # SQLite connection manager
│   ├── memory.ts          # Data access layer (18 public functions)
│   ├── injector.ts        # Context injection with token budget
│   ├── analyzer.ts        # Decision/learning extraction
│   ├── summarizer.ts      # Session summary generation
│   └── metrics.ts         # Context utilization tracking
├── mcp/           # MCP server (1 module)
│   └── index.ts           # 4 tools: search, record_decision, record_learning, metrics
└── util/          # Utilities (3 modules)
    ├── config.ts          # Configuration with validation
    ├── logger.ts          # Structured file-based logging
    └── tokens.ts          # Token estimation and truncation
tests/             # Test suite (19 files, 123 tests)
sql/               # Database schema (FTS5, triggers)
hooks/             # Hook registration (hooks.json)
skills/            # User-facing skills (status, recall, snapshot)
.claude-plugin/    # Plugin manifest
```

### Test Suite

123 tests across 38 suites, including 26 benchmark assertions. Uses Node.js built-in test runner with real SQLite databases (no mocks).

```bash
npm test   # Build + run all tests (~90ms)
```

## License

MIT
