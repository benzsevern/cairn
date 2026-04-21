# FOS v2 — Plugin Layer Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

> **Post-probe revision (2026-04-21):** Phase 0 (plugin-format probe) completed and revealed that Claude Code slash commands are markdown prompt templates, not executable scripts. The spec and this plan were amended to move imperative logic into a single CLI binary (`dist/cli/bin.js`) that command markdown invokes via Bash; commands/*.md are now LLM prompt templates driving `AskUserQuestion` + Bash. Tasks marked **[REVISED]** reflect this correction.

**Goal:** Build `@fos/plugin` — a self-contained Claude Code plugin that wraps the Plan 1 `@fos/core` engine with a detached-background Stop hook, a minimal-actionable SessionStart hook, four slash commands (`/comprehend`, `/comprehend init`, `/comprehend status`, `/comprehend backfill`), and install-time + per-project consent.

**Architecture:** New `packages/plugin/` in the existing pnpm monorepo. `@fos/core` is inlined into the plugin's `dist/` via tsup — plugin is self-contained with zero runtime npm deps. Single CLI binary (`dist/cli/bin.js`) exposes all subcommands (`init`, `analyze`, `rebuild`, `backfill`, `status`); four `commands/*.md` prompt templates drive it via the Bash tool. Stop hook is a tiny gate that spawns a detached Node worker and exits within 500 ms. Per-project file lock + pending queue serialize concurrent analyses. SessionStart reads log files + pending queue + manifest to surface at most one actionable message via the hook's stdout JSON response.

**Tech Stack:**
- Node 20+, TypeScript 5.x, ESM (same as Plan 1)
- pnpm workspace (existing)
- tsup for bundling (per-entry, inline all deps)
- vitest (tests)
- `@fos/core` (workspace dep, inlined at build)
- No new runtime deps beyond what `@fos/core` already brings

**Related docs:**
- Spec: `docs/superpowers/specs/2026-04-20-fos-plugin-layer-design.md`
- Parent product spec: `docs/superpowers/specs/2026-04-20-fos-retrospective-comprehension-layer-design.md`
- Plan 1 (merged, reference): `docs/superpowers/plans/2026-04-20-fos-v1-core-engine.md`

**What this plan produces (end state):**

```bash
# After executing this plan, these all work end-to-end:
claude plugins install file:./packages/plugin   # installs with consent prompt
/comprehend init                                 # opts current project in
# ...user works normally in Claude Code...
# Stop hook → detached worker → analyzes session → logs result
/comprehend status                               # shows pending / running / failures
/comprehend status --ack                         # dismisses failure banner
/comprehend                                      # re-analyze current session synchronously
/comprehend backfill --recent 10                 # analyze 10 most-recent past sessions
# Opening a new Claude Code session: silent if nothing to say, banner if pending/failed/etc.
```

**What this plan explicitly does NOT produce:**

- `/comprehend rerun` — Plan 3.
- Marketplace publication — Plan 3.
- 15+ transcript golden corpus / §8.2 quality bars — Plan 3.
- Plugin uninstall cleanup of `.comprehension/` — not needed.

**Branch convention:** Implementer creates and works on `feat/plan-2-plugin-layer` branched from `main`. Merge back via `--no-ff` after the final review passes, same as Plan 1.

---

## File Structure

All paths relative to repo root `D:\comprehension-debt\`:

```
packages/
└── plugin/
    ├── package.json                       # @fos/plugin, type: module
    ├── tsconfig.json
    ├── tsup.config.ts                     # 4-entry build (hooks×2 + cli/bin + worker)
    ├── README.md
    ├── .claude-plugin/
    │   ├── plugin.json                    # Claude Code plugin manifest (post-probe location)
    │   └── marketplace.json               # self-wrapper for local install flow
    ├── commands/                          # LLM prompt templates (NOT compiled)
    │   ├── comprehend.md
    │   ├── comprehend-init.md
    │   ├── comprehend-status.md
    │   └── comprehend-backfill.md
    ├── hooks/
    │   └── hooks.json                     # Claude Code hook-config manifest
    ├── install/
    │   └── post-install.js                # install-time consent text + install-ack marker
    ├── src/
    │   ├── hooks/
    │   │   ├── stop.ts                    # → dist/hooks/stop.js
    │   │   └── session-start.ts           # → dist/hooks/session-start.js
    │   ├── cli/
    │   │   ├── bin.ts                     # → dist/cli/bin.js (dispatches subcommands)
    │   │   └── commands/
    │   │       ├── comprehend.ts          # `analyze` subcommand impl
    │   │       ├── comprehend-init.ts     # `init` subcommand impl
    │   │       ├── comprehend-status.ts   # `status` subcommand impl
    │   │       └── comprehend-backfill.ts # `backfill` subcommand impl
    │   ├── worker/
    │   │   └── analyze-worker.ts          # → dist/worker/analyze-worker.js
    │   ├── lock.ts
    │   ├── log.ts
    │   ├── consent.ts
    │   ├── discover-project.ts
    │   └── plugin-paths.ts
    └── tests/
        ├── unit/
        │   ├── lock.test.ts
        │   ├── log.test.ts
        │   ├── consent.test.ts
        │   ├── discover-project.test.ts
        │   └── plugin-paths.test.ts
        ├── hooks/
        │   ├── stop.test.ts
        │   └── session-start.test.ts
        ├── cli/
        │   └── commands/
        │       ├── comprehend-init.test.ts
        │       ├── comprehend-status.test.ts
        │       └── comprehend-backfill.test.ts
        └── integration/
            ├── plugin-smoke.test.ts        # asserts .claude-plugin/, commands/*.md, hooks/hooks.json, dist/*
            └── worker-chain.test.ts

packages/core/
└── src/
    └── paths.ts                           # Phase 1 Task 4: extended with plugin path helpers

docs/superpowers/plans/
├── 2026-04-21-fos-v2-plugin-layer.md      # this plan (revised post-probe)
└── 2026-04-21-fos-v2-plugin-probe-findings.md   # Phase 0 output — authoritative ground truth
```

**Design principles enforced by this layout:**

1. Each file has one responsibility (a hook, a command, or a helper module). No "god files."
2. `plugin-paths.ts` is the plugin's sole source of truth for the new `.fos/` subpaths. It re-exports `@fos/core`'s existing path helpers so the rest of the plugin doesn't import from `@fos/core` directly for paths.
3. Tests mirror source layout. Each source module has a matching unit test file. Hooks and commands each have dedicated test files. Integration tests exercise emergent behavior (plugin-dir loads, worker chain drains queue).
4. Bundled output is per-entry (one `dist/*.js` per hook/command/worker) so Claude Code can invoke each independently without loading the whole plugin into memory on every event.

---

## Phase overview

1. **Phase 0 — Plugin-format probe** (Tasks 1–3) — empirically resolve spec §7.4 questions; non-negotiable per spec §9.
2. **Phase 1 — Monorepo integration** (Tasks 4–6) — extend `@fos/core` paths, scaffold `@fos/plugin`, bundling smoke.
3. **Phase 2 — Helper modules** (Tasks 7–11) — `plugin-paths`, `consent`, `lock`, `log`, `discover-project`. All deterministic TDD.
4. **Phase 3 — Worker** (Task 12) — detached subprocess entry; chains pending queue.
5. **Phase 4 — Stop hook** (Task 13) — gates, lock, detach, spawned_at log.
6. **Phase 5 — SessionStart hook** (Task 14) — message-priority pick based on state.
7. **Phase 6 — Commands** (Tasks 15–18) — `/comprehend init`, `/comprehend`, `/comprehend status`, `/comprehend backfill`.
8. **Phase 7 — Plugin manifest + install script** (Tasks 19–20) — `plugin.json` from probe findings, post-install consent.
9. **Phase 8 — Integration tests** (Tasks 21–22) — plugin-smoke + worker-chain.
10. **Phase 9 — Release prep** (Tasks 23–24) — README, end-to-end manual verification.

---

## Phase 0 — Plugin-format probe

Spec §9 requires resolving §7.4 open questions before porting the real logic. This phase is **investigation**, not production code. Outputs: a written `probe-findings.md` document and a throwaway probe directory that gets deleted when the phase ends.

### Task 1: Set up branch and minimal probe plugin

**Files:**
- Create (temporary, deleted at end of Phase 0): `plugin-probe/plugin.json`
- Create (temporary): `plugin-probe/hooks/stop.js`
- Create (temporary): `plugin-probe/hooks/session-start.js`
- Create (temporary): `plugin-probe/commands/probe.js`

- [ ] **Step 1: Branch**

```bash
cd D:/comprehension-debt
git checkout main
git pull --ff-only 2>/dev/null || true   # no remote yet; ignore
git checkout -b feat/plan-2-plugin-layer
```

- [ ] **Step 2: Create `plugin-probe/plugin.json`** — your best guess at the schema based on Claude Code documentation you can find at `docs.anthropic.com/en/docs/claude-code/plugins` or any reference plugins in `C:/Users/bsevern/.claude/plugins/cache/`. A plausible starting point:

```json
{
  "name": "fos-probe",
  "version": "0.0.1",
  "hooks": {
    "Stop": "hooks/stop.js",
    "SessionStart": "hooks/session-start.js"
  },
  "commands": {
    "probe": "commands/probe.js"
  }
}
```

- [ ] **Step 3: Write a probe hook `plugin-probe/hooks/stop.js`**

The hook's job is to log **everything it receives** (argv, env, stdin, cwd) to a known file so you can inspect what Claude Code passes.

```js
#!/usr/bin/env node
const { appendFileSync } = require('node:fs');
const { resolve } = require('node:path');

const logPath = resolve(process.env.HOME || process.env.USERPROFILE || '.', '.fos-probe-log.txt');

const entry = {
  hook: 'Stop',
  timestamp: new Date().toISOString(),
  argv: process.argv,
  env_keys: Object.keys(process.env).filter((k) => k.startsWith('CLAUDE') || k.includes('SESSION') || k.includes('FOS')),
  cwd: process.cwd(),
  stdin_eof: null,
};

// Try to read stdin non-blocking; bail after 200ms if no data.
let stdinBuf = '';
process.stdin.on('data', (chunk) => { stdinBuf += chunk.toString('utf8'); });
process.stdin.on('end', () => {
  entry.stdin_eof = true;
  entry.stdin = stdinBuf;
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
  process.exit(0);
});
setTimeout(() => {
  entry.stdin_eof = false;
  entry.stdin = stdinBuf;
  appendFileSync(logPath, JSON.stringify(entry) + '\n');
  process.exit(0);
}, 200);
```

- [ ] **Step 4: Write `plugin-probe/hooks/session-start.js`** — same pattern as Step 3 but `hook: 'SessionStart'`.

- [ ] **Step 5: Write `plugin-probe/commands/probe.js`** — a command that tries to prompt interactively and logs the outcome.

```js
#!/usr/bin/env node
const { appendFileSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { createInterface } = require('node:readline/promises');

const logPath = resolve(process.env.HOME || process.env.USERPROFILE || '.', '.fos-probe-log.txt');
const entry = {
  hook: 'Command:probe',
  timestamp: new Date().toISOString(),
  argv: process.argv,
  cwd: process.cwd(),
  stdin_tty: process.stdin.isTTY === true,
  stdout_tty: process.stdout.isTTY === true,
};

appendFileSync(logPath, JSON.stringify(entry) + '\n');

if (entry.stdin_tty) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.question('Probe: can you type and press Enter? ').then((answer) => {
    appendFileSync(logPath, JSON.stringify({ ...entry, interactive_answer: answer }) + '\n');
    rl.close();
    process.exit(0);
  });
} else {
  appendFileSync(logPath, JSON.stringify({ ...entry, interactive_answer: '(non-TTY — cannot prompt)' }) + '\n');
  process.exit(0);
}
```

- [ ] **Step 6: Do NOT commit the probe directory.** Add `plugin-probe/` to `.gitignore` temporarily.

```bash
echo "plugin-probe/" >> .gitignore
echo "~/.fos-probe-log.txt" >> .gitignore
git add .gitignore
git commit -m "chore: ignore plugin-probe/ and probe log (Phase 0)"
```

---

### Task 2: Install probe, exercise each surface, capture findings

- [ ] **Step 1: Install the probe plugin**

```bash
claude plugins install file:./plugin-probe 2>&1 | tee probe-install.log
```

Capture stdout/stderr. **Observe:**
- Did install succeed?
- Where did the plugin get copied? (inspect `C:/Users/bsevern/.claude/plugins/` or wherever)
- Was there any consent / install-step hook offered to the plugin?

- [ ] **Step 2: Exercise the `/probe` slash command**

In a Claude Code session, run `/probe` and inspect `~/.fos-probe-log.txt`. **Observe:**
- Did the command run?
- Was `stdin_tty` true? If not, interactive prompts are impossible.
- If TTY was available, did the readline prompt work?

- [ ] **Step 3: Trigger the Stop hook**

End the Claude Code session. Inspect `~/.fos-probe-log.txt` for the Stop entry. **Observe:**
- What is in `argv`? (hook event payload? a path to a JSON file? nothing?)
- What env vars contain useful data (CLAUDE_SESSION_ID, CLAUDE_CWD, etc.)?
- Was stdin populated? Was it valid JSON?

- [ ] **Step 4: Trigger the SessionStart hook**

Start a new Claude Code session. Inspect the new entry.

- [ ] **Step 5: Inspect where the plugin is installed**

```bash
find ~/.claude/plugins -name 'plugin.json' 2>/dev/null | xargs -I{} dirname {}
ls -la <plugin install dir>
```

**Observe:** Is it a copy or a symlink? Does the `dist/` directory structure work the same way installed as it does locally?

- [ ] **Step 6: Test whether plugin.json is wrong**

Intentionally introduce a typo in `plugin.json` (e.g., rename `hooks` to `Hooks`). Reinstall. Does Claude Code reject it with a useful error, or silently load nothing? This informs how defensive `@fos/plugin`'s manifest needs to be.

---

### Task 3: Write findings doc + clean up probe

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-fos-v2-plugin-probe-findings.md`
- Delete: `plugin-probe/` directory
- Modify: `.gitignore` (remove probe entries, revert earlier commit's additions via new commit)

- [ ] **Step 1: Write the findings doc**

Required sections:

1. **`plugin.json` schema** — the exact fields Claude Code expects, with the schema you verified works. If the spec's guess was wrong, document the corrected shape.
2. **Hook event payload delivery** — stdin JSON / argv / env / combination. Include a sample payload shape.
3. **Interactive slash commands** — can they prompt? Under what conditions (TTY, shell)? If not, `/comprehend init` must require `--accept` non-interactively.
4. **Plugin install location + layout** — where installed, copy vs symlink, implications for relative file paths (`dist/prompts/`, `dist/viewer/`).
5. **Error surfacing for malformed plugin.json** — does Claude Code log? Silent fail?
6. **Any surprising behavior** that should inform the plan's remaining phases. If a spec assumption is wrong, call it out with a proposed adjustment.

- [ ] **Step 2: Uninstall the probe**

```bash
claude plugins uninstall fos-probe 2>&1 | tee probe-uninstall.log
```

- [ ] **Step 3: Delete the probe directory**

```bash
rm -rf plugin-probe/ probe-install.log probe-uninstall.log
rm -f ~/.fos-probe-log.txt
```

- [ ] **Step 4: Remove probe entries from `.gitignore`**

Edit `.gitignore` — remove the `plugin-probe/` and `~/.fos-probe-log.txt` lines added in Task 1 Step 6.

- [ ] **Step 5: Commit findings + cleanup**

```bash
git add docs/superpowers/plans/2026-04-21-fos-v2-plugin-probe-findings.md .gitignore
git commit -m "$(cat <<'EOF'
Phase 0: plugin-format probe findings (Plan 2)

Empirically resolved §7.4 open questions from the plugin layer spec
by building and uninstalling a throwaway probe plugin. Subsequent
phases reference this doc as the ground truth for Claude Code's
plugin format, hook payload delivery, and interactive-command
capabilities.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

**If the findings contradict the spec significantly** (e.g., plugins can't prompt interactively even in TTY mode; hooks can't run detached subprocesses; plugin.json requires a totally different shape), **stop and escalate to the user** before Phase 1. Report the specific conflict and propose a spec amendment.

---

## Phase 1 — Monorepo Integration

### Task 4: Extend `@fos/core` paths for plugin-specific files

The plugin's `.fos/` subfiles (consent.json, analysis.lock, pending.json, logs/, acked_at) are first-class parts of the persistence model defined in the Plan-2 spec §3. Plan 1's `paths.ts` already owns `.comprehension/.fos/cache/`; we add siblings.

**Files:**
- Modify: `packages/core/src/paths.ts`
- Modify: `packages/core/tests/paths.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `packages/core/tests/paths.test.ts`:

```ts
import {
  consentPath,
  analysisLockPath,
  pendingQueuePath,
  logsDir,
  logFilePath,
  ackedAtPath,
  installAckPath,
} from '../src/paths.js';

describe('plugin paths', () => {
  const root = '/tmp/proj';

  it('consent.json lives under .comprehension/.fos/', () => {
    expect(consentPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]consent\.json$/);
  });

  it('analysis.lock lives under .comprehension/.fos/', () => {
    expect(analysisLockPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]analysis\.lock$/);
  });

  it('pending.json lives under .comprehension/.fos/', () => {
    expect(pendingQueuePath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]pending\.json$/);
  });

  it('logs dir and per-session log files under .comprehension/.fos/logs/', () => {
    expect(logsDir(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]logs$/);
    expect(logFilePath(root, 'sess-abc')).toMatch(/\.comprehension[\\/]\.fos[\\/]logs[\\/]sess-abc\.log$/);
  });

  it('acked_at marker lives under .comprehension/.fos/', () => {
    expect(ackedAtPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]acked_at$/);
  });

  it('install ack marker lives under user home ~/.claude/', () => {
    const p = installAckPath();
    expect(p).toMatch(/[\\/]\.claude[\\/]fos-install-ack$/);
  });
});
```

- [ ] **Step 2: Implement the new helpers in `paths.ts`**

Append (keeping existing helpers):

```ts
import { homedir } from 'node:os';

export function consentPath(projectRoot: string): string {
  return join(fosDir(projectRoot), 'consent.json');
}
export function analysisLockPath(projectRoot: string): string {
  return join(fosDir(projectRoot), 'analysis.lock');
}
export function pendingQueuePath(projectRoot: string): string {
  return join(fosDir(projectRoot), 'pending.json');
}
export function logsDir(projectRoot: string): string {
  return join(fosDir(projectRoot), 'logs');
}
export function logFilePath(projectRoot: string, sessionId: string): string {
  return join(logsDir(projectRoot), `${sessionId}.log`);
}
export function ackedAtPath(projectRoot: string): string {
  return join(fosDir(projectRoot), 'acked_at');
}
export function installAckPath(): string {
  return join(homedir(), '.claude', 'fos-install-ack');
}
```

- [ ] **Step 3: Run tests** — `pnpm --filter @fos/core test tests/paths.test.ts` — expect 6 prior + 6 new passing.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/paths.ts packages/core/tests/paths.test.ts
git commit -m "feat(core): extend paths.ts with plugin-layer .fos/* helpers"
```

---

### Task 5: Scaffold `packages/plugin/` package

**Files:**
- Create: `packages/plugin/package.json`
- Create: `packages/plugin/tsconfig.json`
- Create: `packages/plugin/tsup.config.ts`
- Create: `packages/plugin/src/plugin-paths.ts` (barrel re-exporting core paths + plugin path helpers)
- Create: `packages/plugin/tests/smoke.test.ts`

- [ ] **Step 1: Create `packages/plugin/package.json`**

```json
{
  "name": "@fos/plugin",
  "version": "0.0.1",
  "private": false,
  "type": "module",
  "files": ["dist", "plugin.json", "install"],
  "scripts": {
    "build": "tsup",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "tsc --noEmit"
  },
  "dependencies": {
    "@fos/core": "workspace:*"
  },
  "devDependencies": {
    "@types/node": "^20.12.0",
    "tsup": "^8.0.0",
    "typescript": "^5.4.0",
    "vitest": "^1.5.0"
  }
}
```

- [ ] **Step 2: Create `packages/plugin/tsconfig.json`**

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src"
  },
  "include": ["src/**/*"],
  "exclude": ["dist", "node_modules", "tests"]
}
```

- [ ] **Step 3: Create `packages/plugin/tsup.config.ts`** **[REVISED post-probe]**

Four entries. Hooks and worker each get their own entry; `src/cli/bin.ts` is a single entry whose `src/cli/commands/*.ts` imports are inlined by tsup. `noExternal` inlines `@fos/core` and its transitive deps.

```ts
import { defineConfig } from 'tsup';

export default defineConfig({
  entry: [
    'src/hooks/stop.ts',
    'src/hooks/session-start.ts',
    'src/cli/bin.ts',
    'src/worker/analyze-worker.ts',
  ],
  format: ['esm'],
  dts: false,
  clean: true,
  sourcemap: true,
  target: 'node20',
  noExternal: [/^@fos\//, 'zod', 'gray-matter', 'execa', 'commander'],
});
```

- [ ] **Step 4: Create `packages/plugin/src/plugin-paths.ts`**

```ts
// Re-export core's path helpers so the plugin has a single import for all paths.
export * from '@fos/core';
```

(Plugin-specific helpers already live in `@fos/core/paths.ts` from Task 4; the barrel just narrows the import surface.)

- [ ] **Step 5: Create smoke test `packages/plugin/tests/smoke.test.ts`**

```ts
import { describe, it, expect } from 'vitest';
import { VERSION, consentPath, installAckPath } from '../src/plugin-paths.js';

describe('@fos/plugin smoke', () => {
  it('re-exports @fos/core VERSION', () => {
    expect(VERSION).toBe('0.0.1');
  });
  it('re-exports plugin path helpers from core', () => {
    expect(consentPath('/tmp/x')).toMatch(/consent\.json$/);
    expect(installAckPath()).toMatch(/fos-install-ack$/);
  });
});
```

- [ ] **Step 6: Install + run smoke**

```bash
pnpm install
pnpm --filter @fos/plugin test
pnpm --filter @fos/plugin lint
```

Expected: 2 tests pass, tsc clean.

- [ ] **Step 7: Confirm the build produces the expected entries, even though they don't exist yet**

Skip the build until Task 6 — the entries are stubs that don't exist yet.

- [ ] **Step 8: Commit**

```bash
git add packages/plugin pnpm-lock.yaml
git commit -m "feat(plugin): scaffold @fos/plugin package"
```

---

### Task 6: Stub all entry files + bundling smoke **[REVISED post-probe]**

**Files (all stubs for now):**
- Create: `packages/plugin/src/hooks/stop.ts`
- Create: `packages/plugin/src/hooks/session-start.ts`
- Create: `packages/plugin/src/cli/bin.ts`
- Create: `packages/plugin/src/cli/commands/comprehend.ts`
- Create: `packages/plugin/src/cli/commands/comprehend-init.ts`
- Create: `packages/plugin/src/cli/commands/comprehend-status.ts`
- Create: `packages/plugin/src/cli/commands/comprehend-backfill.ts`
- Create: `packages/plugin/src/worker/analyze-worker.ts`

- [ ] **Step 1: Stub hooks and worker**

Pattern (adjust the log message per file):

```ts
// packages/plugin/src/hooks/stop.ts
export async function main(): Promise<void> {
  console.error('[@fos/plugin stop] not yet implemented (Phase 4)');
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(2); });
}
```

Apply the same pattern to `session-start.ts` and `worker/analyze-worker.ts`.

- [ ] **Step 2: Stub CLI subcommands**

Each `src/cli/commands/*.ts` file exports a subcommand registration function that commander will call. Stub:

```ts
// packages/plugin/src/cli/commands/comprehend-init.ts
import type { Command } from 'commander';

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('opt this project in for automatic analysis (impl in Phase 6)')
    .option('--show-consent')
    .option('--accept')
    .option('--skip-backfill')
    .action(() => {
      console.error('[init] not yet implemented (Phase 6)');
      process.exit(1);
    });
}
```

Repeat the pattern for `comprehend.ts` (subcommand name `analyze`), `comprehend-status.ts` (name `status`), `comprehend-backfill.ts` (name `backfill`).

- [ ] **Step 3: Stub CLI bin entry**

```ts
// packages/plugin/src/cli/bin.ts
#!/usr/bin/env node
import { Command } from 'commander';
import { initCommand } from './commands/comprehend-init.js';
import { analyzeCommand } from './commands/comprehend.js';
import { statusCommand } from './commands/comprehend-status.js';
import { backfillCommand } from './commands/comprehend-backfill.js';

export async function runCli(argv: readonly string[]): Promise<void> {
  const program = new Command();
  program.name('fos').description('FOS plugin CLI — drives /comprehend* slash commands');
  initCommand(program);
  analyzeCommand(program);
  statusCommand(program);
  backfillCommand(program);
  await program.parseAsync([...argv]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli(process.argv).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
```

The subcommand names intentionally use `analyze`/`init`/`status`/`backfill` (not `comprehend`/`comprehend-init`/etc.) because the markdown templates invoke the CLI as `bin.js <subcommand>`.

- [ ] **Step 4: Run the build**

```bash
pnpm --filter @fos/plugin build
```

Expected: `packages/plugin/dist/` contains exactly 4 bundled `.js` files:
- `dist/hooks/stop.js`
- `dist/hooks/session-start.js`
- `dist/cli/bin.js`
- `dist/worker/analyze-worker.js`

Each fully self-contained (inlined deps). Sizes likely ~0.5–1.5 MB.

- [ ] **Step 5: Sanity-run the bin**

```bash
node packages/plugin/dist/cli/bin.js --help
```

Expected: commander prints 4 subcommands (init, analyze, status, backfill) with their help text.

```bash
node packages/plugin/dist/cli/bin.js init
```

Expected: prints the stub "not yet implemented (Phase 6)" line + exits 1.

- [ ] **Step 6: Run tests + lint**

```bash
pnpm --filter @fos/plugin test
pnpm --filter @fos/plugin lint
```

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src
git commit -m "feat(plugin): stub hooks + single CLI entry for bundling smoke (post-probe layout)"
```

---

## Phase 2 — Helper Modules

Five helper modules. All deterministic, TDD-first. Each produces one commit.

### Task 7: `plugin-paths.ts` unit tests

**Files:**
- Create: `packages/plugin/tests/unit/plugin-paths.test.ts`

- [ ] **Step 1: Write tests** verifying that `plugin-paths.ts` exports every path helper used elsewhere in the plugin (catch regressions if `@fos/core` removes a helper).

```ts
import { describe, it, expect } from 'vitest';
import * as plugin from '../../src/plugin-paths.js';

describe('plugin-paths barrel completeness', () => {
  const required = [
    'comprehensionDir', 'sessionsDir', 'conceptsDir', 'fosDir',
    'manifestPath', 'graphJsonPath', 'graphHtmlPath',
    'sessionFilePath', 'conceptFilePath', 'overridePromptPath',
    'failedStubPath', 'consentPath', 'analysisLockPath',
    'pendingQueuePath', 'logsDir', 'logFilePath', 'ackedAtPath', 'installAckPath',
  ] as const;
  for (const name of required) {
    it(`exports ${name}`, () => {
      expect(typeof (plugin as Record<string, unknown>)[name]).toBe('function');
    });
  }
});
```

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @fos/plugin test
git add packages/plugin/tests/unit/plugin-paths.test.ts
git commit -m "test(plugin): plugin-paths barrel completeness"
```

---

### Task 8: `consent.ts` — install-ack and per-project consent

**Files:**
- Create: `packages/plugin/src/consent.ts`
- Create: `packages/plugin/tests/unit/consent.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, readFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasInstallAck,
  writeInstallAck,
  hasProjectConsent,
  writeProjectConsent,
  readProjectConsent,
} from '../../src/consent.js';
import { installAckPath, consentPath, fosDir } from '../../src/plugin-paths.js';

describe('consent', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-consent-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('hasInstallAck returns false when ack file missing', async () => {
    expect(await hasInstallAck({ homeOverride: tmp })).toBe(false);
  });

  it('writeInstallAck creates the marker and hasInstallAck returns true', async () => {
    await writeInstallAck({ homeOverride: tmp });
    expect(await hasInstallAck({ homeOverride: tmp })).toBe(true);
  });

  it('hasProjectConsent returns false when consent.json missing', async () => {
    expect(await hasProjectConsent(tmp)).toBe(false);
  });

  it('writeProjectConsent creates .fos/ + consent.json and readProjectConsent round-trips', async () => {
    await writeProjectConsent(tmp, { opted_in_at: '2026-04-21T10:00:00Z' });
    expect(await hasProjectConsent(tmp)).toBe(true);
    const c = await readProjectConsent(tmp);
    expect(c).toEqual({
      opted_in_at: '2026-04-21T10:00:00Z',
      acknowledged_install: true,
      scope: 'this-project',
    });
  });
});
```

- [ ] **Step 2: Implement `consent.ts`**

```ts
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { consentPath, fosDir, installAckPath } from './plugin-paths.js';

export interface ProjectConsent {
  opted_in_at: string;
  acknowledged_install: true;
  scope: 'this-project';
}

interface HomeOpts { homeOverride?: string }

function ackPathFor(opts: HomeOpts): string {
  if (opts.homeOverride) return join(opts.homeOverride, '.claude', 'fos-install-ack');
  return installAckPath();
}

async function exists(path: string): Promise<boolean> {
  try { await access(path); return true; } catch { return false; }
}

export async function hasInstallAck(opts: HomeOpts = {}): Promise<boolean> {
  return exists(ackPathFor(opts));
}

export async function writeInstallAck(opts: HomeOpts = {}): Promise<void> {
  const target = ackPathFor(opts);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, '', 'utf8');
}

export async function hasProjectConsent(projectRoot: string): Promise<boolean> {
  return exists(consentPath(projectRoot));
}

export async function writeProjectConsent(
  projectRoot: string,
  partial: { opted_in_at: string },
): Promise<void> {
  await mkdir(fosDir(projectRoot), { recursive: true });
  const record: ProjectConsent = {
    opted_in_at: partial.opted_in_at,
    acknowledged_install: true,
    scope: 'this-project',
  };
  const tmp = `${consentPath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(record, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, consentPath(projectRoot));
}

export async function readProjectConsent(projectRoot: string): Promise<ProjectConsent> {
  const raw = await readFile(consentPath(projectRoot), 'utf8');
  return JSON.parse(raw) as ProjectConsent;
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/unit/consent.test.ts
git add packages/plugin/src/consent.ts packages/plugin/tests/unit/consent.test.ts
git commit -m "feat(plugin): consent module — install-ack + per-project consent.json"
```

---

### Task 9: `log.ts` — NDJSON log writer and reader

**Files:**
- Create: `packages/plugin/src/log.ts`
- Create: `packages/plugin/tests/unit/log.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  appendLogEvent,
  readLogEvents,
  latestEvent,
  latestFailureTimestamp,
  type LogEvent,
} from '../../src/log.js';

describe('log', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-log-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('readLogEvents returns [] when no log for the session', async () => {
    expect(await readLogEvents(tmp, 'sess-none')).toEqual([]);
  });

  it('appendLogEvent creates the logs dir + file and reads back round-trip', async () => {
    const ev: LogEvent = { kind: 'spawned_at', session_id: 'sess-1', timestamp: '2026-04-21T10:00:00Z' };
    await appendLogEvent(tmp, 'sess-1', ev);
    const events = await readLogEvents(tmp, 'sess-1');
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual(ev);
  });

  it('appendLogEvent preserves order', async () => {
    await appendLogEvent(tmp, 'sess-2', { kind: 'spawned_at', session_id: 'sess-2', timestamp: 't1' });
    await appendLogEvent(tmp, 'sess-2', { kind: 'worker_started', session_id: 'sess-2', timestamp: 't2' });
    await appendLogEvent(tmp, 'sess-2', { kind: 'worker_success', session_id: 'sess-2', timestamp: 't3', concept_count: 1, unknown_count: 0, elapsed_ms: 30 });
    const events = await readLogEvents(tmp, 'sess-2');
    expect(events.map((e) => e.kind)).toEqual(['spawned_at', 'worker_started', 'worker_success']);
  });

  it('latestEvent returns the most recent event', async () => {
    await appendLogEvent(tmp, 'sess-3', { kind: 'spawned_at', session_id: 'sess-3', timestamp: 't1' });
    await appendLogEvent(tmp, 'sess-3', { kind: 'worker_started', session_id: 'sess-3', timestamp: 't2' });
    const latest = await latestEvent(tmp, 'sess-3');
    expect(latest?.kind).toBe('worker_started');
  });

  it('latestFailureTimestamp scans all logs dirs and returns the most recent worker_failure timestamp', async () => {
    await appendLogEvent(tmp, 'sess-a', { kind: 'worker_success', session_id: 'sess-a', timestamp: '2026-04-20T10:00:00Z', concept_count: 0, unknown_count: 0, elapsed_ms: 1 });
    await appendLogEvent(tmp, 'sess-b', { kind: 'worker_failure', session_id: 'sess-b', timestamp: '2026-04-21T11:00:00Z', error_name: 'RefinerFailure', message: 'x', elapsed_ms: 1 });
    await appendLogEvent(tmp, 'sess-c', { kind: 'worker_failure', session_id: 'sess-c', timestamp: '2026-04-21T12:00:00Z', error_name: 'RefinerFailure', message: 'y', elapsed_ms: 1 });
    const ts = await latestFailureTimestamp(tmp);
    expect(ts).toBe('2026-04-21T12:00:00Z');
  });

  it('latestFailureTimestamp returns null when no failures', async () => {
    expect(await latestFailureTimestamp(tmp)).toBeNull();
  });
});
```

- [ ] **Step 2: Implement `log.ts`**

```ts
import { mkdir, readFile, appendFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logsDir, logFilePath } from './plugin-paths.js';

export type LogEvent =
  | { kind: 'spawned_at'; session_id: string; timestamp: string; transcript_path?: string }
  | { kind: 'worker_started'; session_id: string; timestamp: string }
  | { kind: 'worker_success'; session_id: string; timestamp: string; concept_count: number; unknown_count: number; elapsed_ms: number }
  | { kind: 'worker_failure'; session_id: string; timestamp: string; error_name: string; message: string; elapsed_ms: number };

export async function appendLogEvent(projectRoot: string, sessionId: string, event: LogEvent): Promise<void> {
  await mkdir(logsDir(projectRoot), { recursive: true });
  await appendFile(logFilePath(projectRoot, sessionId), JSON.stringify(event) + '\n', 'utf8');
}

export async function readLogEvents(projectRoot: string, sessionId: string): Promise<LogEvent[]> {
  try {
    const raw = await readFile(logFilePath(projectRoot, sessionId), 'utf8');
    return raw.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as LogEvent);
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return [];
    throw err;
  }
}

export async function latestEvent(projectRoot: string, sessionId: string): Promise<LogEvent | null> {
  const events = await readLogEvents(projectRoot, sessionId);
  return events.length > 0 ? events[events.length - 1]! : null;
}

export async function latestFailureTimestamp(projectRoot: string): Promise<string | null> {
  let entries: string[] = [];
  try { entries = await readdir(logsDir(projectRoot)); } catch { return null; }
  let latest: string | null = null;
  for (const entry of entries) {
    if (!entry.endsWith('.log')) continue;
    const sessionId = entry.slice(0, -4);
    const events = await readLogEvents(projectRoot, sessionId);
    for (const ev of events) {
      if (ev.kind === 'worker_failure') {
        if (!latest || ev.timestamp > latest) latest = ev.timestamp;
      }
    }
  }
  return latest;
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/unit/log.test.ts
git add packages/plugin/src/log.ts packages/plugin/tests/unit/log.test.ts
git commit -m "feat(plugin): NDJSON log writer + reader + failure-timestamp scanner"
```

---

### Task 10: `lock.ts` — per-project file lock with staleness reclaim

**Files:**
- Create: `packages/plugin/src/lock.ts`
- Create: `packages/plugin/tests/unit/lock.test.ts`

- [ ] **Step 1: Write failing tests**

Covers:
1. `tryAcquireLock` returns `true` when no lock exists and writes the lock file.
2. Second `tryAcquireLock` on the same project returns `false`.
3. `releaseLock` removes the file.
4. After release, the next `tryAcquireLock` succeeds.
5. Staleness: a lock file older than 30 min AND whose pid is not running is reclaimed by `tryAcquireLock`.
6. Staleness: a lock file older than 30 min but whose pid IS running is NOT reclaimed.
7. `readLock` returns the structured contents or null.

Use `process.pid` for the running-pid case; use a very-high unlikely-to-exist pid (e.g., 99999999) for the dead-pid case.

Write the test cases in standard vitest style; follow the pattern of `log.test.ts` for tmpdir lifecycle.

- [ ] **Step 2: Implement `lock.ts`**

```ts
import { mkdir, writeFile, readFile, unlink, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analysisLockPath, fosDir } from './plugin-paths.js';

export interface LockRecord {
  pid: number;
  acquired_at: string;
  session_id: string;
}

const STALE_AFTER_MS = 30 * 60 * 1000; // 30 minutes

function pidExists(pid: number): boolean {
  try {
    // kill(pid, 0) is the cross-platform "does this pid exist" probe.
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as { code?: string }).code === 'EPERM';
  }
}

export async function readLock(projectRoot: string): Promise<LockRecord | null> {
  try {
    const raw = await readFile(analysisLockPath(projectRoot), 'utf8');
    return JSON.parse(raw) as LockRecord;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return null;
    throw err;
  }
}

async function isLockStale(projectRoot: string, existing: LockRecord, now: Date): Promise<boolean> {
  try {
    const st = await stat(analysisLockPath(projectRoot));
    const age = now.getTime() - st.mtime.getTime();
    if (age < STALE_AFTER_MS) return false;
  } catch {
    return false;
  }
  return !pidExists(existing.pid);
}

export async function tryAcquireLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date } = {},
): Promise<boolean> {
  const now = (opts.now ?? (() => new Date()))();
  const existing = await readLock(projectRoot);
  if (existing !== null && !(await isLockStale(projectRoot, existing, now))) return false;

  await mkdir(dirname(analysisLockPath(projectRoot)), { recursive: true });
  const full: LockRecord = { ...record, acquired_at: now.toISOString() };
  const tmp = `${analysisLockPath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(full, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, analysisLockPath(projectRoot));
  return true;
}

export async function releaseLock(projectRoot: string): Promise<void> {
  try { await unlink(analysisLockPath(projectRoot)); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/unit/lock.test.ts
git add packages/plugin/src/lock.ts packages/plugin/tests/unit/lock.test.ts
git commit -m "feat(plugin): analysis.lock helpers with staleness reclaim"
```

---

### Task 11: `discover-project.ts` — project root + Claude Code session resolution

**Files:**
- Create: `packages/plugin/src/discover-project.ts`
- Create: `packages/plugin/tests/unit/discover-project.test.ts`

Project-root discovery strategy: walk up from `cwd` looking for `.git/` or `.comprehension/`. First match wins. If neither found, use `cwd` itself. (Matches Plan 1's open-question resolution — uses git repo root when present.)

Claude-Code-project-hash discovery: scan `~/.claude/projects/<hash>/*.jsonl` and match the first event's `cwd` against the probe-chosen project root. Return the `<hash>` of the first match, or null.

- [ ] **Step 1: Write failing tests** for:
  1. `discoverProjectRoot` finds `.git/` parent
  2. `discoverProjectRoot` finds `.comprehension/` parent
  3. `discoverProjectRoot` falls back to cwd when neither exists
  4. `findClaudeCodeProjectHash` returns the hash directory whose first JSONL event's `cwd` matches the project root
  5. `findClaudeCodeProjectHash` returns null when no match

Use tmpdirs with contrived `.claude/projects/` layouts for (4)/(5).

- [ ] **Step 2: Implement `discover-project.ts`**

```ts
import { access, readdir, readFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, dirname, resolve } from 'node:path';

async function exists(p: string): Promise<boolean> {
  try { await access(p); return true; } catch { return false; }
}

export async function discoverProjectRoot(cwd: string): Promise<string> {
  let current = resolve(cwd);
  // walk up at most 40 levels
  for (let i = 0; i < 40; i++) {
    if (await exists(join(current, '.git')) || await exists(join(current, '.comprehension'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(cwd);
}

export async function findClaudeCodeProjectHash(
  projectRoot: string,
  opts: { claudeProjectsDir?: string } = {},
): Promise<string | null> {
  const dir = opts.claudeProjectsDir ?? join(homedir(), '.claude', 'projects');
  let hashes: string[] = [];
  try { hashes = await readdir(dir); } catch { return null; }

  const wantNormalized = resolve(projectRoot).toLowerCase();

  for (const hash of hashes) {
    const hashDir = join(dir, hash);
    let files: string[] = [];
    try { const st = await stat(hashDir); if (!st.isDirectory()) continue; files = await readdir(hashDir); }
    catch { continue; }
    const jsonl = files.find((f) => f.endsWith('.jsonl'));
    if (!jsonl) continue;
    try {
      const content = await readFile(join(hashDir, jsonl), 'utf8');
      const firstLine = content.split('\n', 1)[0]!;
      const parsed = JSON.parse(firstLine) as { cwd?: string };
      if (parsed.cwd && resolve(parsed.cwd).toLowerCase() === wantNormalized) return hash;
    } catch { /* skip */ }
  }
  return null;
}

