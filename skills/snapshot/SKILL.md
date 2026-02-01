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

Then run `node ${PLUGIN_DIR}/dist/cli/index.js pre-compact` with this summary piped to stdin as JSON.
