# @fos/plugin — `comprehend-fos`

Passive comprehension layer for Claude Code sessions. Runs as a Claude Code plugin: after every assistant turn (Stop hook), a background worker scans the transcript for unexplained concepts and unknowns, persists a session artifact, and surfaces a compact summary on the next `SessionStart`.

No new chat, no new UI, no new context window cost during a turn — the analysis runs out-of-band in a detached worker.

---

## Install

From a clone of this repository (local marketplace — the `fos-dev` wrapper in `.claude-plugin/marketplace.json` points at this directory):

```bash
# Build the plugin's dist/ first
pnpm --filter @fos/plugin build

# Register the local marketplace and install the plugin
claude plugins marketplace add ./packages/plugin
claude plugins install comprehend-fos@fos-dev
```

A shortcut is wired into the package:

```bash
pnpm --filter @fos/plugin install-local
```

On first install, `install/post-install.js` writes an install-ack marker under the user's FOS state dir so subsequent sessions know the plugin has been acknowledged. Consent for background analysis is a separate per-project gate — see below.

---

## Per-project opt-in

The plugin does not analyze any project until you explicitly opt in from inside that project. Inside a Claude Code session with `cwd` set to the project you want to instrument:

```
/comprehend init
```

This writes a `consent.json` in the project-scoped FOS state directory. Without it the Stop hook exits early and no transcript is read. `/comprehend init` is idempotent — re-running it is safe and reports the existing consent state.

---

## Commands

All four `/comprehend*` commands are markdown slash commands bundled in `commands/` and backed by the `@fos/plugin` CLI (`dist/cli/bin.js`).

- **`/comprehend`** — Summarize the latest session artifact for the current project. Top concepts, top unknowns, counts.
- **`/comprehend init`** — Opt this project in to passive analysis. Writes `consent.json` under the FOS state dir. Required before the Stop hook will do anything.
- **`/comprehend status`** — Show plugin state for this project: consent presence, last analyzed session, queue depth, lock state.
- **`/comprehend backfill`** — Re-analyze the current project's existing Claude Code transcripts that pre-date opt-in. Honors the same lock + queue discipline as the live Stop hook.

---

## What this is NOT (Plan 3 deferrals)

This plugin is intentionally the minimum viable comprehension layer. The following are **out of scope** for Plan 2 and deferred to Plan 3:

- **No cross-session synthesis.** Each session artifact stands alone. There is no rollup across sessions, no concept graph, no "what did I learn this week."
- **No UI / no dashboard.** Artifacts are JSON on disk. Browsing them is `cat` + `jq` or a future Plan 3 viewer.
- **No remote sync.** Everything lives on the local machine under the FOS state dir. No cloud, no telemetry, no export.
- **No on-demand analysis inside a turn.** Analysis only runs on Stop, out-of-band. There is no `/comprehend analyze-now` synchronous mode.
- **No IDE integration.** Slash commands only; no VS Code extension, no editor surface.
- **No multi-user / team features.** Single user, single machine. Consent, state, and locks are all local.

If you want any of those, that's Plan 3 — not a bug report on Plan 2.

---

## Development

```bash
# Install workspace deps (from the repo root)
pnpm install

# Type-check (no emit)
pnpm --filter @fos/plugin lint

# Build dist/ via tsup
pnpm --filter @fos/plugin build

# Run unit + integration tests (vitest)
pnpm --filter @fos/plugin test

# Watch mode
pnpm --filter @fos/plugin test:watch
```

Source layout:

- `src/hooks/` — Stop + SessionStart hook entrypoints
- `src/cli/` — Commander-based `/comprehend*` implementations
- `src/worker/` — Detached `analyze-worker` that does the transcript read + refiner call
- `src/plugin-paths.ts`, `src/lock.ts`, `src/consent.ts`, `src/log.ts` — shared helpers
- `commands/*.md` — slash-command markdown shipped to Claude Code
- `hooks/hooks.json` — Stop + SessionStart hook registrations (references `${CLAUDE_PLUGIN_ROOT}/dist/hooks/*.js`)
- `.claude-plugin/plugin.json` — plugin manifest (`name: "comprehend-fos"`)
- `.claude-plugin/marketplace.json` — local `fos-dev` marketplace wrapper
- `install/post-install.js` — CJS post-install script (`install/package.json` scopes `type: commonjs`)
- `tests/integration/plugin-smoke.test.ts` — packaging smoke test that asserts the shipping-boundary invariants

The plugin depends on `@fos/core` for refiner logic, path helpers, artifact types, and worker-spawn plumbing. Core stays host-agnostic; this package is the Claude-Code-specific adapter.
