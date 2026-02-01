---
name: status
description: Show current session context utilization and memory stats
user-invocable: true
disable-model-invocation: true
allowed-tools: "Bash"
---

Run `node ${PLUGIN_DIR}/dist/cli/index.js stats` and display the results.
Show: current session token usage, context utilization %, active decisions count,
recent learnings count, and recommendation (compact now / continue / review decisions).
