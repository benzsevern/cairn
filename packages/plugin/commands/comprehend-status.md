---
description: "Show FOS analysis status for this project"
---

You are helping the user inspect FOS analysis state for the current project.

The user ran `/comprehend status`. Execute this command:

## 1. Invoke the CLI

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" status
```

If the user passed `--ack` as an argument, append it:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" status --ack
```

## 2. Present the output

- On **exit 0**: render the human-readable stdout faithfully to the user. Do not rewrap or re-interpret.
- On **exit 3**: tell the user the project isn't opted in and suggest running `/comprehend init`.

If the user invoked with `--ack`, add a brief confirmation: "Failures acknowledged."

## 3. When to request JSON

If the user asks for a structured view, or you need to drive follow-up actions (e.g. "which sessions failed?"), re-invoke with `--json`:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" status --json
```

Parse the JSON and answer the user's specific question rather than dumping the whole payload.

**Never read or write FOS state files directly** — always go through the CLI.
