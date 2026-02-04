# AutoClaude

A Claude Code plugin that gives Claude persistent memory across sessions. It automatically captures decisions, learnings, and session state — then injects the most relevant context when you start a new session.

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

## How It Works

AutoClaude is a **self-contained Claude Code plugin** — not a wrapper. It hooks into Claude Code's lifecycle events via the official plugin API, captures context in the background, and injects it transparently. No changed workflow, no separate process.

Three things get registered when you install:

1. **Hooks** — Run at lifecycle events (session start, tool use, compaction, session end)
2. **MCP Server** — Gives Claude tools to search and record memories
3. **Skills** — Slash commands (`/autoclaude:status`, `/autoclaude:recall`, `/autoclaude:snapshot`)

### What Gets Captured

| What | How |
|------|-----|
| **Architectural decisions** | Config file edits detected |
| **Library choices** | Package install commands parsed |
| **Learnings (gotchas)** | Error→fix sequences detected |
| **Session summaries** | Heuristic from action log |
| **Snapshots** | Captured before context compaction |
| **Prompts** | Logged with FTS5 indexing for similarity detection |

### What Gets Injected

The injector assembles context in priority order under a configurable token budget:

1. **Snapshot** (highest priority, only on resume/compact) — restores where you left off
2. **Active decisions** — architectural choices that haven't been superseded
3. **Top learnings** — gotchas and patterns ranked by relevance score
4. **Recent session summaries** — what happened in the last N sessions

## Usage

### Passive (Automatic)

Once installed, AutoClaude works automatically. Every session:

1. **Start** — Prior context injected, GC runs, session recorded
2. **During** — Tool calls captured, decisions extracted, prompts logged
3. **Compact** — Snapshot saved before context window compaction
4. **End** — Session summarized, learnings extracted from error→fix patterns

### Skills

| Command | Description |
|---------|-------------|
| `/autoclaude:status` | Dashboard with metrics, utilization, action breakdown |
| `/autoclaude:recall <query>` | Full-text search across all memories |
| `/autoclaude:snapshot` | Manually capture current state for later restoration |

### MCP Tools

| Tool | Description |
|------|-------------|
| `search` | Search sessions, decisions, learnings via FTS5 |
| `record_decision` | Explicitly record an architectural decision |
| `record_learning` | Explicitly record a gotcha, pattern, or insight |
| `metrics` | Query utilization and performance metrics |

### CLI Commands

```bash
node dist/cli/index.js backup   # Timestamped database backup
node dist/cli/index.js export   # Export all data as JSON
node dist/cli/index.js gc       # Run relevance decay and garbage collection
```

## Configuration

Create `~/.autoclaude/config.json` to customize. All fields are optional — missing fields use defaults.

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
  "decay": {
    "dailyRate": 0.05,
    "referenceBoost": 0.1,
    "gcThreshold": 0.1
  },
  "logging": {
    "level": "info",
    "file": "~/.autoclaude/logs/autoclaude.log"
  },
  "pruner": {
    "enabled": true,
    "url": "http://localhost:8000",
    "threshold": 0.5,
    "timeout": 5000,
    "adaptiveThreshold": true
  }
}
```

## SWE-Pruner Integration

AutoClaude optionally integrates with [SWE-Pruner](https://github.com/ayanami-kitasan/SWE-Pruner), a neural code pruning model that intelligently removes irrelevant code from context before injection. When available, it replaces simple truncation with semantic pruning — keeping the most relevant parts of large code blocks within the token budget.

### Setup

1. Install dependencies:
   ```bash
   pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu126
   ```

2. Clone and install SWE-Pruner:
   ```bash
   git clone https://github.com/ayanami-kitasan/SWE-Pruner.git
   cd SWE-Pruner
   pip3 install -e . --no-deps
   ```

3. Download the model:
   ```bash
   huggingface-cli download ayanami-kitasan/code-pruner --local-dir ./model
   ```

4. Start the server:
   ```bash
   python3 -m swe_pruner.online_serving --port 8000
   ```

AutoClaude checks the pruner's `/health` endpoint on each use and falls back to truncation if the server is unavailable. No configuration is required if the server runs on the default `http://localhost:8000`.

### Pruner Configuration

All pruner settings are optional in `~/.autoclaude/config.json`:

| Setting | Default | Description |
|---------|---------|-------------|
| `pruner.enabled` | `true` | Enable/disable pruner integration entirely |
| `pruner.url` | `http://localhost:8000` | URL of the SWE-Pruner FastAPI server |
| `pruner.threshold` | `0.5` | Base pruning threshold (0–1). Lower = more aggressive |
| `pruner.timeout` | `5000` | HTTP request timeout in milliseconds |
| `pruner.adaptiveThreshold` | `true` | Automatically lower threshold at high context utilization |

## Data Storage

All data lives in `~/.autoclaude/memory.db` (SQLite, WAL mode). Tables: sessions, actions, decisions, learnings, snapshots, metrics, prompts — with FTS5 indexes for full-text search.

## Troubleshooting

- **Hooks not firing:** Run `claude plugins list` to verify registration, then `claude plugins add ./` to re-register.
- **MCP failures:** Test with `node dist/mcp/index.js`, then `npm rebuild better-sqlite3` if native bindings are wrong.
- **No context injected:** Check that prior sessions have summaries (generated at session end) and the project path matches.

## Development

```bash
npm run build      # Production build (esbuild)
npm run build:tsc  # TypeScript with type checking
npm test           # Build + run all tests (includes benchmarks)
npm run lint       # ESLint
npm run format     # Prettier
```

## License

MIT