export interface SessionContext {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string;
}

/**
 * Build a SessionContext from whatever payload Claude Code passes to hooks.
 * The exact payload shape is documented in probe-findings.md — this function
 * accepts a superset (stdin JSON, argv, env) and normalizes.
 */
export function sessionContextFromPayload(payload: {
  sessionId?: string;
  transcriptPath?: string;
  cwd?: string;
  projectRoot: string;
}): SessionContext {
  return {
    projectRoot: payload.projectRoot,
    sessionId: payload.sessionId ?? 'unknown-session',
    transcriptPath: payload.transcriptPath ?? '',
  };
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/unit/discover-project.test.ts
git add packages/plugin/src/discover-project.ts packages/plugin/tests/unit/discover-project.test.ts
git commit -m "feat(plugin): project-root + Claude Code project-hash discovery"
```

---

## Phase 3 — Worker

### Task 12: `worker/analyze-worker.ts` — detached subprocess entry

**Files:**
- Modify: `packages/plugin/src/worker/analyze-worker.ts` (replace the Phase 1 stub)
- Create: `packages/plugin/tests/integration/worker-chain.test.ts`

- [ ] **Step 1: Write the integration test** for worker behavior. Since the worker is a process entry (runs from argv), tests drive it in-process by importing and invoking `runWorker()` directly.

Test cases:
1. Happy path: worker runs `analyzeSession` + `rebuildProjectView`, writes `worker_started` + `worker_success` events, releases the lock.
2. Refiner failure: worker writes `worker_started` + `worker_failure`, still releases the lock.
3. Pending drain: after a success, if `pending.json` has an entry, the worker spawns a fresh child process for that session. (Test with a mocked spawner.)
4. Pending drain: empty queue → no spawn.

Use injected `analyzeSession` and `rebuildProjectView` fakes (import from `@fos/core` and mock via vitest) so the test doesn't call real `claude -p`.

- [ ] **Step 2: Implement `worker/analyze-worker.ts`**

```ts
import { spawn } from 'node:child_process';
import { readFile, writeFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { analyzeSession, rebuildProjectView } from '@fos/core';
import { analysisLockPath, pendingQueuePath } from './../plugin-paths.js';
import { appendLogEvent } from './../log.js';
import { releaseLock } from './../lock.js';

export interface WorkerArgs {
  projectRoot: string;
  transcriptPath: string;
  sessionId: string;
  now?: () => Date;
  // test seams — default to real implementations.
  analyzeSessionImpl?: typeof analyzeSession;
  rebuildImpl?: typeof rebuildProjectView;
  spawnChild?: (args: { projectRoot: string; transcriptPath: string; sessionId: string }) => void;
}

interface PendingQueueFile { queue: Array<{ session_id: string; transcript_path: string; queued_at: string }>; }

async function readPending(projectRoot: string): Promise<PendingQueueFile> {
  try {
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    return JSON.parse(raw) as PendingQueueFile;
  } catch (err) {
    if ((err as { code?: string }).code === 'ENOENT') return { queue: [] };
    throw err;
  }
}

async function writePending(projectRoot: string, q: PendingQueueFile): Promise<void> {
  const tmp = `${pendingQueuePath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(q, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, pendingQueuePath(projectRoot));
}

function spawnChildDefault(args: { projectRoot: string; transcriptPath: string; sessionId: string }): void {
  // The worker file's own URL is what we re-invoke.
  const selfUrl = import.meta.url;
  const selfPath = fileURLToPath(selfUrl);
  spawn('node', [selfPath, args.projectRoot, args.transcriptPath, args.sessionId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

async function drainOnePending(projectRoot: string, spawnChild: WorkerArgs['spawnChild']): Promise<void> {
  const pending = await readPending(projectRoot);
  if (pending.queue.length === 0) return;
  const next = pending.queue.shift()!;
  await writePending(projectRoot, pending);
  (spawnChild ?? spawnChildDefault)({
    projectRoot,
    transcriptPath: next.transcript_path,
    sessionId: next.session_id,
  });
}

export async function runWorker(args: WorkerArgs): Promise<void> {
  const now = args.now ?? (() => new Date());
  const started = now().toISOString();
  const analyze = args.analyzeSessionImpl ?? analyzeSession;
  const rebuild = args.rebuildImpl ?? rebuildProjectView;

  await appendLogEvent(args.projectRoot, args.sessionId, {
    kind: 'worker_started',
    session_id: args.sessionId,
    timestamp: started,
  });

  const startedAt = now().getTime();
  try {
    await analyze({
      projectRoot: args.projectRoot,
      transcriptPath: args.transcriptPath,
      sessionId: args.sessionId,
      now,
    });
    await rebuild({ projectRoot: args.projectRoot, now });
    await appendLogEvent(args.projectRoot, args.sessionId, {
      kind: 'worker_success',
      session_id: args.sessionId,
      timestamp: now().toISOString(),
      concept_count: 0,     // will be populated from analyze result in a follow-up
      unknown_count: 0,
      elapsed_ms: now().getTime() - startedAt,
    });
  } catch (err) {
    const e = err as Error;
    await appendLogEvent(args.projectRoot, args.sessionId, {
      kind: 'worker_failure',
      session_id: args.sessionId,
      timestamp: now().toISOString(),
      error_name: e.name || 'Error',
      message: e.message || String(err),
      elapsed_ms: now().getTime() - startedAt,
    });
  }

  await releaseLock(args.projectRoot);
  await drainOnePending(args.projectRoot, args.spawnChild);
}

// CLI entry: node dist/worker/analyze-worker.js <projectRoot> <transcriptPath> <sessionId>
if (import.meta.url === `file://${process.argv[1]}`) {
  const [, , projectRoot, transcriptPath, sessionId] = process.argv;
  if (!projectRoot || !transcriptPath || !sessionId) {
    console.error('usage: analyze-worker <projectRoot> <transcriptPath> <sessionId>');
    process.exit(2);
  }
  runWorker({ projectRoot, transcriptPath, sessionId }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
```

**Note:** The `concept_count`/`unknown_count` being hardcoded to 0 in `worker_success` is a known-simplification for this task. Task 22's integration test will drive the real counts through the worker's return path. If the implementer wants to thread them through now, they can change `analyze` to return the counts and populate them here.

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/integration/worker-chain.test.ts
git add packages/plugin/src/worker/analyze-worker.ts packages/plugin/tests/integration/worker-chain.test.ts
git commit -m "feat(plugin): analyze-worker with pending-queue chain + failure path"
```

---

## Phase 4 — Stop Hook

### Task 13: `hooks/stop.ts` — detach gate

**Files:**
- Modify: `packages/plugin/src/hooks/stop.ts` (replace stub)
- Create: `packages/plugin/tests/hooks/stop.test.ts`

Hook behavior per spec §4.3:
1. Parse Claude Code's hook-event payload (probe findings doc is ground truth for payload shape).
2. Discover project root.
3. Silent exit 0 if project has no consent.json.
4. Try-acquire the lock. If held, append to pending.json and exit 0.
5. Write `spawned_at` event to the session's log.
6. Spawn worker detached. Exit 0 immediately.

- [ ] **Step 1: Write failing tests**. Hooks take the `{projectRoot, sessionId, transcriptPath, now, spawnChild, homeOverride}` pattern so they're fully testable in-process.

Cases:
1. No consent → `run` returns exit 0, no lock acquired, no log written.
2. Consent + no lock → lock acquired, `spawned_at` log written, `spawnChild` called once with right args.
3. Consent + lock held → pending.json grows by one, no spawn.
4. Consent + stale lock → lock reclaimed, spawn proceeds.

- [ ] **Step 2: Implement `hooks/stop.ts`**

```ts
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { hasProjectConsent } from './../consent.js';
import { tryAcquireLock } from './../lock.js';
import { appendLogEvent } from './../log.js';
import { pendingQueuePath } from './../plugin-paths.js';

export interface StopArgs {
  projectRoot: string;
  sessionId: string;
  transcriptPath: string;
  now?: () => Date;
  spawnChild?: (args: { projectRoot: string; transcriptPath: string; sessionId: string }) => void;
  homeOverride?: string;
}

async function queuePending(
  projectRoot: string,
  sessionId: string,
  transcriptPath: string,
  queuedAt: string,
): Promise<void> {
  let current: { queue: Array<{ session_id: string; transcript_path: string; queued_at: string }> } = { queue: [] };
  try {
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    current = JSON.parse(raw);
  } catch (err) {
    if ((err as { code?: string }).code !== 'ENOENT') throw err;
  }
  current.queue.push({ session_id: sessionId, transcript_path: transcriptPath, queued_at: queuedAt });
  const { mkdir } = await import('node:fs/promises');
  await mkdir(dirname(pendingQueuePath(projectRoot)), { recursive: true });
  const tmp = `${pendingQueuePath(projectRoot)}.tmp`;
  await writeFile(tmp, JSON.stringify(current, null, 2), 'utf8');
  const { rename } = await import('node:fs/promises');
  await rename(tmp, pendingQueuePath(projectRoot));
}

function spawnChildDefault(args: { projectRoot: string; transcriptPath: string; sessionId: string }): void {
  const selfPath = fileURLToPath(import.meta.url);
  const workerPath = resolve(dirname(selfPath), '..', 'worker', 'analyze-worker.js');
  spawn('node', [workerPath, args.projectRoot, args.transcriptPath, args.sessionId], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  }).unref();
}

export async function runStop(args: StopArgs): Promise<number> {
  const now = args.now ?? (() => new Date());
  if (!(await hasProjectConsent(args.projectRoot))) return 0;

  const acquired = await tryAcquireLock(args.projectRoot, {
    pid: process.pid,
    session_id: args.sessionId,
  }, { now });

  const spawnChild = args.spawnChild ?? spawnChildDefault;

  if (!acquired) {
    await queuePending(args.projectRoot, args.sessionId, args.transcriptPath, now().toISOString());
    return 0;
  }

  await appendLogEvent(args.projectRoot, args.sessionId, {
    kind: 'spawned_at',
    session_id: args.sessionId,
    timestamp: now().toISOString(),
    transcript_path: args.transcriptPath,
  });

  spawnChild({
    projectRoot: args.projectRoot,
    transcriptPath: args.transcriptPath,
    sessionId: args.sessionId,
  });

  return 0;
}

/** CLI entry invoked by Claude Code. Payload parsing per probe findings. */
if (import.meta.url === `file://${process.argv[1]}`) {
  // Payload delivery mechanism (stdin JSON / argv / env) is resolved in Phase 0;
  // adjust this parse block to match probe-findings.md.
  (async () => {
    const { discoverProjectRoot, sessionContextFromPayload } = await import('../discover-project.js');
    const payload = await readPayloadFromClaudeCode(); // implement based on probe findings
    const projectRoot = await discoverProjectRoot(payload.cwd ?? process.cwd());
    const ctx = sessionContextFromPayload({ ...payload, projectRoot });
    const code = await runStop(ctx);
    process.exit(code);
  })().catch((err) => {
    // Failing silently is safer than blocking Claude Code shutdown.
    try {
      const { appendFileSync } = require('node:fs');
      appendFileSync(process.env.HOME + '/.fos-plugin-crash.log', String(err) + '\n');
    } catch { /* ignore */ }
    process.exit(0);
  });
}

// Placeholder — implement based on probe findings in Phase 0.
// Typical shapes: JSON on stdin, or a --payload argv flag with JSON, or env vars.
async function readPayloadFromClaudeCode(): Promise<{ sessionId?: string; transcriptPath?: string; cwd?: string }> {
  // TODO: replace with the real payload parser after Phase 0 findings are written.
  throw new Error('readPayloadFromClaudeCode must be implemented from probe findings');
}
```

**Important note on `readPayloadFromClaudeCode`:** Phase 0's findings doc should specify the payload shape. When implementing Task 13, replace the `throw new Error(...)` with the real parser (stdin JSON / argv / env / combination). Commit message should reference probe findings.

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/hooks/stop.test.ts
git add packages/plugin/src/hooks/stop.ts packages/plugin/tests/hooks/stop.test.ts
git commit -m "feat(plugin): Stop hook — consent-gated detach with pending queue"
```

---

## Phase 5 — SessionStart Hook

### Task 14: `hooks/session-start.ts` — message-priority picker

**Files:**
- Modify: `packages/plugin/src/hooks/session-start.ts`
- Create: `packages/plugin/tests/hooks/session-start.test.ts`

Message-priority order (exactly as spec §4.5, preserve this ordering verbatim):

1. `failure_seen` (failure log after `acked_at`)
2. `stalled_detach` (`spawned_at` > 5 min ago with no `worker_started`)
3. `pending > 0` (pending.json queue length)
4. `first_session` (no session files yet)
5. `running` (lock exists and none of the above)
6. silent

- [ ] **Step 1: Write failing tests** — one test per message priority state, plus the "silent" case. Mock the project state (create files in tmp) to trigger each branch.

- [ ] **Step 2: Implement `hooks/session-start.ts`**

```ts
import { readFile, readdir, stat } from 'node:fs/promises';
import { hasProjectConsent } from './../consent.js';
import { readLock } from './../lock.js';
import { latestFailureTimestamp, readLogEvents } from './../log.js';
import {
  sessionsDir, ackedAtPath, pendingQueuePath, logsDir,
} from './../plugin-paths.js';

const FIVE_MINUTES_MS = 5 * 60 * 1000;

async function ackedAtMtime(projectRoot: string): Promise<Date | null> {
  try { return (await stat(ackedAtPath(projectRoot))).mtime; } catch { return null; }
}

async function pendingQueueLength(projectRoot: string): Promise<number> {
  try {
    const raw = await readFile(pendingQueuePath(projectRoot), 'utf8');
    const parsed = JSON.parse(raw) as { queue: unknown[] };
    return parsed.queue.length;
  } catch { return 0; }
}

async function hasAnalyzedSessions(projectRoot: string): Promise<boolean> {
  try {
    const entries = await readdir(sessionsDir(projectRoot));
    return entries.some((e) => e.endsWith('.md'));
  } catch { return false; }
}

async function findStalledDetach(projectRoot: string, now: Date): Promise<boolean> {
  let entries: string[] = [];
  try { entries = await readdir(logsDir(projectRoot)); } catch { return false; }
  for (const entry of entries) {
    if (!entry.endsWith('.log')) continue;
    const sessionId = entry.slice(0, -4);
    const events = await readLogEvents(projectRoot, sessionId);
    const hasSpawn = events.find((e) => e.kind === 'spawned_at');
    const hasStart = events.find((e) => e.kind === 'worker_started');
    const hasTerminal = events.find((e) => e.kind === 'worker_success' || e.kind === 'worker_failure');
    if (hasSpawn && !hasStart && !hasTerminal) {
      const age = now.getTime() - new Date(hasSpawn.timestamp).getTime();
      if (age > FIVE_MINUTES_MS) return true;
    }
  }
  return false;
}

export interface SessionStartArgs {
  projectRoot: string;
  now?: () => Date;
}

export async function pickSessionStartMessage(args: SessionStartArgs): Promise<string | null> {
  const now = (args.now ?? (() => new Date()))();
  if (!(await hasProjectConsent(args.projectRoot))) return null;

  const lastFail = await latestFailureTimestamp(args.projectRoot);
  const ackedMtime = await ackedAtMtime(args.projectRoot);
  const failureSeen = !!lastFail && (!ackedMtime || new Date(lastFail) > ackedMtime);
  if (failureSeen) return '⚠ Last FOS analysis failed — run /comprehend status to see why.';

  if (await findStalledDetach(args.projectRoot, now)) {
    return '⚠ FOS worker appears stalled — run /comprehend status.';
  }

  const pending = await pendingQueueLength(args.projectRoot);
  if (pending > 0) return `FOS: ${pending} session(s) queued, analysis running in background.`;

  if (!(await hasAnalyzedSessions(args.projectRoot))) {
    return 'FOS: opted in but no sessions analyzed yet — your first session will be analyzed on Stop.';
  }

  const lock = await readLock(args.projectRoot);
  if (lock) {
    const since = Math.floor((now.getTime() - new Date(lock.acquired_at).getTime()) / 1000);
    return `FOS: background analysis running for ${since}s.`;
  }

  return null;
}

export async function runSessionStart(args: SessionStartArgs): Promise<number> {
  const msg = await pickSessionStartMessage(args);
  if (msg) process.stdout.write(msg + '\n');
  return 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    const { discoverProjectRoot } = await import('../discover-project.js');
    const projectRoot = await discoverProjectRoot(process.cwd());
    const code = await runSessionStart({ projectRoot });
    process.exit(code);
  })().catch(() => process.exit(0));
}
```

- [ ] **Step 3: Run tests + commit**

```bash
pnpm --filter @fos/plugin test tests/hooks/session-start.test.ts
git add packages/plugin/src/hooks/session-start.ts packages/plugin/tests/hooks/session-start.test.ts
git commit -m "feat(plugin): SessionStart hook — minimal actionable message picker"
```

---

## Phase 6 — Commands **[REVISED post-probe]**

Each of Tasks 15–18 is now a **pair**: a markdown prompt template under `commands/<name>.md` + a CLI subcommand under `src/cli/commands/<name>.ts`. The markdown drives Claude; the CLI does the work. Tests cover the CLI (unit + integration). The markdown is asserted to exist and be non-empty via the smoke test (Task 21).

**General markdown template shape** (for reference — adapt per command):

```markdown
---
description: "One-liner shown in Claude Code's command listing"
---

You are helping the user with the FOS comprehension plugin.

The user ran `/comprehend-<name>`. To execute this command:

1. [Optional probe step: invoke the CLI's `--show-*` mode via Bash to gather state.]
2. [Optional user-input step: call `AskUserQuestion` with appropriate options.]
3. Invoke the CLI's real action via Bash:
   `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" <subcommand> [args]`
4. Present the output to the user in a clear summary.

Never bypass the CLI — all state mutations go through it.
```

### Task 15: `/comprehend init`

**Files:**
- Create: `packages/plugin/commands/comprehend-init.md`
- Modify: `packages/plugin/src/cli/commands/comprehend-init.ts` (replace Phase 1 stub)
- Create: `packages/plugin/tests/cli/commands/comprehend-init.test.ts`

**Markdown (`commands/comprehend-init.md`)** — tells Claude to:

1. Bash-invoke `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" init --show-consent` and parse the returned JSON (`{install_ack, consent_exists, estimated_cost_usd_low, estimated_cost_usd_high, backfill_count}`).
2. If `install_ack: false`: print a clear error and stop.
3. If `consent_exists: true`: report current opt-in status and stop (idempotent path).
4. Otherwise: use `AskUserQuestion` with 3 options: "Accept", "Accept, skip backfill", "Decline".
5. Translate the choice to `node bin.js init --accept [--skip-backfill]` or a no-op, and report the result.

**CLI subcommand (`src/cli/commands/comprehend-init.ts`)** — real behavior:

- `--show-consent`: probe install-ack + existing consent, derive backfill count from `discoverSessions`, derive cost from `estimateCost`, print one-line JSON, exit 0.
- `--accept`: check install-ack (exit 1 if missing); if project already opted in, report and exit 0 (idempotent); else scaffold `.comprehension/` via `runInit`, write `consent.json`, run backfill wizard unless `--skip-backfill`.
- Bare invocation (neither flag): print usage + exit 2.

**TDD steps:**

- [ ] **Step 1: Write failing tests** for the subcommand covering: `--show-consent` with no ack / with ack+consent / with ack+no-consent; `--accept` without ack (exit 1); `--accept` with ack, idempotent case; `--accept` happy path creates consent.json via the existing `writeProjectConsent` helper (from Task 8). Use an injected `runInit` mock to avoid filesystem backfill work.

- [ ] **Step 2: Implement `src/cli/commands/comprehend-init.ts`**.

- [ ] **Step 3: Write `commands/comprehend-init.md`** following the shape above.

- [ ] **Step 4: Run tests + lint + build** — expect the subcommand tests green; `pnpm --filter @fos/plugin build` produces a fresh `dist/cli/bin.js` that responds to `node dist/cli/bin.js init --show-consent` on a tmp project with reasonable JSON.

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/commands/comprehend-init.md packages/plugin/src/cli/commands/comprehend-init.ts packages/plugin/tests/cli/commands/comprehend-init.test.ts
git commit -m "feat(plugin): /comprehend init (markdown template + CLI subcommand)"
```

---

### Task 16: `/comprehend`

**Files:**
- Create: `packages/plugin/commands/comprehend.md`
- Modify: `packages/plugin/src/cli/commands/comprehend.ts`
- Create: `packages/plugin/tests/cli/commands/comprehend.test.ts`

**Markdown (`commands/comprehend.md`)** — tells Claude to:

1. Extract the current session's `transcript_path` and `session_id` from context (available from Claude Code's in-session environment).
2. If the user passed a specific session name as the command arg, use that instead.
3. Bash-invoke `node "${CLAUDE_PLUGIN_ROOT}/dist/cli/bin.js" analyze --transcript-path <path> --session-id <id>`.
4. On exit 0: report the summary to the user.
5. On exit 4 (lock held): tell the user analysis is running in background, suggest `/comprehend status`.

**CLI subcommand (`src/cli/commands/comprehend.ts`)** — matches spec §5.2:

- Reject if project not opted in (exit 3).
- Try-acquire lock for synchronous run; exit 4 if held.
- `--dry-run`: print cost + existing state JSON; exit 0.
- `--force`: re-analyze regardless of existing session file.
- Otherwise: call `analyzeSession` synchronously; on success call `rebuildProjectView`; release lock; exit 0.

**TDD steps** (Step 1 write tests → Step 2 impl → Step 3 markdown → Step 4 verify → Step 5 commit). Tests cover: opt-in gate (exit 3); lock-held gate (exit 4); dry-run JSON shape; happy-path end-to-end with mocked `analyzeSession`.

Commit message: `feat(plugin): /comprehend (markdown template + CLI subcommand)`.

---

### Task 17: `/comprehend status`

**Files:**
- Create: `packages/plugin/commands/comprehend-status.md`
- Modify: `packages/plugin/src/cli/commands/comprehend-status.ts`
- Create: `packages/plugin/tests/cli/commands/comprehend-status.test.ts`

**Markdown** — tells Claude to invoke `node bin.js status [--ack]` via Bash and render the stdout verbatim to the user; if `--ack` was used, confirm "Failures acknowledged."

**CLI subcommand**:
- Read manifest, count sessions (.md) / failed stubs / pending queue / running (lock).
- List the last 3 worker runs from log files (most recent by mtime).
- `--ack`: `touch` `acked_at` file; note how many failures were dismissed.
- `--json`: emit structured JSON instead of human-readable output.
- Always exit 0.

**TDD steps** as Task 15. Tests cover: empty project; a project with one success + one failure; `--ack` updates `acked_at`; `--json` shape.

Commit: `feat(plugin): /comprehend status (markdown template + CLI subcommand)`.

---

### Task 18: `/comprehend backfill`

**Files:**
- Create: `packages/plugin/commands/comprehend-backfill.md`
- Modify: `packages/plugin/src/cli/commands/comprehend-backfill.ts`
- Create: `packages/plugin/tests/cli/commands/comprehend-backfill.test.ts`

**Markdown** — tells Claude to:

1. Bash-invoke `node bin.js backfill --show-preview --recent <N> --model <M>` (default N=all, M=claude-sonnet-4-6).
2. Use `AskUserQuestion` with options "Accept", "Choose a different model", "Choose a different count", "Decline" — based on the preview JSON.
3. On Accept, bash-invoke `node bin.js backfill --yes --recent <N> --model <M>` and stream the output.

**CLI subcommand**:
- Check opt-in (exit 3).
- `--show-preview`: auto-derive `--project-hash` via `findClaudeCodeProjectHash` if missing, compute count + cost, print JSON, exit 0.
- `--yes`: acquire the lock for the whole backfill; iterate `discoverSessions` + `analyzeSession` per session, logging each; rebuild project view at the end; release lock.
- Exit 0 on completion, 1 aborted, 2 if cost-estimate step missing, 3 if not opted in.

**TDD steps** as Task 15. Tests cover: `--show-preview` JSON shape; `--yes` path with 0 discovered sessions; `--yes` path with 2 discovered sessions (mocked analyze).

Commit: `feat(plugin): /comprehend backfill (markdown template + CLI subcommand)`.

---

## Phase 7 — Plugin Manifest + Install Script **[REVISED post-probe]**

### Task 19: `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`, `hooks/hooks.json`

**Files:**
- Create: `packages/plugin/.claude-plugin/plugin.json`
- Create: `packages/plugin/.claude-plugin/marketplace.json`
- Create: `packages/plugin/hooks/hooks.json`

- [ ] **Step 1: Write `.claude-plugin/plugin.json`** (strict closed schema per probe findings §1.2 — commands auto-discovered from `commands/*.md`; hooks config in the separate `hooks/hooks.json` file; no need to list them inline):

```json
{
  "name": "comprehend-fos",
  "version": "0.0.1",
  "description": "Passive comprehension layer for Claude Code sessions — background analysis via the Stop hook.",
  "author": { "name": "FOS" },
  "license": "MIT",
  "keywords": ["claude-code", "comprehension", "analysis"]
}
```

- [ ] **Step 2: Write `.claude-plugin/marketplace.json`** (self-wrapper for local install flow):

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

(Cross-check the exact field names against `probe-findings.md` §1.3 and adjust if it differs.)

- [ ] **Step 3: Write `hooks/hooks.json`**:

```json
{
  "description": "@fos/plugin Stop + SessionStart hook registrations",
  "hooks": {
    "Stop": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/stop.js\"",
            "async": false,
            "timeout": 10
          }
        ]
      }
    ],
    "SessionStart": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/dist/hooks/session-start.js\"",
            "async": false,
            "timeout": 5
          }
        ]
      }
    ]
  }
}
```

Short timeouts because both hooks are designed to return in under 500 ms (Stop detaches the worker; SessionStart is read-only).

- [ ] **Step 4: Validate with the real CLI**

```bash
claude plugins validate packages/plugin
```

Expected: passes (possibly with a warning about missing fields — homepage/repository). If it errors, reconcile against probe findings §5 and fix.

- [ ] **Step 5: Add a convenience install script to `packages/plugin/package.json`**

Add to `scripts`:

```json
{
  "install-local": "claude plugins marketplace add ./ && claude plugins install comprehend-fos@fos-dev"
}
```

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/.claude-plugin packages/plugin/hooks/hooks.json packages/plugin/package.json
git commit -m "feat(plugin): plugin manifest + marketplace wrapper + hooks config"
```

---

### Task 20: Install-time consent script

**Files:**
- Create: `packages/plugin/install/post-install.js`

Behavior per spec §4.1:
- Print data-flow consent text (verbatim from spec).
- If TTY, wait for Enter.
- Touch `~/.claude/fos-install-ack` via `writeInstallAck`.

- [ ] **Step 1: Write post-install.js** (CommonJS — install scripts typically aren't bundled).

```js
#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { createInterface } = require('node:readline/promises');

const CONSENT_TEXT = `
[@fos/plugin v0.0.1]

This plugin analyzes your Claude Code session transcripts in the
background and builds a comprehension graph in each opted-in project's
.comprehension/ directory.

How analysis runs:
 - Invokes your existing \`claude -p\` command (no new API key).
 - Reads transcripts under ~/.claude/projects/.
 - Writes .comprehension/ to each opted-in project.

Data flow: unchanged from your normal Claude Code usage. The plugin
does NOT contact any third-party provider.
`;

async function main() {
  process.stdout.write(CONSENT_TEXT + '\n');
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('Press Enter to acknowledge (installation continues either way) ');
    rl.close();
  }
  const ackDir = join(homedir(), '.claude');
  mkdirSync(ackDir, { recursive: true });
  writeFileSync(join(ackDir, 'fos-install-ack'), '', 'utf8');
  process.stdout.write(
    '\nThe plugin is installed but dormant. Run `/comprehend init` inside a project to opt it in for analysis.\n',
  );
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
```

- [ ] **Step 2: Verify interactively (optional manual step)** — run `node packages/plugin/install/post-install.js < /dev/null` (non-TTY) and confirm the ack file is written and the script exits 0.

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/install/post-install.js
git commit -m "feat(plugin): post-install consent + install-ack script"
```

---

## Phase 8 — Integration Tests

### Task 21: `plugin-smoke.test.ts`

**Files:**
- Create: `packages/plugin/tests/integration/plugin-smoke.test.ts`

- [ ] **Step 1: Write smoke test** that:
  1. Runs `pnpm --filter @fos/plugin build` in a child process (or assumes prebuilt).
  2. Asserts `packages/plugin/.claude-plugin/plugin.json` exists, is valid JSON, and has `name === "comprehend-fos"`.
  3. Asserts `packages/plugin/.claude-plugin/marketplace.json` exists and is valid JSON.
  4. Asserts `packages/plugin/hooks/hooks.json` exists, is valid JSON, and references the expected `${CLAUDE_PLUGIN_ROOT}/dist/hooks/*.js` paths.
  5. Asserts each of the 4 `dist/` entries exists and can be `await import()`-ed without throwing: `dist/hooks/stop.js`, `dist/hooks/session-start.js`, `dist/cli/bin.js`, `dist/worker/analyze-worker.js`.
  6. Asserts each of the 4 `commands/*.md` files exists and is non-empty (> 100 chars to catch accidental placeholders).
  7. Asserts `install/post-install.js` exists.

- [ ] **Step 2: Run + commit**

```bash
pnpm --filter @fos/plugin test tests/integration/plugin-smoke.test.ts
git add packages/plugin/tests/integration/plugin-smoke.test.ts
git commit -m "test(plugin): built-plugin smoke (manifest + entries + install script)"
```

---

### Task 22: Wire `worker_success` counts through from `analyzeSession`

Task 12 left a TODO: `worker_success`'s `concept_count` / `unknown_count` are hardcoded to 0 because `analyzeSession` returns the `SessionArtifact` but the worker discards it. This task threads them through.

**Files:**
- Modify: `packages/plugin/src/worker/analyze-worker.ts`
- Modify: `packages/plugin/tests/integration/worker-chain.test.ts`

- [ ] **Step 1: Update the worker** to capture `analyzeSession`'s return value and use its `concept_count` / `unknown_count`.

- [ ] **Step 2: Update the test** to assert the logged counts match the counts returned by the mocked `analyzeSession`.

- [ ] **Step 3: Commit** `fix(plugin): thread concept/unknown counts from analyzeSession into worker_success log`.

---

## Phase 9 — Release Prep

### Task 23: `@fos/plugin` README

**Files:**
- Create: `packages/plugin/README.md`

- [ ] **Step 1: Write README** covering:

```markdown
# @fos/plugin

Passive comprehension layer for Claude Code. Installs a `Stop` hook +
four slash commands on top of `@fos/core`.

## Install

    claude plugins install file:./packages/plugin

## Per-project opt-in

    (in project root)
    /comprehend init

## Commands

    /comprehend init       — opt this project in
    /comprehend            — re-analyze the current session synchronously
    /comprehend status     — show pending, running, and recent analysis state
    /comprehend backfill   — analyze prior sessions for this project

## What this package is NOT

- A marketplace-ready release (Plan 3 handles publication).
- An alternative to `@fos/core` CLI — it wraps and depends on it.

## Development

    pnpm install
    pnpm --filter @fos/plugin build
    pnpm --filter @fos/plugin test
```

- [ ] **Step 2: Commit** `docs(plugin): README for @fos/plugin`.

---

### Task 24: Final verification + manual dogfood

- [ ] **Step 1: Run the full build + test matrix**

```bash
pnpm build
pnpm test
```

Expected: both `@fos/core` and `@fos/plugin` build + pass.

- [ ] **Step 2: Manual install dogfood**

```bash
cd packages/plugin
pnpm run install-local      # wraps the two-step marketplace flow
# or explicitly:
#   claude plugins marketplace add ./packages/plugin
#   claude plugins install comprehend-fos@fos-dev
```

Confirm:
- The install succeeds; registry at `~/.claude/plugins/installed_plugins.json` has a `comprehend-fos@fos-dev` entry.
- The post-install script ran: consent text appeared + `~/.claude/fos-install-ack` exists.
- `claude plugins validate packages/plugin` passes.

- [ ] **Step 3: Manual opt-in + session**

```bash
mkdir /tmp/plan2-dogfood && cd /tmp/plan2-dogfood
# start a Claude Code session; run /comprehend init; accept; end session
```

Confirm:
- `/comprehend init` succeeds and writes `consent.json`.
- Stop hook fires on session end (check `~/.claude/fos-plugin-crash.log` for errors; inspect `.comprehension/.fos/logs/`).
- After the worker finishes, `.comprehension/sessions/` has a new file.
- Next SessionStart is silent (no failures, no pending).

- [ ] **Step 4: Manual failure-path dogfood**

Force a refiner failure **without** modifying the real `claude` binary (portable across Windows/macOS/Linux):

Option A (preferred — portable): pre-seed `.comprehension/.fos/refiner-prompt.md` with obviously-broken prompt text ("Respond with exactly the string: 'not json'") so the refiner produces unparseable output → `RefinerFailure` after 2 attempts. Remove the override after the test.

Option B: run a session with `PATH=""` prepended so `claude` is not findable → `ClaudeInvokeError`. Easier to unwind (just open a new shell).

After triggering, confirm:
- Worker logs `worker_failure`.
- Next SessionStart shows the ⚠ banner.
- `/comprehend status` lists the failure.
- `/comprehend status --ack` dismisses it.

Undo the induced failure condition (delete the override prompt or exit the PATH-less shell).

- [ ] **Step 5: Write dogfood notes** at `docs/superpowers/plans/2026-04-21-fos-v2-dogfood-notes.md`. Document any bugs + their fixes (apply fixes inline during this step).

- [ ] **Step 6: Commit dogfood notes**

```bash
git add docs/superpowers/plans/2026-04-21-fos-v2-dogfood-notes.md
git commit -m "docs(plans): Plan-2 dogfood notes"
```

---

## Plan 2 Completion Criteria

All of these must be objectively true before Plan 2 is considered complete:

- [ ] Phase 0 probe findings doc exists and has been committed.
- [ ] `pnpm build` succeeds across the workspace with zero TypeScript errors.
- [ ] `pnpm test` passes all unit + integration tests across `@fos/core` and `@fos/plugin`.
- [ ] `packages/plugin/dist/` contains 7 bundled entries (2 hooks + 4 commands + 1 worker).
- [ ] `claude plugins install file:./packages/plugin` succeeds with the consent prompt.
- [ ] `/comprehend init` in a fresh project writes `consent.json` and opts the project in.
- [ ] A real Claude Code session on an opted-in project triggers the Stop hook, spawns a detached worker, and produces a new session file in `.comprehension/sessions/`.
- [ ] A forced refiner failure surfaces at next SessionStart and via `/comprehend status`.
- [ ] `/comprehend status --ack` dismisses the failure banner.
- [ ] Two quick-succession sessions on the same project: first wins the lock, second queues, both eventually produce session files.

When every checkbox above is marked, Plan 2 is complete and Plan 3 (publication + quality hardening) can begin.
