---
description: "Backfill FOS analysis for prior Claude Code sessions"
---

You are helping the user backfill FOS comprehension analysis for past Claude Code sessions in this project.

The user ran `/comprehend backfill`. Execute this command:

## 1. Probe the discoverable sessions and cost

Default to model `claude-sonnet-4-6` and all discovered sessions unless the user specified otherwise in the command arguments.

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" backfill --show-preview \
  [--recent <N>] \
  [--model <model>]
```

Parse the JSON on stdout. Fields:

- `count` — number of sessions that would be backfilled
- `estimated_cost_usd_low` / `estimated_cost_usd_high` — cost range
- `resolved_project_hash` — may be `null` if Claude Code hasn't seen this project

## 2. Confirm with the user

- If `count === 0` or `resolved_project_hash === null`: tell the user there's nothing to backfill and stop.
- Otherwise call `AskUserQuestion` with these options (include `count` and cost range in the question):
  - `"Accept"` — proceed with these parameters
  - `"Choose a different model"` — ask for a model, re-run the preview
  - `"Choose a different count"` — ask for N, re-run the preview with `--recent N`
  - `"Decline"` — stop without running

Loop back to step 1 with the new parameters if the user picked a different model or count.

## 3. Execute on Accept

```bash
node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" backfill --yes \
  [--recent <N>] \
  --model <model>
```

Stream stdout to the user. Exit codes:

- **0** — complete; show the summary line.
- **1** — aborted; show stderr.
- **2** — cost-estimate step missing (shouldn't happen if you followed step 1).
- **3** — project not opted in; suggest `/comprehend init`.

**Never skip the preview step** — the AskUserQuestion confirmation is the user's chance to abort before cost is incurred.
