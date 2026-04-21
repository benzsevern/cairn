---
description: Re-derive the comprehension graph; optionally re-analyze one or all sessions.
---

You are helping the user re-derive or re-analyze their FOS comprehension graph.

The user ran `/comprehend-fos:comprehend-rerun` [optional session id].

To execute this command:

1. Bash-invoke `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" rerun --show-preview [--session <id>]` if the user passed a session id; otherwise `--show-preview --all` for the aggregate view. Parse the returned JSON `{ mode, count, estimated_cost_usd_low, estimated_cost_usd_high, refiner_version_current, refiner_version_on_sessions }`.

2. If exit code is 3: the project isn't opted in. Tell the user to run `/comprehend-fos:comprehend-init` and stop.

3. Use `AskUserQuestion` to pick a mode. Label the options with their actual costs from the preview:
   - "Rebuild only (no refiner calls, ~instant)"
   - If a session id was passed: "Re-analyze this session (~$X)"
   - "Re-analyze all N sessions (~$X–$Y)"
   - "Cancel"

4. Map the choice to a CLI invocation:
   - Rebuild → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" rerun`
   - Single → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" rerun <session-id>`
   - All → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" rerun --all --force`
     (the markdown already confirmed with AskUserQuestion, so --force is appropriate to skip the CLI's built-in confirmation)

5. Run the chosen command via Bash. Stream output.

6. On exit code 4 ("lock held"): tell the user analysis is running in background, suggest `/comprehend-fos:comprehend-status`.

Never bypass the CLI — all state mutations go through it.
