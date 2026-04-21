# FOS — Plugin Layer (Plan 2) — Design

**Status:** Approved (brainstorming phase) — ready for implementation planning
**Date:** 2026-04-20
**Author:** brainstormed with Claude Opus 4.7 (1M context)
**Next step:** implementation plan via `superpowers:writing-plans`
**Depends on:** Plan 1 (`@fos/core`, merged on `main` as of `06b7015`)

---

## 0. Context

This is the Plan 2 scope of the broader FOS vision. Plan 1 shipped `@fos/core` — the engine library + CLI — and is live on `main`. Plan 2 wraps that engine in a Claude Code plugin so analysis happens **passively** at the end of every session instead of requiring the user to run `fos analyze` manually.

Plan 3 (deferred) expands the golden corpus, hits the main spec's §8.2 quality bars, and handles marketplace publication.

The core bet for Plan 2: **if the install-once / opt-in-per-project experience works smoothly, the plugin is genuinely invisible until it has something useful to say.** Everything else in this spec serves that bet.

---

## 1. Product Shape

A self-contained Claude Code plugin that installs `@fos/core` behavior into the user's Claude Code harness. Sits dormant until a project opts in via `/comprehend init`; then passively analyzes sessions via a detached Stop hook and surfaces status/errors on SessionStart.

**Locked decisions** (from the brainstorming session):

| Decision | Choice |
|---|---|
| Command set in Plan 2 | Core trio: `/comprehend`, `/comprehend status`, `/comprehend backfill` — plus `/comprehend init` for opt-in. `/comprehend rerun` deferred to Plan 3. |
| Stop hook execution | Detached subprocess + per-project file lock. Claude Code never waits on analysis. |
| Consent UX | Install-time informational acknowledgment AND per-project opt-in via `/comprehend init`. Plugin inert by default on every repo. |
| SessionStart hook | Ship a minimal-actionable variant: speaks only when there's pending work, a failed prior analysis, or a first-session-after-opt-in. Silent otherwise. |
| `@fos/core` consumption | Bundled into `@fos/plugin`'s `dist/` via tsup. Zero runtime npm deps. |

**What ships in Plan 2:**

- `packages/plugin/` — a Claude Code plugin directory installable via `claude plugins install file:./packages/plugin`.
- `Stop` hook — detached-subprocess analysis with per-project file lock; async from Claude Code's perspective.
- `SessionStart` hook — minimal-actionable summary (only speaks when something needs attention).
- `/comprehend init` — per-project opt-in with optional backfill wizard.
- `/comprehend` — on-demand re-analyze the current session with cost preview.
- `/comprehend status` — pending / running / recent-failure / last-rebuild state.
- `/comprehend backfill` — interactive backfill wizard.
- `@fos/core` bundled into the plugin's dist via tsup.

**What is NOT in Plan 2:**

- `/comprehend rerun` — Plan 3 (only useful once the refiner prompt starts iterating).
- Marketplace publication — Plan 3.
- Live web UI / fog-of-war / terminal injection / fractal fan-out — Plan vNext+ (main spec §6 non-goals).
- Privacy-preserving modes, multi-project dashboards.

---

## 2. Architecture & Components

> **Post-probe revision:** This section was substantially revised after the Phase 0 probe established that (a) Claude Code slash commands are markdown prompt templates loaded as LLM instructions, not executable scripts, and (b) plugin manifests live at `.claude-plugin/plugin.json`, not the root. See `docs/superpowers/plans/2026-04-21-fos-v2-plugin-probe-findings.md` for the empirical ground truth this section is built on.

### 2.1 New repo artifact

