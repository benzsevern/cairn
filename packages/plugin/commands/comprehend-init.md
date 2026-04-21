---
description: Opt this project into FOS comprehension analysis.
---

You are helping the user opt a project into FOS comprehension analysis.

The user ran `/comprehend-fos:comprehend-init`.

To execute this command:

1. Bash-invoke `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --show-consent --project-root <cwd>`. Parse the returned JSON `{ install_ack, consent_exists, consent_required_text, estimated_cost_usd_low, estimated_cost_usd_high, backfill_count, project_root }`.

2. If `consent_exists: true`: the project is already opted in. Report the status and stop. Done.

3. If `install_ack: false` (user has not consented on this machine yet):
   a. Display the `consent_required_text` to the user as a plain assistant message.
   b. Use `AskUserQuestion` with three options:
      - "Accept and continue"
      - "Read the full data-flow doc first"
      - "Decline"
   c. If "Read doc": Bash `cat "${CLAUDE_PLUGIN_ROOT}/docs/user/data-flow.md"`, display the contents, then re-ask with "Accept and continue" / "Decline".
   d. If "Decline": exit, nothing written.
   e. If "Accept and continue": proceed to step 4 WITH the `--accept-machine-consent` flag.

4. Use `AskUserQuestion` to choose the project-level opt-in action:
   - "Accept, run backfill ($X–$Y for N prior sessions)"
   - "Accept, skip backfill"
   - "Decline"

5. Map the choice to the CLI:
   - Accept + backfill → `node bin.js init --accept [--accept-machine-consent if step 3 was reached]`
   - Accept + skip backfill → `node bin.js init --accept --skip-backfill [--accept-machine-consent]`
   - Decline → exit, nothing written.

6. Run via Bash, stream output.

Never bypass the CLI — all state mutations go through it.
