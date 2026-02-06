# AutoClaude

AutoClaude is a memory + token-minimization toolkit for coding agents.

- **Claude Code**: full plugin mode (hooks + slash skills + MCP).
- **Codex CLI**: MCP + Codex skill mode (no Claude lifecycle hooks required).

## Install for Codex

```bash
git clone https://github.com/BlaineHeffron/autoclaude.git
cd autoclaude
npm install
npm run install:codex
```

The installer:

1. Builds `dist/`
2. Installs skill `autoclaude-codex` into `~/.codex/skills/`
3. Registers MCP server `autoclaude-memory` via `codex mcp add`

Restart Codex after install so it loads the new skill.

## Install for Claude

### Marketplace

```bash
/plugin marketplace add BlaineHeffron/autoclaude
/plugin install autoclaude@autoclaude
```

### Source

```bash
git clone https://github.com/BlaineHeffron/autoclaude.git
cd autoclaude
npm install
npm run build
claude plugins add ./
```

## How It Works

### Shared Engine

Both Claude and Codex use the same backend:

- SQLite memory store (`~/.autoclaude/memory.db`)
- MCP server (`dist/mcp/index.js`)
- Relevance scoring/decay + search
- Neural/token-aware compression (`prune`, `compress`)

### Claude Mode

Claude uses plugin lifecycle hooks for automatic capture/injection:

- Session start injection
- Post-tool action capture
- Pre-compact snapshots
- Session-end summaries

### Codex Mode

Codex uses:

- MCP server tools for recall/compression/persistence
- Skill `autoclaude-codex` for workflow guidance

Codex does **not** have Claude's hook lifecycle, so automatic hook-based capture/injection is not used.

## Usage

### Codex

1. Start Codex in your project.
2. Invoke the skill by mentioning `$autoclaude-codex`.
3. Let Codex call MCP tools (`search`, `compress`, `prune`, `record_decision`, `record_learning`, `metrics`) as needed.

### Claude

AutoClaude runs passively after plugin install:

1. **Start**: context injected + GC run
2. **During**: tool actions captured
3. **Compact**: snapshot saved
4. **End**: summary + learnings persisted

Claude slash skills:

| Command | Description |
|---------|-------------|
| `/autoclaude:status` | Dashboard with metrics, utilization, action breakdown |
| `/autoclaude:recall <query>` | Full-text search across memories |
| `/autoclaude:snapshot` | Manually capture current state |

## MCP Tools

| Tool | Description |
|------|-------------|
| `search` | Search sessions, decisions, and learnings via FTS5 |
| `record_decision` | Persist an architectural or convention decision |
| `record_learning` | Persist a gotcha/pattern/insight |
| `prune` | Neural line-level pruning with SWE-Pruner |
| `compress` | Token compression (neural prune fallback to truncation) |
| `metrics` | Session/project utilization and performance metrics |

## CLI Commands

```bash
node dist/cli/index.js backup   # Timestamped database backup
node dist/cli/index.js export   # Export all data as JSON
node dist/cli/index.js gc       # Run relevance decay and garbage collection
```

## Configuration

Create `~/.autoclaude/config.json` (all fields optional):

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

AutoClaude can use [SWE-Pruner](https://github.com/ayanami-kitasan/SWE-Pruner) to prune irrelevant code before injection/compression.

```bash
pip3 install torch torchvision --index-url https://download.pytorch.org/whl/cu126
git clone https://github.com/ayanami-kitasan/SWE-Pruner.git
cd SWE-Pruner
pip3 install -e . --no-deps
huggingface-cli download ayanami-kitasan/code-pruner --local-dir ./model
python3 -m swe_pruner.online_serving --port 8000
```

## Uninstall from Codex

```bash
npm run uninstall:codex
```

## Troubleshooting

- **Codex skill missing**: rerun `npm run install:codex`, then restart Codex.
- **Codex MCP missing**: check with `codex mcp list`, reinstall if needed.
- **Claude hooks not firing**: run `claude plugins list`, then `claude plugins add ./`.
- **MCP startup issues**: test with `node dist/mcp/index.js`, then `npm rebuild better-sqlite3`.

## Development

```bash
npm run build
npm run build:tsc
npm test
npm run lint
npm run format
```

## License

MIT