```
packages/plugin/
├── package.json                    # @fos/plugin, type: module
├── tsconfig.json
├── tsup.config.ts                  # bundles @fos/core + deps inline
├── README.md
├── .claude-plugin/
│   ├── plugin.json                 # Claude Code plugin manifest
│   └── marketplace.json            # self-wrapper for local install flow
├── commands/                       # LLM prompt templates (NOT compiled)
│   ├── comprehend.md
│   ├── comprehend-init.md
│   ├── comprehend-status.md
│   └── comprehend-backfill.md
├── hooks/
│   └── hooks.json                  # Claude Code hook-config manifest
├── install/
│   └── post-install.js             # install-time consent + install-ack
├── src/
│   ├── hooks/
│   │   ├── stop.ts                 # compiles to dist/hooks/stop.js
│   │   └── session-start.ts
│   ├── cli/
│   │   ├── bin.ts                  # single CLI entry — dist/cli/bin.js
│   │   └── commands/
│   │       ├── comprehend.ts       # subcommand implementations imported by bin.ts
│   │       ├── comprehend-init.ts
│   │       ├── comprehend-status.ts
│   │       └── comprehend-backfill.ts
│   ├── worker/
│   │   └── analyze-worker.ts       # detached subprocess entry
│   ├── lock.ts                     # per-project analysis.lock helpers
│   ├── log.ts                      # structured log writer
│   ├── consent.ts                  # install-ack + per-project consent record
│   ├── discover-project.ts         # project-root + Claude Code session-id resolution
│   └── plugin-paths.ts             # barrel re-exporting @fos/core's path helpers
└── tests/
    ├── unit/
    │   ├── {lock,log,consent,discover-project,plugin-paths}.test.ts
    ├── hooks/{stop,session-start}.test.ts
    ├── cli/commands/{comprehend-init,comprehend-status,comprehend-backfill}.test.ts
    └── integration/{plugin-smoke,worker-chain}.test.ts
```

**Key distinction from the pre-probe draft:**

- **Commands are `.md` files**, not `.ts` files. They live at `commands/<name>.md` (NOT inside `src/`). They are not compiled. At plugin-install time they are copied as-is into the plugin cache; at `/comprehend-name` invocation Claude Code loads their contents as LLM instructions.
- **Imperative logic lives in the CLI** at `src/cli/` (compiled to `dist/cli/bin.js`). The bin receives subcommand names as argv and dispatches to the `src/cli/commands/*.ts` implementations. Each markdown template tells Claude to invoke `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" <subcommand> <args>` via the Bash tool.
- **Interactive input** (e.g., consent confirmation, backfill cost approval) is not readline. The markdown template tells Claude to use the `AskUserQuestion` LLM tool; then the accept/reject choice is passed as a CLI flag.

### 2.2 Bundling model

`@fos/plugin` has `"@fos/core": "workspace:*"` as a dev-time dep for type inference. tsup is configured to **inline** `@fos/core` + its runtime deps (`zod`, `gray-matter`, `execa`, `commander`, plus the `cytoscape` template bundle from the viewer) into each entry file. Resulting `dist/` is fully self-contained — no `node_modules` lookup at runtime.

tsup has **four entries** (not seven):

1. `src/hooks/stop.ts` → `dist/hooks/stop.js`
2. `src/hooks/session-start.ts` → `dist/hooks/session-start.js`
3. `src/cli/bin.ts` → `dist/cli/bin.js` (imports and dispatches the subcommands; all bundled in)
4. `src/worker/analyze-worker.ts` → `dist/worker/analyze-worker.js`

The refiner prompt markdown file (`refiner-v1.md`) and the viewer's bundled template are copied from `@fos/core`'s shipped `prompts/` and `dist/viewer/` into the plugin's `dist/` via tsup's `onSuccess` hook. The walking-`package.json` resolver in `@fos/core`'s `load-prompt.ts` still works because `@fos/plugin/package.json` provides the anchor at the plugin's install location. `${CLAUDE_PLUGIN_ROOT}` from Claude Code's hook env points at the installed plugin root, so `${CLAUDE_PLUGIN_ROOT}/dist/prompts/refiner-v1.md` resolves correctly post-install.

### 2.3 Entry points

Three kinds of entries:

**Hooks** (declarative, referenced in `hooks/hooks.json`):

- `dist/hooks/stop.js` — receives Claude Code's Stop hook payload on stdin (JSON with `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`). Validates opt-in, acquires lock or queues to pending, spawns the worker detached, returns exit 0 immediately (< 500 ms). Writes JSON response to stdout if needed.
- `dist/hooks/session-start.js` — receives SessionStart payload on stdin. Reads logs + pending queue + manifest; emits at most one message via the stdout response JSON (`{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"…"}}`).

**CLI** (imperative, invoked by command markdown via Bash):

- `dist/cli/bin.js` — single binary exposing `init`, `analyze`, `rebuild`, `backfill`, `status` subcommands. The commander-style args match what the command markdown invokes. Error handling and exit codes are the contract the markdown templates document.

