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

### 2.1 New repo artifact

```
packages/plugin/
├── package.json              # @fos/plugin, type: module
├── tsconfig.json
├── tsup.config.ts            # bundles @fos/core + deps inline into each entry
├── README.md
├── plugin.json               # Claude Code plugin manifest
├── src/
│   ├── hooks/
│   │   ├── stop.ts
│   │   └── session-start.ts
│   ├── commands/
│   │   ├── comprehend.ts
│   │   ├── comprehend-init.ts
│   │   ├── comprehend-status.ts
│   │   └── comprehend-backfill.ts
│   ├── worker/
│   │   └── analyze-worker.ts # detached subprocess entry
│   ├── lock.ts               # per-project analysis.lock helpers
│   ├── log.ts                # structured log writer
│   ├── consent.ts            # install-ack + per-project consent record
│   ├── discover-project.ts   # project-root + Claude Code session-id resolution
│   └── index.ts              # internal barrel
└── tests/
    ├── {lock,log,consent,discover-project}.test.ts
    ├── hooks/{stop,session-start}.test.ts
    ├── commands/{comprehend-init,comprehend-status,comprehend-backfill}.test.ts
    └── integration/plugin-smoke.test.ts
```

### 2.2 Bundling model

`@fos/plugin` has `"@fos/core": "workspace:*"` as a dev-time dep for type inference. tsup is configured to **inline** `@fos/core` + its runtime deps (`zod`, `gray-matter`, `execa`, `commander`, plus the `cytoscape` template bundle from the viewer) into each entry file. Resulting `dist/` is fully self-contained — no `node_modules` lookup at runtime.

The refiner prompt markdown file (`refiner-v1.md`) and the viewer's bundled template are copied from `@fos/core`'s shipped `prompts/` and `dist/viewer/` into the plugin's `dist/` via tsup's `onSuccess` hook. The walking-`package.json` resolver in `@fos/core`'s `load-prompt.ts` still works because `@fos/plugin/package.json` provides the anchor at the plugin's install location.

### 2.3 Entry points

Each hook and command compiles to its own tsup entry (no shared-chunk complexity):

- `hooks/stop.ts` — receives Claude Code's hook-event payload, validates opt-in, acquires lock or queues to pending, spawns `worker/analyze-worker.ts` detached, returns exit 0 immediately.
- `hooks/session-start.ts` — reads logs + pending queue + manifest; emits at most one line.
- `commands/*.ts` — commander-style entries that delegate to `@fos/core`'s public API or to the plugin's helper modules.
- `worker/analyze-worker.ts` — detached process entry: runs `analyzeSession` then `rebuildProjectView`, logs, releases lock, drains one pending queue item by self-chaining a fresh worker, exits.

### 2.4 Boundaries

- The plugin **never reaches into `@fos/core` internals** — only its public API (`analyzeSession`, `rebuildProjectView`, `backfill`, `loadRefinerPrompt`, `VERSION`, plus the types).
- The plugin **never duplicates logic** from `@fos/core`. Paths come from `core`'s `paths.ts`; manifest read/write from `core`'s `writer/manifest.ts`. Plugin contributes only plugin-specific logic: hooks, locks, logs, consent, project discovery.
- `plugin.json` is static and declares all hooks + commands at install time. No dynamic registration.

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

Empty marker file touched by `/comprehend status --ack`. SessionStart only shows failure banners for failures after this timestamp.

### 3.6 Existing state (from Plan 1, not new in Plan 2)

