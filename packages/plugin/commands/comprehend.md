---
description: "Analyze the current Claude Code session transcript"
---

You are helping the user analyze a Claude Code session transcript with the FOS plugin.

The user ran `/comprehend`. Execute this command by following these steps **in order**:

## 1. Identify the target session

Claude Code exposes the current session's `transcript_path` and `session_id` via the hook-payload context. Capture both from the session context.

- If the user passed a session identifier as the command argument, use that as `--session-id` and leave `--transcript-path` empty.
- Otherwise, pass the current session's `transcript_path` **and** `session_id` explicitly to the CLI.

## 2. (Optional) Confirm re-analysis

If you already know a session file exists for this session (from a prior `/comprehend status` or user mention), call `AskUserQuestion` with options:

- `"Re-analyze"` → pass `--force`
- `"Skip"` → do nothing, report the existing file.

Otherwise, skip this step — the CLI reports the already-analyzed case itself.

## 3. Invoke the CLI synchronously

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" analyze \
  --transcript-path "<path>" \
  --session-id "<id>" \
  [--force]
```

The command is synchronous — the user is at the keyboard.

## 4. Interpret the exit code

- **Exit 0** — print stdout (the analyzed-session summary).
- **Exit 1** — analysis failed; print stderr.
- **Exit 3** — project not opted in. Suggest `/comprehend init`.
- **Exit 4** — analysis lock held (a Stop-hook worker is running). Tell the user analysis is already running in the background; suggest `/comprehend status`.

**Never bypass the CLI** — all analysis runs through `bin.js analyze`.
