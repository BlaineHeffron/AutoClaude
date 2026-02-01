---
name: recall
description: Search past sessions and decisions for relevant context
argument-hint: "[search query]"
user-invocable: true
disable-model-invocation: false
allowed-tools: "Bash"
---

Search the autoclaude memory store for: $ARGUMENTS

Run `node ${PLUGIN_DIR}/dist/cli/index.js query "$ARGUMENTS"` and present the results
in a structured format showing sessions, decisions, and learnings that match.