**Worker** (detached subprocess, spawned by the Stop hook):

- `dist/worker/analyze-worker.js` — runs `analyzeSession` then `rebuildProjectView`, writes structured logs, releases the lock, drains one pending queue item by self-chaining a fresh worker, exits.

**Commands** (LLM prompt templates, NOT compiled):

- `commands/*.md` — short markdown files with optional YAML frontmatter. They describe (for the LLM) how to accomplish each user-facing command, referencing the CLI via `${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js` and the `AskUserQuestion` tool for interactivity.

### 2.4 Boundaries

- The plugin **never reaches into `@fos/core` internals** — only its public API (`analyzeSession`, `rebuildProjectView`, `backfill`, `loadRefinerPrompt`, `VERSION`, plus the types).
- The plugin **never duplicates logic** from `@fos/core`. Paths come from `core`'s `paths.ts`; manifest read/write from `core`'s `writer/manifest.ts`. Plugin contributes only plugin-specific logic: hooks, locks, logs, consent, project discovery, command markdown.
- `plugin.json` and `hooks/hooks.json` are **static** and declare all hooks + command auto-discovery at install time. No dynamic registration. `commands/` is auto-discovered by Claude Code's default.
- Command markdown files **only drive the CLI**. They never contain executable code; they contain directives for Claude.
- The CLI **is the single imperative surface**. All state mutations (consent, init, analyze, rebuild, backfill, status) go through it.

---

## 3. Data Model

New files the plugin manages under `.comprehension/.fos/`:

### 3.1 `consent.json` — per-project opt-in record

```json
{
  "opted_in_at": "2026-04-23T10:15:00Z",
  "acknowledged_install": true,
  "scope": "this-project"
}
```

Presence of this file = "project is opted in." Missing = Stop and SessionStart exit silently.

### 3.2 `analysis.lock` — per-project serialization primitive

```json
{
  "pid": 12345,
  "acquired_at": "2026-04-23T10:17:32Z",
  "session_id": "sess-abc"
}
```

Acquired non-blocking by the Stop hook before detaching a worker. Released by the worker after analysis completes (or the Stop hook if the detach itself fails). Staleness rule: lock older than 30 minutes whose `pid` no longer exists is reclaimed by the next Stop hook.

### 3.3 `pending.json` — queued sessions

```json
{
  "queue": [
    { "session_id": "sess-xyz", "transcript_path": "...", "queued_at": "..." }
  ]
}
```

Used when the lock is held. Each worker drains one entry at the end of its run by self-chaining a fresh worker — keeps memory pressure bounded and allows the OS to schedule normally.

### 3.4 `logs/<session-id>.log` — structured worker log

Newline-delimited JSON. Events: `spawned_at`, `worker_started`, `worker_success`, `worker_failure`. `/comprehend status` reads these.

### 3.5 `acked_at` — failure-banner acknowledgment

Empty marker file touched by `/comprehend status --ack`. SessionStart compares failure-log timestamps against this file's **mtime** (not its contents, which stay empty). A failure log with `timestamp > acked_at.mtime` is considered un-acknowledged and triggers the banner.

### 3.6 Existing state (from Plan 1, not new in Plan 2)

