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

Format the summary as a JSON object with fields: session_id, current_task, progress_summary, open_questions, next_steps, working_files.

Then pipe it to the pre-compact handler:

```bash
echo '<your JSON summary>' | node ${PLUGIN_DIR}/dist/cli/index.js pre-compact
```

This saves a snapshot to the memory store that will be restored automatically on the next session start after compaction or resume.
