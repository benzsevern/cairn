---
description: "Opt this project into FOS comprehension analysis"
---

You are helping the user opt their current project into the FOS comprehension plugin.

The user ran `/comprehend init`. Execute this command by following these steps **in order**:

## 1. Probe current state

Run via Bash:

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --show-consent
```

Parse the single-line JSON on stdout. Fields:

- `install_ack` (boolean) — whether `~/.claude/fos-install-ack` exists
- `consent_exists` (boolean) — whether this project already opted in
- `backfill_count` (number) — prior sessions discovered for this project
- `estimated_cost_usd_low` / `estimated_cost_usd_high` — backfill cost range
- `project_root` — resolved absolute path

## 2. Decide based on probe output

**If `install_ack === false`:** tell the user the plugin install acknowledgment is missing, point them at the install script, and stop. Do **not** run `--accept`.

**If `consent_exists === true`:** report that the project is already opted in (print `project_root`) and stop. This is the idempotent path.

**Otherwise:** ask the user to choose an option via `AskUserQuestion` with these three options:

- `"Accept"` — opt in and run the backfill (cost range from the probe)
- `"Accept, skip backfill"` — opt in, no backfill now
- `"Decline"` — do nothing

Include the `backfill_count` and cost range in the question so the user has context.

## 3. Execute the choice

- **Accept** → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --accept`
- **Accept, skip backfill** → `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --accept --skip-backfill`
- **Decline** → print a brief acknowledgment; do nothing.

Report stdout verbatim to the user. If the CLI exits non-zero, surface the stderr message.

**Never bypass the CLI** — all consent and scaffolding happens through `bin.js init`.