- `.comprehension/manifest.json` — project-level metadata (unchanged).
- `.comprehension/sessions/*.md` — session artifacts (unchanged).
- `.comprehension/sessions/<date>-<id>.failed.json` — already written by `@fos/core` on refiner failure (Plan 2's `/comprehend status` surfaces them).
- `.comprehension/concepts/*.md`, `graph.json`, `graph.html` — derived view (unchanged).

### 3.7 Machine-wide install acknowledgment

`~/.claude/fos-install-ack` — empty marker file touched by the plugin's post-install step. `/comprehend init` checks for its existence before allowing per-project opt-in.

---

## 4. Lifecycle Flows

### 4.1 Install (one-time, per machine)

`claude plugins install file:./packages/plugin` triggers:

1. Plugin directory is placed in Claude Code's plugin cache.
2. Post-install step prints the data-flow consent text and prompts `Press Enter to acknowledge`.
3. On acknowledgment, touches `~/.claude/fos-install-ack`.
4. Hooks + commands are registered per the manifest.

Plugin is now installed but inert. Nothing analyzes anything until a project opts in.

### 4.2 Per-project opt-in (`/comprehend init`)

Running the command inside a project root:

1. Check `~/.claude/fos-install-ack`. If missing → error with instructions to rerun install.
2. If `.comprehension/.fos/consent.json` already exists → idempotent no-op (report current status).
3. Prompt the user: "Opt this project in for automatic analysis?" with estimated backfill cost.
4. On `y`:
   - Delegate to `@fos/core.runInit` to create `.comprehension/` skeleton.
   - Write `consent.json`.
   - Offer the backfill wizard (same flow as `/comprehend backfill`); can be skipped.
5. On `n`: exit 0, nothing written.

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

### 5.1 `/comprehend init`

```
Usage: /comprehend init [--accept] [--skip-backfill]

Flags:
  --accept          Non-interactive: opt in without the y/N prompt.
  --skip-backfill   Skip the post-init backfill wizard.
```

- **Exit 0** on successful opt-in (or idempotent reuse).
- **Exit 1** if `~/.claude/fos-install-ack` is missing.

### 5.2 `/comprehend`

```
Usage: /comprehend [session_id] [--dry-run] [--force]

Args:
  session_id   Session to re-analyze. Defaults to the current session.

Flags:
  --dry-run    Show cost estimate + existing state; don't invoke the refiner.
  --force      Re-analyze even if the session already has a session file.
```

- **Synchronous** (user is at the keyboard). No detach. Fails fast if the lock is held.
- **Exit 0** on success, **1** on refiner failure, **3** if the project isn't opted in.

### 5.3 `/comprehend status`

```
Usage: /comprehend status [--ack]

Flags:
  --ack   Mark all current failures as acknowledged; dismisses the
          SessionStart banner until a new failure occurs.
```

- Output lists project root, refiner version + hash, counts (analyzed / failed / queued / running), last rebuild time + `project_view_version`, and the last 3 worker runs with outcomes.
- **Exit 0** always (informational).

### 5.4 `/comprehend backfill`

```
Usage: /comprehend backfill [--project-hash <hash>] [--recent <N>]
                            [--yes] [--model <model>]
```

- Thin wrapper over `@fos/core.discoverSessions` + `backfill`.
- Auto-derives `--project-hash` from project root if possible (scan `~/.claude/projects/` for matching `cwd`); prompts otherwise.
- Acquires the project-level lock for the entire backfill run so it doesn't race with concurrent Stop hooks.
- Each backfilled session gets a log entry like any other.
- **Exit 0** on completion, **1** on aborted, **2** on cost-estimate declined, **3** if project isn't opted in.

### 5.5 Cross-command conventions

- Every command first checks opt-in; exit 3 with a helpful message if missing.
- Every command routes errors through `log.ts` so `/comprehend status` surfaces them.
- Every command uses `@fos/core`'s path helpers.
- Exit codes are documented and stable.

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

### 7.4 Open questions (resolve during implementation)

1. **Exact `plugin.json` schema** — Phase 0 probe answers.
2. **How Claude Code passes hook-event JSON** (stdin vs argv vs env) — Phase 0 probe.
3. **Can slash commands prompt interactively?** If not, `/comprehend init` must hard-require `--accept` when stdin isn't a TTY.
4. **Plugin dir layout post-install** — copied / symlinked / loaded in place? Affects whether the walking-`package.json` resolver finds `dist/prompts/`.
5. **Project-hash derivation** — hash the cwd the way Claude Code does, or scan `~/.claude/projects/` for matching cwd. The scanning approach is more robust; use it.

---

## 8. Success Criteria

v1 of the plugin ships when all of the following are true:

### 8.1 Functional

- `claude plugins install file:./packages/plugin` succeeds; consent acknowledgment fires; Stop + SessionStart hooks + all four commands register.
- `/comprehend init` in a fresh project creates `.comprehension/`, writes `consent.json`, and either runs a backfill or finishes cleanly.
- Live Claude Code session on an opted-in project ends → Stop hook fires → detached worker runs analysis + rebuild invisibly → next SessionStart is silent → `.comprehension/sessions/` has a new file.
- Forced refiner failure (bad `claude` auth) surfaces at next SessionStart. `/comprehend status` shows the failure. `/comprehend status --ack` dismisses the banner.
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
