# AutoClaude

Automated context management across Claude Code sessions. Captures session state, persists decisions and learnings, injects relevant context on session start, and monitors context utilization.

## Features

- **Session Capture** — Automatically records tool use, file edits, test runs, and builds via Claude Code hooks
- **Context Injection** — Injects relevant past context (recent sessions, decisions, learnings, snapshots) at session start
- **Memory Intelligence** — Extracts architectural decisions from config file edits and library installs; learns from error-to-fix sequences
- **Utilization Monitoring** — Tracks context window usage and warns when approaching capacity
- **Relevance Decay** — Automatically decays old learnings so only useful knowledge persists
- **Full-Text Search** — FTS5-powered search across all sessions, decisions, and learnings
- **MCP Server** — Exposes memory query tools for Claude to search past context

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
│  - analyzer  │ │  - search    │ │  - /status   │
│  - summarizer│ │  - recall    │ │  - /recall   │
│  - injector  │ │  - metrics   │ │  - /snapshot │
│  - metrics   │ │              │ │              │
└──────┬───────┘ └──────┬───────┘ └──────────────┘
       │                │
       ▼                ▼
┌─────────────────────────────────────────────────────┐
│           SQLite Memory Store (~/.autoclaude/)       │
│  sessions │ actions │ decisions │ learnings │ FTS5   │
└─────────────────────────────────────────────────────┘
```

## Installation

```bash
# Clone the repository
git clone https://github.com/blaine/autoclaude.git
cd autoclaude

# Install dependencies
npm install

# Build (production bundle via esbuild)
npm run build

# Or use TypeScript compiler for development
npm run build:tsc
```

## Plugin Registration

Register AutoClaude as a Claude Code plugin:

```bash
claude plugins add ./
```

This registers the hooks, MCP server, and skills defined in `.claude-plugin/plugin.json`.

## How It Works

AutoClaude hooks into six Claude Code lifecycle events:

| Event | Handler | What it does |
|-------|---------|-------------|
| `SessionStart` | `session-start` | Creates session record, injects past context, runs GC |
| `UserPromptSubmit` | `user-prompt` | Logs prompts, detects repeated instructions |
| `PostToolUse` | `capture-action` | Records tool calls, extracts decisions |
| `PreCompact` | `pre-compact` | Saves snapshot before context compaction |
| `Stop` | `session-stop` | Generates summary, extracts learnings |
| `SessionEnd` | `session-end` | Ensures session record is complete |

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

## Skills

AutoClaude provides three user-facing skills:

### `/autoclaude:status`

Displays a live dashboard with session metrics, context utilization, action breakdown, and project-level statistics.

### `/autoclaude:recall <query>`

Searches past sessions, decisions, and learnings using full-text search. Returns ranked results with snippets.

### `/autoclaude:snapshot`

Manually captures the current session state (task, progress, files, next steps) for later restoration.

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

## Development

```bash
# TypeScript build (with type checking)
npm run build:tsc

# Production build (esbuild, fast)
npm run build

# Run tests
npm test

# Clean build output
npm run clean
```

## License

MIT
