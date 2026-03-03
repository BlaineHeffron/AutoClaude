# AutoClaude

AutoClaude is a context-management toolkit for coding agents.

- **Claude Code**: full plugin mode (hooks + slash skills + MCP).
- **Codex CLI**: native memory is built in, so AutoClaude no longer installs a separate Codex memory layer.

## Codex Cleanup

```bash
git clone https://github.com/BlaineHeffron/autoclaude.git
cd autoclaude
npm install
npm run install:codex
```

`install:codex` now removes the legacy AutoClaude Codex skill and `autoclaude-memory`
MCP entry. Codex has native memory support, so AutoClaude only provides a cleanup path
for older installs.

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

### Claude Engine

Claude uses AutoClaude's backend for structured context capture and retrieval:

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

Codex uses its own native memory. AutoClaude does not install a separate Codex skill
or MCP server anymore.

## Usage

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

## Remove Legacy Codex Integration

```bash
npm run uninstall:codex
```

## Troubleshooting

- **Codex still shows `autoclaude-memory`**: run `npm run install:codex` or `npm run uninstall:codex`, then restart Codex.
- **Claude hooks not firing**: run `claude plugins list`, then `claude plugins add ./`.
- **MCP startup issues**: test with `node dist/mcp/index.js`, then `npm rebuild better-sqlite3`.

## Development

```bash
npm run build
npm run build:tsc
npm test
npm run lint
npm run format
npm run install:codex                         # remove legacy Codex MCP/skill wiring
```

## License

MIT