- `.comprehension/manifest.json` — project-level metadata (unchanged).
- `.comprehension/sessions/*.md` — session artifacts (unchanged).
- `.comprehension/sessions/<date>-<id>.failed.json` — already written by `@fos/core` on refiner failure (Plan 2's `/comprehend status` surfaces them).
- `.comprehension/concepts/*.md`, `graph.json`, `graph.html` — derived view (unchanged).

### 3.7 Machine-wide install acknowledgment

`~/.claude/fos-install-ack` — empty marker file touched by the plugin's post-install step. `/comprehend init` (via its CLI subcommand) checks for its existence before allowing per-project opt-in.

### 3.8 `.claude-plugin/marketplace.json` — self-wrapper for local install

Claude Code's plugin installation flow is marketplace-first: `claude plugins install <name>` requires a marketplace to be registered. For local development and internal distribution before Plan 3's publication, the plugin ships a minimal marketplace manifest that wraps itself:

```json
{
  "name": "fos-dev",
  "owner": { "name": "FOS" },
  "plugins": [
    {
      "name": "comprehend-fos",
      "source": { "source": "./", "type": "local" },
      "description": "Passive comprehension layer for Claude Code sessions"
    }
  ]
}
```

The exact field names come from the Phase 0 probe; the shape above is the validated form. Developers install the plugin locally via:

```
claude plugins marketplace add ./packages/plugin
claude plugins install comprehend-fos@fos-dev
```

A `pnpm install-plugin-local` script in `@fos/plugin`'s `package.json` wraps these two steps.

---

## 4. Lifecycle Flows

### 4.1 Install (one-time, per machine)

Two steps (no `file:` shortcut exists — confirmed by Phase 0 probe):

```
claude plugins marketplace add ./packages/plugin     # registers the self-wrapper
claude plugins install comprehend-fos@fos-dev         # copies plugin to ~/.claude/plugins/cache/
```

On install:

1. Plugin directory is copied to `~/.claude/plugins/cache/fos-dev/comprehend-fos/<version>/`.
2. Post-install step (`install/post-install.js`) runs: prints data-flow consent text, offers `Press Enter to acknowledge` when stdin is TTY, touches `~/.claude/fos-install-ack`.
3. Hooks (from `hooks/hooks.json`) and commands (from `commands/*.md`) are registered per the manifest.

Plugin is now installed but inert. Nothing analyzes anything until a project opts in.

### 4.2 Per-project opt-in (`/comprehend init`)

Three layers: the markdown prompt template, the LLM execution, and the CLI subcommand.

**Markdown template** (`commands/comprehend-init.md`) instructs Claude to:

1. Run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --show-consent` via Bash to probe install-ack status and compute the backfill cost estimate.
2. If the `--show-consent` output indicates install-ack is missing → print the error + exit.
3. If the project is already opted in → report current status + exit.
4. Otherwise use `AskUserQuestion` to present the user with a multi-choice question: *"Opt this project in for automatic analysis? Estimated backfill cost: $X–$Y on claude-sonnet-4-6."* Options: `"Accept"`, `"Accept, skip backfill"`, `"Decline"`.
5. Based on the answer, run `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --accept [--skip-backfill]` via Bash (or exit silently on decline).

**CLI subcommand** (`dist/cli/bin.js init`):

- `--show-consent` flag: print a JSON document `{install_ack, consent_exists, estimated_cost_usd_low, estimated_cost_usd_high, backfill_count}` and exit 0. Read-only probe.
- `--accept` flag: delegate to `@fos/core.runInit` to create `.comprehension/`, write `consent.json`, run the backfill wizard unless `--skip-backfill`.
- Without `--accept` and without `--show-consent`: print usage + exit 1 (the markdown is expected to always pass one of the two).

This split keeps the LLM-facing interaction (AskUserQuestion) in the markdown and all state mutation in the CLI.

### 4.3 Stop hook (per session end)

The hook runs for every Claude Code session regardless of project (user-level registration). It self-gates:

1. Parse hook-event payload → `session_id`, `transcript_path`, `cwd`.
2. `project_root = discoverProjectRoot(cwd)` (git-root-or-cwd heuristic).
3. If `.comprehension/.fos/consent.json` does NOT exist → exit 0 silently.
4. Acquire `.fos/analysis.lock` non-blocking.
   - Acquired: proceed.
   - Not acquired: append `{session_id, transcript_path, queued_at}` to `pending.json`; exit 0.
5. Spawn the worker detached:
   ```
   spawn('node', ['<plugin_dist>/worker/analyze-worker.js', project_root, transcript_path, session_id],
         { detached: true, stdio: 'ignore', windowsHide: true }).unref()
   ```
6. Write a `spawned_at` event to `logs/<session_id>.log`.
7. Return exit 0. Claude Code moves on.

### 4.4 Worker (detached subprocess)

1. Open the log file for this session.
2. Log `worker_started`.
3. `try`: `await analyzeSession({...})` then `await rebuildProjectView({...})`. Log `worker_success` with concept/unknown counts + elapsed.
4. `catch`: log `worker_failure` with error name + message + elapsed.
5. Release the lock.
6. If `pending.json.queue` is non-empty: pop the first entry, write it back, spawn a fresh worker for it. Do NOT recurse — a fresh process is what we want.
7. Exit 0.

### 4.5 SessionStart hook (minimal-actionable)

1. `project_root = discoverProjectRoot(cwd)`.
2. If no `consent.json` → exit 0 silently.
3. Gather state: `running` (lock exists), `pending` (queue length), `last_log` (most recent log file), `failure_seen` (failures after `acked_at`), `first_session` (no session files yet), `stalled_detach` (`spawned_at` > 5 min ago with no `worker_started`).
4. Pick at most one message:
   - `failure_seen`: "⚠ Last FOS analysis failed — run `/comprehend status` to see why."
   - `stalled_detach`: "⚠ FOS worker appears stalled — run `/comprehend status`."
   - `pending > 0`: "FOS: {pending} session(s) queued, analysis running in background."
   - `first_session`: "FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop."
   - `running` (and none of the above): "FOS: background analysis running for {since}s."
   - else: silent.
5. Emit the message (if any) to stdout.

### 4.6 Error-recovery surfaces

The detached worker cannot notify the user directly. Its only channels are:

1. Log files at `logs/<session_id>.log` (structured, read by `/comprehend status`).
2. Pending queue at `pending.json` (sessions waiting for the lock).
3. `.comprehension/sessions/<date>-<id>.failed.json` stubs (already written by `@fos/core`).

SessionStart aggregates (1), (2), (3) into a single actionable line.

---

## 5. Command Contracts

Every command is a pair: a `.md` prompt template (what Claude sees when the user types the slash command) and a CLI subcommand (the imperative work).

### 5.1 `/comprehend init`

**Markdown** (`commands/comprehend-init.md`): tells Claude to probe via `bin.js init --show-consent`, use `AskUserQuestion` for the accept/decline/skip-backfill choice, then execute via `bin.js init --accept [--skip-backfill]` or exit. See §4.2 for the full flow.

**CLI** (`bin.js init`):
```
Usage: bin.js init [--show-consent] [--accept] [--skip-backfill]

Flags:
  --show-consent    Print JSON probe {install_ack, consent_exists,
                    estimated_cost_usd_low, estimated_cost_usd_high,
                    backfill_count} and exit 0.
  --accept          Opt this project in (idempotent). Writes consent.json.
  --skip-backfill   With --accept: skip the backfill wizard.
```

- **Exit 0** on successful opt-in (or idempotent reuse, or `--show-consent`).
- **Exit 1** if `~/.claude/fos-install-ack` is missing (with `--accept`).

### 5.2 `/comprehend`

**Markdown** (`commands/comprehend.md`): tells Claude to check the project is opted in (via the CLI), optionally ask the user to confirm re-analyzing an existing session (`AskUserQuestion` only if the session already has an analysis on disk), then invoke `bin.js analyze` synchronously and show the summary to the user.

**CLI** (`bin.js analyze`):
```
Usage: bin.js analyze [<session_id>] [--dry-run] [--force] [--transcript-path <path>]

Args:
  session_id            Session to re-analyze. Optional; derivable from transcript path.

Flags:
  --transcript-path     Explicit JSONL path. Markdown extracts this from the
                        current Claude Code session's transcript_path hook-payload
                        field when available.
  --dry-run             Show cost estimate + existing state; don't invoke the refiner.
  --force               Re-analyze even if the session already has a session file.
```

- **Synchronous** (user is at the keyboard). No detach. Fails fast if the lock is held.
- **Exit 0** on success, **1** on refiner failure, **3** if the project isn't opted in, **4** if the lock is held (print a message pointing at `/comprehend status`).

### 5.3 `/comprehend status`

**Markdown** (`commands/comprehend-status.md`): tells Claude to run `bin.js status [--ack]` via Bash, render its stdout faithfully to the user, and note if `--ack` was used.

**CLI** (`bin.js status`):
```
Usage: bin.js status [--ack] [--json]

Flags:
  --ack    Mark all current failures as acknowledged; dismisses the
           SessionStart banner until a new failure occurs.
  --json   Emit machine-readable JSON instead of the human-readable output.
```

- Output lists project root, refiner version + hash, counts (analyzed / failed / queued / running), last rebuild time + `project_view_version`, and the last 3 worker runs with outcomes.
- **Exit 0** always (informational).

### 5.4 `/comprehend backfill`

**Markdown** (`commands/comprehend-backfill.md`): tells Claude to (1) probe via `bin.js backfill --show-preview --recent N --model M` to get the count + cost estimate, (2) use `AskUserQuestion` to confirm with the user, (3) run `bin.js backfill --yes [...]` on acceptance.

**CLI** (`bin.js backfill`):
```
Usage: bin.js backfill [--show-preview] [--project-hash <hash>]
                       [--recent <N>] [--yes] [--model <model>]

Flags:
  --show-preview   Emit JSON {count, estimated_cost_usd_low,
                   estimated_cost_usd_high, resolved_project_hash} and exit 0.
  --yes            Skip interactive confirmation (markdown-driven confirm lives
                   in AskUserQuestion, not readline).
```

- Auto-derives `--project-hash` if missing (scans `~/.claude/projects/` for matching `cwd`).
- Acquires the project-level lock for the entire backfill run so it doesn't race with concurrent Stop hooks.
- Each backfilled session gets a log entry.
- **Exit 0** on completion, **1** on aborted, **2** on cost-estimate declined, **3** if project isn't opted in.

### 5.5 Cross-command conventions

- Every CLI subcommand first checks opt-in; exits 3 with a helpful message if missing (except `init` itself and `status`).
- Every subcommand routes errors through `log.ts` so `/comprehend status` surfaces them.
- Every subcommand uses `@fos/core`'s path helpers.
- Exit codes are documented and stable.
- Markdown templates always pass the current session's `transcript_path` + `session_id` explicitly when Claude has them (from the hook payload context) rather than relying on the CLI to discover them.

---

## 6. Non-Goals (Plan 2)

- **`/comprehend rerun`** — Plan 3 (prompt iteration creates the reason to rerun).
- **Marketplace publication** — Plan 3.
- **Live web UI with fog-of-war** — Plan vNext.
- **Terminal injection / fractal fan-out** — later phases per main spec §6.
- **Privacy-preserving modes** (local model, redaction).
- **Multi-project dashboard** — each project is self-contained.
- **Semantic embeddings** — deferred indefinitely per main spec §6.
- **Plugin auto-update** — rely on the Claude Code plugin system's mechanism.
- **Per-project refiner override UI** — CLI-level via `.fos/refiner-prompt.md` already works from Plan 1.
- **Cross-platform shell-specific tooling** — Node subprocess + file I/O only; no shell scripts.

---

## 7. Risks & Open Questions

### 7.1 High-severity

**Claude Code plugin format is an under-documented moving target.** `plugin.json` schema, available hook events, command registration, and runtime APIs aren't fully documented across Claude Code versions.
*Mitigation:* Phase 0 of the implementation plan builds a minimal hello-world plugin and verifies the install+hook+command path end-to-end before porting the real logic.

**Detached subprocess on Windows.** `spawn` with `detached: true` + `stdio: 'ignore'` + `.unref()` is documented to work, but path-argument mangling can silently break the detach.
*Mitigation:* Stop hook writes `spawned_at` to the log file before detaching. Worker's first action is `worker_started`. A missing `worker_started` after 5 minutes → SessionStart flags the session as stalled.

### 7.2 Medium-severity

**Lock file staleness after crash.** Worker dies → lock persists → project goes silent.
*Mitigation:* lock record contains `{pid, acquired_at}`. Stop hooks that see a lock older than 30 minutes AND whose `pid` is gone reclaim it.

**Bundling drift between `@fos/core` CLI (via npm) and `@fos/plugin`'s bundled copy.** Two copies, different versions, inconsistent behavior.
*Mitigation:* `/comprehend status` shows the bundled `@fos/core` version. Long-term (Plan 3+), consider dropping the standalone CLI.

**Per-project opt-in check on every non-opted-in session.** One `stat` per session per repo — microscopic but global.
*Mitigation:* accepted. Cost is well below noticeable.

### 7.3 Lower-severity

- Plugin uninstall doesn't clean `.comprehension/` — user-visible, easily hand-cleaned.
- 24-hour failure-banner window is arbitrary — `--ack` dismisses early.
- Worker self-chain through a long pending queue serializes execution — acceptable (the user stacked sessions voluntarily).

### 7.4 Open questions — resolved by the Phase 0 probe

Findings in `docs/superpowers/plans/2026-04-21-fos-v2-plugin-probe-findings.md`:

1. **`plugin.json` schema** — Strict closed schema, only `name` required. Location is `.claude-plugin/plugin.json`, not root. Auto-discovery of `commands/*.md` and `hooks/hooks.json` from plugin root.
2. **Hook payload delivery** — JSON on stdin terminated by EOF. Common fields: `session_id`, `transcript_path`, `cwd`, `permission_mode`, `hook_event_name`. Env vars `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`, `CLAUDE_ENV_FILE` provide ambient context. `argv` is not used.
3. **Interactive commands** — **Not via stdin/TTY.** Slash commands are markdown prompt templates; interactivity is via the `AskUserQuestion` LLM tool. This drove the §2/§4/§5 redesign above.
4. **Install layout** — Full file copy to `~/.claude/plugins/cache/<marketplace>/<plugin>/<version>/`. `${CLAUDE_PLUGIN_ROOT}` points there. Relative subpaths (`dist/`, `commands/`, `hooks/`) preserved.
5. **Project-hash derivation** — Scan `~/.claude/projects/<hash>/` for a JSONL whose first event's `cwd` matches the project root. Don't try to reproduce Claude Code's internal hash function.

### 7.5 Still unresolved (requires manual verification before/during Phase 3)

**Exact Stop and SessionStart payload field names.** The probe couldn't trigger a real top-level Claude Code session from a subagent sandbox, so §2.3's hook payload description is predicted from the official `hook-development` skill docs, not observed. Before relying on field-name specifics (e.g., `transcript_path` vs `transcriptPath`), a human must reinstall the probe plugin and trigger one real session. Probe commands are in findings doc §6.6.

If predicted field names are wrong, the fix is mechanical (rename in `src/hooks/*.ts`'s stdin parser). Does not affect overall architecture.

---

## 8. Success Criteria

v1 of the plugin ships when all of the following are true:

### 8.1 Functional

- `claude plugins marketplace add ./packages/plugin` + `claude plugins install comprehend-fos@fos-dev` succeed; consent acknowledgment fires; Stop + SessionStart hooks + all four commands register. `claude plugins validate packages/plugin` passes with no errors.
- `/comprehend init` in a fresh project creates `.comprehension/`, writes `consent.json`, and either runs a backfill or finishes cleanly.
- Live Claude Code session on an opted-in project ends → Stop hook fires → detached worker runs analysis + rebuild invisibly → next SessionStart is silent → `.comprehension/sessions/` has a new file.
- Forced refiner failure (via an override prompt that produces unparseable output) surfaces at next SessionStart. `/comprehend status` shows the failure. `/comprehend status --ack` dismisses the banner.
- Two Claude Code sessions on the same project in quick succession: one wins the lock, the second queues, both eventually produce session files.

### 8.2 Install / onboarding

- Zero API keys or env vars beyond what Claude Code itself already needs.
- Time from `claude plugins install` to first valid analysis artifact from a real session ≤ 3 minutes.

### 8.3 Performance / cost

- Stop hook returns to Claude Code in < 500 ms.
- Worker latency dominated by `@fos/core.analyzeSession` (same bar as Plan 1).
- No measurable increase in Claude Code session-open or session-close time on non-opted-in projects.

### 8.4 Code health

- `@fos/plugin` ≥ 80% line coverage on deterministic layers (`lock.ts`, `log.ts`, `consent.ts`, `discover-project.ts`, command bodies).
- Hook entries have integration tests exercising payload-in → action path with a mocked worker spawner.
- `plugin-smoke.test.ts` loads the built plugin directory and asserts manifest + all entry files exist.

### 8.5 Not a Plan 2 shipping bar

- Marketplace publication (Plan 3).
- Dogfood with 3+ developers (Plan 3).
- Main spec §8.2 refiner-quality numeric bars (Plan 3).

---

## 9. Transition to Implementation

After user approval of this spec, the next step is `superpowers:writing-plans` to produce a sequenced implementation plan with phase checkpoints and subagent-dispatchable task units. No other implementation skill is invoked before the plan exists.

Phase 0 of that plan MUST be a "hello-world plugin probe" to resolve §7.4 open questions empirically before porting the main logic. This is non-negotiable — it de-risks the plugin-format unknowns, which are this plan's biggest failure mode.

**The probe must explicitly verify that slash commands can prompt interactively** (for `/comprehend init`'s y/N prompt). If they cannot, the implementation plan must make `--accept` the only supported path and document the non-interactive failure mode.
