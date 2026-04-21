# FOS v3 — Cleanup + Quality Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Execute the five mechanical work items of Plan 3 — lock primitive refactor, `/comprehend rerun`, consent-flow redesign, golden corpus expansion (3 → 13+), eval harness with baseline.json. End state: a cleaner plugin onboarding flow, a rerun command with 3 modes, atomic locks, 13+ scored golden cases, and a committed baseline recording refiner-v1's current §8.2 numbers.

**Architecture:** Surgical changes on top of the Plan 1 + Plan 2 codebase (merged at `05a3474`). No new packages. Work concentrates in `packages/plugin/src/` (consent, rerun, lock) and `packages/core/tests/golden/` (corpus, metrics, baseline). New `docs/user/data-flow.md`. New `tools/scrub-transcript.mjs`. One new pre-commit script.

**Tech Stack:** No new runtime deps. Node 20+, TypeScript 5.x, ESM, vitest, pnpm workspaces — same as prior plans.

**Related docs:**
- Spec: `docs/superpowers/specs/2026-04-21-fos-plan-3-cleanup-and-quality-infra-design.md`
- Parent product spec: `docs/superpowers/specs/2026-04-20-fos-retrospective-comprehension-layer-design.md`
- Prior plans (merged, reference): Plan 1, Plan 2.

**What this plan produces (end state):**

```bash
# Lock behavior is correct
# A user stress-testing parallel Stop hooks sees clean queue drain, no lock loss.

# New rerun surface
/comprehend-fos:comprehend-rerun             # rebuild-only (no refiner)
/comprehend-fos:comprehend-rerun <id>        # re-analyze one session
/comprehend-fos:comprehend-rerun --all       # re-analyze every session w/ cost preview

# Install + opt-in flow
claude plugins marketplace add ./packages/plugin
claude plugins install comprehend-fos@fos-dev
# First project:
/comprehend-fos:comprehend-init              # consent appears (one time) → project opt-in
# Subsequent projects:
/comprehend-fos:comprehend-init              # consent skipped; project opt-in only

# Quality measurement
pnpm --filter @fos/core eval                 # runs 13+ cases, emits metrics report, checks baseline.json
pnpm --filter @fos/core eval --snapshot      # updates baseline.json
pnpm --filter @fos/core eval --against <ref> # per-case diff vs a committed baseline at git ref
```

**Explicitly NOT in Plan 3:**
- Refiner prompt iteration to hit §8.2 bars (Plan 4).
- Marketplace publication (Plan 4).
- `sideEffects: false` optimization or bundle size reduction.
- Historical-tracking log (`eval-history.jsonl`).
- Terminal injection, fog-of-war, fractal fan-out — Plan vNext+.

**Branch convention:** create `feat/plan-3-cleanup-and-quality` branched from `main`. Merge back via `--no-ff` after the final review passes, same as prior plans.

---

## File Structure

All paths relative to repo root `D:\comprehension-debt\`:

```
packages/
├── core/
│   ├── src/ (unchanged)
│   └── tests/
│       └── golden/
│           ├── corpus/                     # 10 new case dirs added
│           │   ├── sess-01-greeting/       # existing, get tags added
│           │   ├── sess-02-fuzzy/          # existing, get tags added
│           │   ├── sess-03-refine/         # existing, get tags added
│           │   ├── sess-04-terse-user/         # NEW — mined
│           │   ├── sess-05-long-session/       # NEW — mined
│           │   ├── sess-06-multiple-concepts/  # NEW — mined
│           │   ├── sess-07-refactor/           # NEW — mined
│           │   ├── sess-08-debugging/          # NEW — mined
│           │   ├── sess-09-no-concepts/        # NEW — mined (expected empty)
│           │   ├── sess-10-conflicting/        # NEW — synthetic
│           │   ├── sess-11-implicit-reasoning/ # NEW — synthetic
│           │   ├── sess-12-abandoned-path/     # NEW — synthetic
│           │   ├── sess-13-slug-reuse/         # NEW — synthetic
│           │   ├── sess-14-empty-transcript/   # NEW — synthetic (edge case)
│           │   ├── sess-15-tool-heavy/         # NEW — synthetic
│           │   └── sess-16-pure-narrative/     # NEW — synthetic
│           ├── metrics.ts                  # NEW — per-case + aggregate scoring
│           ├── diff.ts                     # NEW — two-run diff module
│           ├── baseline.json               # NEW — committed snapshot
│           ├── eval.test.ts                # MODIFIED — emit metrics, honor baseline
│           ├── expected-schema.ts          # NEW — zod for expected.json (includes tags/difficulty)
│           └── README.md                   # MODIFIED — tag taxonomy + authoring workflow
└── plugin/
    ├── commands/
    │   ├── comprehend-init.md              # MODIFIED — consent-gate block
    │   └── comprehend-rerun.md             # NEW
    ├── install/                            # DELETED entire dir
    │   ├── post-install.js                 # DELETED
    │   └── package.json                    # DELETED
    ├── src/
    │   ├── cli/
    │   │   ├── bin.ts                      # MODIFIED — register rerunCommand
    │   │   └── commands/
    │   │       ├── comprehend-init.ts      # MODIFIED — --show-consent / --accept-machine-consent
    │   │       └── comprehend-rerun.ts     # NEW
    │   └── lock.ts                         # REFACTORED — single acquireExclusiveLock primitive
    └── tests/
        ├── integration/
        │   └── plugin-smoke.test.ts        # MODIFIED — drop install/* assertions
        ├── cli/commands/
        │   ├── comprehend-init.test.ts     # MODIFIED — new consent cases
        │   └── comprehend-rerun.test.ts    # NEW
        └── unit/
            └── lock.test.ts                # REFACTORED — primitive tests + thin consumer tests

docs/
└── user/
    └── data-flow.md                        # NEW — referenced by consent UI

tools/
└── scrub-transcript.mjs                    # NEW — mining utility

.husky/                                     # NEW if missing
└── pre-commit                              # NEW — secret-pattern warning for tests/golden/corpus/*
```

**Design principles:**
1. No new packages.
2. Every change follows the existing module boundaries (paths from `@fos/core`, plugin helpers from `packages/plugin/src/`).
3. Tests colocate with source module (`unit/`, `cli/commands/`, `integration/`, `tests/golden/`).
4. Tooling (scrubber, pre-commit) lives outside packages at repo root.

---

## Phase overview

1. **Phase 1 — Lock primitive refactor** (Tasks 1–2). Foundation.
2. **Phase 2 — `/comprehend rerun`** (Tasks 3–5).
3. **Phase 3 — Consent-flow redesign + data-flow doc** (Tasks 6–8).
4. **Phase 4 — Corpus mining utility + expansion to 13+ cases** (Tasks 9–11). Authoring-heavy.
5. **Phase 5 — Eval harness + baseline** (Tasks 12–15).
6. **Phase 6 — Release prep** (Tasks 16–17). Integration verification + manual dogfood notes.

---

## Phase 1 — Lock Primitive Refactor

### Task 1: Introduce `acquireExclusiveLock` and adapt `tryAcquireLock`

**Files:**
- Modify: `packages/plugin/src/lock.ts`
- Modify: `packages/plugin/tests/unit/lock.test.ts`

The current `tryAcquireLock` uses tmp+rename (racy) for `analysis.lock`. `tryAcquireQueueLock` already uses `open(path, 'wx')` O_EXCL. Refactor to a single primitive.

- [ ] **Step 1: Create branch**

```bash
cd D:/comprehension-debt
git checkout main
git checkout -b feat/plan-3-cleanup-and-quality
```

- [ ] **Step 2: Write a failing stress-test for the primitive**

Append to `tests/unit/lock.test.ts`:

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { acquireExclusiveLock, releaseExclusiveLock } from '../../src/lock.js';

describe('acquireExclusiveLock — exclusivity under concurrent callers', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-lock-primitive-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('only ONE of N concurrent acquirers succeeds', async () => {
    const lockPath = join(tmp, 'test.lock');
    const N = 10;
    const now = () => new Date();
    const attempts = Array.from({ length: N }, (_, i) =>
      acquireExclusiveLock({
        lockPath,
        content: JSON.stringify({ id: i }),
        staleAfterMs: 60_000,
        now,
        pidForStalenessCheck: null,
        maxAttempts: 1,       // no retry — raw contention test
      }),
    );
    const results = await Promise.all(attempts);
    const winners = results.filter(Boolean);
    expect(winners).toHaveLength(1);
  });

  it('next acquirer succeeds after releaseExclusiveLock', async () => {
    const lockPath = join(tmp, 'test.lock');
    const now = () => new Date();
    expect(await acquireExclusiveLock({ lockPath, content: '{}', staleAfterMs: 1000, now, pidForStalenessCheck: null })).toBe(true);
    expect(await acquireExclusiveLock({ lockPath, content: '{}', staleAfterMs: 1000, now, pidForStalenessCheck: null, maxAttempts: 1 })).toBe(false);
    await releaseExclusiveLock(lockPath);
    expect(await acquireExclusiveLock({ lockPath, content: '{}', staleAfterMs: 1000, now, pidForStalenessCheck: null })).toBe(true);
  });

  it('reclaims a stale lock with dead pid', async () => {
    const lockPath = join(tmp, 'test.lock');
    const now1 = () => new Date('2026-04-01T00:00:00Z');
    expect(await acquireExclusiveLock({
      lockPath,
      content: JSON.stringify({ pid: 99999999, acquired_at: now1().toISOString() }),
      staleAfterMs: 60_000,
      now: now1,
      pidForStalenessCheck: 99999999,
    })).toBe(true);
    const now2 = () => new Date('2026-04-01T01:00:00Z');      // one hour later
    expect(await acquireExclusiveLock({
      lockPath,
      content: JSON.stringify({ pid: process.pid, acquired_at: now2().toISOString() }),
      staleAfterMs: 60_000,
      now: now2,
      pidForStalenessCheck: 99999999,   // dead pid — should reclaim
      maxAttempts: 1,
    })).toBe(true);
  });

  it('does NOT reclaim when pidForStalenessCheck is null (queue-lock pattern)', async () => {
    const lockPath = join(tmp, 'test.lock');
    const now1 = () => new Date('2026-04-01T00:00:00Z');
    await acquireExclusiveLock({
      lockPath,
      content: '{}',
      staleAfterMs: 60_000,
      now: now1,
      pidForStalenessCheck: null,
    });
    const now2 = () => new Date('2026-04-01T01:00:00Z');
    // queue-lock staleAfterMs is SMALL (10s); simulate by passing small here
    const reclaimed = await acquireExclusiveLock({
      lockPath,
      content: '{}',
      staleAfterMs: 1000,
      now: now2,
      pidForStalenessCheck: null,
      maxAttempts: 1,
    });
    expect(reclaimed).toBe(true); // time-based stale reclaim is allowed even without pid check
  });
});
```

- [ ] **Step 3: Run test, see FAIL**

```
pnpm --filter @fos/plugin test tests/unit/lock.test.ts
```

Expected: `acquireExclusiveLock` does not exist.

- [ ] **Step 4: Implement the primitive + adapt `tryAcquireLock` and `tryAcquireQueueLock`**

Restructure `packages/plugin/src/lock.ts` so the core logic is in `acquireExclusiveLock`. Rough shape:

```ts
import { open, stat, unlink, readFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { analysisLockPath, fosDir } from './plugin-paths.js';

export interface ExclusiveLockArgs {
  lockPath: string;
  content: string;
  staleAfterMs: number;
  now: () => Date;
  pidForStalenessCheck?: number | null;
  maxAttempts?: number;
  backoffMs?: number;
}

export interface LockRecord { pid: number; acquired_at: string; session_id: string }

function pidExists(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (err) { return (err as { code?: string }).code === 'EPERM'; }
}

async function tryExclusiveCreate(lockPath: string, content: string): Promise<boolean> {
  await mkdir(dirname(lockPath), { recursive: true });
  try {
    const handle = await open(lockPath, 'wx');
    await handle.writeFile(content, 'utf8');
    await handle.close();
    return true;
  } catch (err) {
    if ((err as { code?: string }).code === 'EEXIST') return false;
    throw err;
  }
}

async function isStale(args: { lockPath: string; staleAfterMs: number; now: () => Date; pidForStalenessCheck: number | null | undefined }): Promise<boolean> {
  try {
    const st = await stat(args.lockPath);
    const age = args.now().getTime() - st.mtime.getTime();
    if (age < args.staleAfterMs) return false;
    // age-stale; if caller wants pid liveness, also require dead pid
    if (args.pidForStalenessCheck === null || args.pidForStalenessCheck === undefined) return true;
    return !pidExists(args.pidForStalenessCheck);
  } catch { return false; }
}

export async function acquireExclusiveLock(args: ExclusiveLockArgs): Promise<boolean> {
  const maxAttempts = args.maxAttempts ?? 20;
  const backoffMs = args.backoffMs ?? 15;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    if (await tryExclusiveCreate(args.lockPath, args.content)) return true;

    // exists — check staleness
    if (await isStale({
      lockPath: args.lockPath,
      staleAfterMs: args.staleAfterMs,
      now: args.now,
      pidForStalenessCheck: args.pidForStalenessCheck,
    })) {
      try { await unlink(args.lockPath); } catch { /* ignore */ }
      if (await tryExclusiveCreate(args.lockPath, args.content)) return true;
    }

    if (attempt < maxAttempts - 1) {
      await new Promise((r) => setTimeout(r, backoffMs));
    }
  }
  return false;
}

export async function releaseExclusiveLock(lockPath: string): Promise<void> {
  try { await unlink(lockPath); }
  catch (err) { if ((err as { code?: string }).code !== 'ENOENT') throw err; }
}

// -------- consumer wrappers --------

export async function tryAcquireLock(
  projectRoot: string,
  record: Omit<LockRecord, 'acquired_at'>,
  opts: { now?: () => Date } = {},
): Promise<boolean> {
  const now = opts.now ?? (() => new Date());
  const existing = await readLock(projectRoot);
  return acquireExclusiveLock({
    lockPath: analysisLockPath(projectRoot),
    content: JSON.stringify({ ...record, acquired_at: now().toISOString() }, null, 2),
    staleAfterMs: 30 * 60 * 1000,
    now,
    pidForStalenessCheck: existing?.pid ?? null,
  });
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

export async function releaseLock(projectRoot: string): Promise<void> {
  await releaseExclusiveLock(analysisLockPath(projectRoot));
}

export async function tryAcquireQueueLock(projectRoot: string, opts: { now?: () => Date } = {}): Promise<boolean> {
  const now = opts.now ?? (() => new Date());
  return acquireExclusiveLock({
    lockPath: queueLockPath(projectRoot),
    content: JSON.stringify({ pid: process.pid, acquired_at: now().toISOString() }, null, 2),
    staleAfterMs: 10_000,
    now,
    pidForStalenessCheck: null,
  });
}

function queueLockPath(projectRoot: string): string {
  return `${fosDir(projectRoot)}/queue.lock`;
}

export async function releaseQueueLock(projectRoot: string): Promise<void> {
  await releaseExclusiveLock(queueLockPath(projectRoot));
}
```

(Exact `queueLockPath` helper may already exist in `plugin-paths.ts` — if so, import it rather than redeclaring.)

- [ ] **Step 5: Run tests, verify all pass**

```
pnpm --filter @fos/plugin test tests/unit/lock.test.ts
```

Expected: all old tests pass + the 4 new primitive tests pass.

- [ ] **Step 6: Run full workspace test to catch any consumer breakage**

```
pnpm test
```

Expected: 230+ tests pass unchanged. Build unchanged.

- [ ] **Step 7: Commit**

```bash
git add packages/plugin/src/lock.ts packages/plugin/tests/unit/lock.test.ts
git commit -m "refactor(plugin): single acquireExclusiveLock primitive for both lock types"
```

---

### Task 2: Remove duplicated logic; confirm wrappers

Verify `tryAcquireLock` and `tryAcquireQueueLock` no longer contain any duplicated exclusivity/staleness logic. Grep:

- [ ] **Step 1: Run verification**

```bash
grep -n "open.*'wx'" packages/plugin/src/lock.ts | wc -l   # expect: 0 or 1 (only in acquireExclusiveLock/tryExclusiveCreate)
grep -n "pidExists" packages/plugin/src/lock.ts | wc -l    # expect: 1 (only in isStale helper)
grep -n "mtime.getTime" packages/plugin/src/lock.ts | wc -l # expect: 1 (only in isStale)
```

If any count is above expected, duplication remains — fold back into the primitive.

- [ ] **Step 2: No commit if nothing changed**

If grep shows duplication and you made fixes, amend Task 1's commit:

```bash
git add -u
git commit --amend --no-edit
```

Otherwise skip. Phase 1 is complete.

---

## Phase 2 — `/comprehend rerun`

### Task 3: Stub `rerunCommand` + register in CLI

**Files:**
- Create: `packages/plugin/src/cli/commands/comprehend-rerun.ts`
- Modify: `packages/plugin/src/cli/bin.ts`

Phase 6 of Plan 2 used a stub-then-replace pattern; repeat it here.

- [ ] **Step 1: Write a stub `src/cli/commands/comprehend-rerun.ts`**

```ts
import type { Command } from 'commander';

export function rerunCommand(program: Command): void {
  program
    .command('rerun [sessionId]')
    .description('re-derive project view (no refiner), or re-analyze one/all sessions')
    .option('--all', 'Re-analyze every session on disk')
    .option('--force', 'Skip the "refiner version matches" warning on --all')
    .option('--dry-run', 'Print what would run; no refiner calls')
    .option('--show-preview', 'Emit JSON preview and exit 0')
    .option('--project-root <path>', 'project root', process.cwd())
    .action(() => {
      console.error('[rerun] not yet implemented');
      process.exit(1);
    });
}
```

- [ ] **Step 2: Register in `src/cli/bin.ts`**

Add the import and wire it in:

```ts
import { rerunCommand } from './commands/comprehend-rerun.js';
// ... in runCli():
rerunCommand(program);
```

- [ ] **Step 3: Build + smoke**

```
pnpm --filter @fos/plugin build
node packages/plugin/dist/cli/bin.js --help
```

Expected: `rerun` appears in the subcommand list.

- [ ] **Step 4: Commit**

```bash
git add packages/plugin/src/cli/commands/comprehend-rerun.ts packages/plugin/src/cli/bin.ts
git commit -m "feat(plugin): stub /comprehend rerun subcommand + register"
```

---

### Task 4: Implement rerun modes — bare, `--session`, `--all`

**Files:**
- Modify: `packages/plugin/src/cli/commands/comprehend-rerun.ts`
- Create: `packages/plugin/tests/cli/commands/comprehend-rerun.test.ts`

Each mode routes through existing `@fos/core` + plugin helpers. Use the existing cost estimator from `@fos/core` (`estimateCost`) for previews.

- [ ] **Step 1: Write failing tests** for each mode:

```ts
import { describe, it, expect, vi } from 'vitest';
import { runRerun } from '../../../src/cli/commands/comprehend-rerun.js';
// …set up tmp dir + opt-in + a couple sessions (mirror existing comprehend-init.test style)

describe('runRerun', () => {
  it('bare mode re-runs rebuild only (no refiner)', async () => {
    const invoke = vi.fn();
    await runRerun({ projectRoot, mode: 'rebuild', invoke });
    expect(invoke).not.toHaveBeenCalled();
    // assert graph.html mtime updated
  });

  it('--session re-analyzes ONE session and releases lock', async () => {
    const invoke = vi.fn().mockResolvedValue(JSON.stringify({
      concepts: [{ slug: 'x', name: 'X', kind: 'refined', summary: 's', reasoning: [], depends_on: [], files: [], transcript_refs: [], confidence: 'high' }],
      unknowns: [],
    }));
    const result = await runRerun({ projectRoot, mode: 'session', sessionId: 'sess-1', invoke });
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(result.analyzed).toBe(1);
  });

  it('--all re-analyzes every session and writes backfill_batch log entry', async () => {
    const invoke = vi.fn().mockResolvedValue(validRefinerJson);
    const result = await runRerun({ projectRoot, mode: 'all', confirm: async () => true, invoke });
    expect(invoke.mock.calls.length).toBe(2);   // corpus has 2 sessions
    // assert a backfill_batch log event with mode:'rerun' exists
  });

  it('--all respects --force for same-refiner-version cases', async () => {
    // ...
  });

  it('--show-preview emits structured JSON and exits 0', async () => {
    const payload = await showPreview({ projectRoot, mode: 'all', model: 'claude-sonnet-4-6' });
    expect(payload).toMatchObject({
      mode: 'all',
      count: expect.any(Number),
      estimated_cost_usd_low: expect.any(Number),
      estimated_cost_usd_high: expect.any(Number),
      refiner_version_current: expect.any(String),
      refiner_version_on_sessions: expect.any(Array),
    });
  });

  it('exits 3 if project not opted in (bare)', async () => {
    // ...
  });

  it('exits 4 if lock held for --session', async () => {
    // pre-acquire lock, then runRerun mode: 'session'
  });
});
```

- [ ] **Step 2: Implement `src/cli/commands/comprehend-rerun.ts`**

```ts
import { Command } from 'commander';
import { analyzeSession, rebuildProjectView, readManifest, estimateCost, estimateTokens } from '@fos/core';
import { hasProjectConsent } from '../../consent.js';
import { tryAcquireLock, releaseLock, readLock } from '../../lock.js';
import { appendLogEvent } from '../../log.js';
import { sessionsDir } from '../../plugin-paths.js';
import { readdir, stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';

export interface RerunArgs {
  projectRoot: string;
  mode: 'rebuild' | 'session' | 'all';
  sessionId?: string;
  force?: boolean;
  confirm?: () => Promise<boolean>;
  invoke?: Parameters<typeof analyzeSession>[0]['invoke'];
  now?: () => Date;
}

async function listSessions(projectRoot: string): Promise<Array<{ id: string; path: string; transcriptPath: string; refinerVersion: string }>> {
  const dir = sessionsDir(projectRoot);
  let entries: string[] = [];
  try { entries = await readdir(dir); } catch { return []; }
  const out: Array<{ id: string; path: string; transcriptPath: string; refinerVersion: string }> = [];
  for (const name of entries) {
    if (!name.endsWith('.md')) continue;
    const full = join(dir, name);
    const raw = await readFile(full, 'utf8');
    const idMatch = raw.match(/session_id:\s*(.+)/);
    const transcriptMatch = raw.match(/transcript_path:\s*(.+)/);
    const refinerMatch = raw.match(/refiner_version:\s*(.+)/);
    if (!idMatch || !transcriptMatch) continue;
    out.push({
      id: idMatch[1]!.trim(),
      path: full,
      transcriptPath: transcriptMatch[1]!.trim(),
      refinerVersion: refinerMatch?.[1]?.trim() ?? 'unknown',
    });
  }
  return out;
}

export async function showPreview(args: { projectRoot: string; mode: RerunArgs['mode']; sessionId?: string; model: string }): Promise<{ mode: string; count: number; estimated_cost_usd_low: number; estimated_cost_usd_high: number; refiner_version_current: string; refiner_version_on_sessions: string[]; project_root: string }> {
  const manifest = await readManifest(args.projectRoot);
  const sessions = await listSessions(args.projectRoot);
  const target = args.mode === 'session' && args.sessionId
    ? sessions.filter((s) => s.id === args.sessionId)
    : args.mode === 'all'
      ? sessions
      : [];
  let totalInputTokens = 0;
  for (const s of target) {
    try {
      const raw = await readFile(s.transcriptPath, 'utf8');
      totalInputTokens += estimateTokens(raw.length);
    } catch {
      // transcript may have been deleted; skip
    }
  }
  const cost = estimateCost(totalInputTokens, args.model);
  return {
    mode: args.mode,
    count: target.length,
    estimated_cost_usd_low: cost.usd_low,
    estimated_cost_usd_high: cost.usd_high,
    refiner_version_current: manifest.refiner_version,
    refiner_version_on_sessions: Array.from(new Set(target.map((s) => s.refinerVersion))),
    project_root: args.projectRoot,
  };
}

export interface RerunReport {
  mode: RerunArgs['mode'];
  analyzed: number;
  failed: Array<{ session_id: string; reason: string }>;
  skipped: number;
}

export async function runRerun(args: RerunArgs): Promise<RerunReport> {
  if (args.mode !== 'rebuild') {
    if (!(await hasProjectConsent(args.projectRoot))) {
      throw new Error('Project not opted in; run /comprehend-fos:comprehend-init');
    }
  } else {
    // even bare mode needs opt-in per spec §2.2 opt-in gate
    if (!(await hasProjectConsent(args.projectRoot))) {
      throw new Error('Project not opted in; run /comprehend-fos:comprehend-init');
    }
  }

  const now = args.now ?? (() => new Date());

  if (args.mode === 'rebuild') {
    await rebuildProjectView({ projectRoot: args.projectRoot, now });
    return { mode: 'rebuild', analyzed: 0, failed: [], skipped: 0 };
  }

  if (args.mode === 'session') {
    if (!args.sessionId) throw new Error('--session requires a session id argument');
    const sessions = await listSessions(args.projectRoot);
    const target = sessions.find((s) => s.id === args.sessionId);
    if (!target) throw new Error(`session ${args.sessionId} not found in this project`);

    const acquired = await tryAcquireLock(args.projectRoot, { pid: process.pid, session_id: args.sessionId }, { now });
    if (!acquired) {
      const err: Error & { exitCode?: number } = Object.assign(new Error(`lock held; run /comprehend-fos:comprehend-status`), { exitCode: 4 });
      throw err;
    }
    try {
      await analyzeSession({
        projectRoot: args.projectRoot,
        transcriptPath: target.transcriptPath,
        sessionId: target.id,
        now,
        ...(args.invoke ? { invoke: args.invoke } : {}),
      });
      await rebuildProjectView({ projectRoot: args.projectRoot, now });
      return { mode: 'session', analyzed: 1, failed: [], skipped: 0 };
    } finally {
      await releaseLock(args.projectRoot);
    }
  }

  // mode === 'all'
  const existingLock = await readLock(args.projectRoot);
  if (existingLock !== null) {
    const err: Error & { exitCode?: number } = Object.assign(new Error('lock held'), { exitCode: 4 });
    throw err;
  }
  const ok = args.confirm ? await args.confirm() : true;
  if (!ok) {
    const err: Error & { exitCode?: number } = Object.assign(new Error('cancelled'), { exitCode: 2 });
    throw err;
  }

  const sessions = await listSessions(args.projectRoot);
  const acquired = await tryAcquireLock(args.projectRoot, { pid: process.pid, session_id: '_batch' }, { now });
  if (!acquired) throw Object.assign(new Error('lock held'), { exitCode: 4 });
  const startedAt = now().getTime();
  const failed: Array<{ session_id: string; reason: string }> = [];
  let analyzed = 0;
  try {
    for (const s of sessions) {
      try {
        await analyzeSession({
          projectRoot: args.projectRoot,
          transcriptPath: s.transcriptPath,
          sessionId: s.id,
          now,
          ...(args.invoke ? { invoke: args.invoke } : {}),
        });
        analyzed += 1;
      } catch (err) {
        failed.push({ session_id: s.id, reason: err instanceof Error ? err.message : String(err) });
      }
    }
    await rebuildProjectView({ projectRoot: args.projectRoot, now });
  } finally {
    await releaseLock(args.projectRoot);
  }
  const elapsedMs = now().getTime() - startedAt;
  await appendLogEvent(args.projectRoot, '_batch', {
    kind: 'backfill_batch',
    session_id: '_batch',
    timestamp: now().toISOString(),
    mode: 'rerun',
    analyzed,
    failed: failed.length,
    total_cost_usd: 0, // no aggregate cost tracked per-run; mode distinguishes from backfill
    elapsed_ms: elapsedMs,
  });
  return { mode: 'all', analyzed, failed, skipped: 0 };
}
```

Also wire the commander `action` handler in the same file to call `runRerun` / `showPreview` based on flags, mapping exit codes appropriately.

- [ ] **Step 3: Update `src/log.ts`** to include `mode` in `backfill_batch`

```ts
| { kind: 'backfill_batch'; session_id: '_batch'; timestamp: string;
    mode: 'backfill' | 'rerun';
    analyzed: number; failed: number; total_cost_usd: number; elapsed_ms: number; }
```

(If `mode` was already added at end of Plan 2, confirm it's present; if not, add here and update the existing backfill-write site in `comprehend-backfill.ts` to include `mode: 'backfill'`.)

- [ ] **Step 4: Run tests, see PASS**

```
pnpm --filter @fos/plugin test tests/cli/commands/comprehend-rerun.test.ts
pnpm --filter @fos/plugin test
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/cli/commands/comprehend-rerun.ts packages/plugin/src/log.ts packages/plugin/tests/cli/commands/comprehend-rerun.test.ts
git commit -m "feat(plugin): /comprehend rerun — rebuild / --session / --all"
```

---

### Task 5: Write `comprehend-rerun.md` prompt template

**Files:**
- Create: `packages/plugin/commands/comprehend-rerun.md`

Follow the backfill-template pattern: Bash `--show-preview`, `AskUserQuestion` for mode selection, Bash chosen mode.

- [ ] **Step 1: Write the markdown**

```markdown
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
```

- [ ] **Step 2: Build + smoke**

```
pnpm --filter @fos/plugin build
```

Confirm `dist/cli/bin.js rerun --help` lists all flags. No test needed for the markdown itself beyond Phase 6's smoke check.

- [ ] **Step 3: Commit**

```bash
git add packages/plugin/commands/comprehend-rerun.md
git commit -m "feat(plugin): /comprehend rerun markdown prompt template"
```

---

## Phase 3 — Consent-Flow Redesign

### Task 6: Extend init CLI — `--show-consent` payload + `--accept-machine-consent`

**Files:**
- Modify: `packages/plugin/src/cli/commands/comprehend-init.ts`
- Modify: `packages/plugin/tests/cli/commands/comprehend-init.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
describe('runInit — consent-flow redesign', () => {
  it('--show-consent emits consent_required_text when install_ack missing', async () => {
    // delete ~/.claude/fos-install-ack (via HOME override)
    const payload = await showConsent({ projectRoot, homeOverride: tmpHome });
    expect(payload.install_ack).toBe(false);
    expect(payload.consent_required_text).toBeTruthy();
    expect(payload.consent_required_text).toContain('docs/user/data-flow.md');
  });

  it('--show-consent returns null consent text when ack present', async () => {
    await writeInstallAck({ homeOverride: tmpHome });
    const payload = await showConsent({ projectRoot, homeOverride: tmpHome });
    expect(payload.install_ack).toBe(true);
    expect(payload.consent_required_text).toBeNull();
  });

  it('--accept without --accept-machine-consent rejects when ack missing', async () => {
    await expect(runInit({ projectRoot, accept: true, homeOverride: tmpHome })).rejects.toThrow(/install.*ack/);
  });

  it('--accept --accept-machine-consent touches ack file and proceeds', async () => {
    await runInit({ projectRoot, accept: true, acceptMachineConsent: true, homeOverride: tmpHome });
    expect(await hasInstallAck({ homeOverride: tmpHome })).toBe(true);
    expect(await hasProjectConsent(projectRoot)).toBe(true);
  });

  it('--accept succeeds when ack already present (no --accept-machine-consent needed)', async () => {
    await writeInstallAck({ homeOverride: tmpHome });
    await runInit({ projectRoot, accept: true, homeOverride: tmpHome });
    expect(await hasProjectConsent(projectRoot)).toBe(true);
  });
});
```

- [ ] **Step 2: Update `comprehend-init.ts`** — extend the `--show-consent` path to include `consent_required_text`:

```ts
const CONSENT_TEXT = `
FOS analyzes your Claude Code session transcripts in the background and
builds a comprehension graph in each opted-in project's .comprehension/
directory.

How analysis runs:
  - Invokes your existing `claude -p` command (no new API key).
  - Reads transcripts under ~/.claude/projects/.
  - Writes .comprehension/ to each opted-in project.

Data flow: unchanged from your normal Claude Code usage. The plugin does
NOT contact any third-party provider.

The full data-flow statement is at \`docs/user/data-flow.md\` inside this
plugin's install directory
(~/.claude/plugins/cache/fos-dev/comprehend-fos/<version>/docs/user/data-flow.md).
`.trim();

// ...in showConsent handler:
const ackPresent = await hasInstallAck(opts);
const payload = {
  install_ack: ackPresent,
  consent_exists: await hasProjectConsent(projectRoot),
  consent_required_text: ackPresent ? null : CONSENT_TEXT,
  estimated_cost_usd_low,
  estimated_cost_usd_high,
  backfill_count,
  project_root: projectRoot,
};
```

- [ ] **Step 3: Add `--accept-machine-consent` flag behavior** — in the `--accept` handler, if the flag is true, call `writeInstallAck(opts)` before the rest of the flow. Without the flag, if ack is missing, exit 1 with a message pointing at the consent flow.

- [ ] **Step 4: Run tests, verify PASS**

```
pnpm --filter @fos/plugin test tests/cli/commands/comprehend-init.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add packages/plugin/src/cli/commands/comprehend-init.ts packages/plugin/tests/cli/commands/comprehend-init.test.ts
git commit -m "feat(plugin): init --show-consent emits consent text; --accept-machine-consent flag"
```

---

### Task 7: Update `comprehend-init.md` with consent-gate block; delete `install/`

**Files:**
- Modify: `packages/plugin/commands/comprehend-init.md`
- Delete: `packages/plugin/install/post-install.js`
- Delete: `packages/plugin/install/package.json`
- Delete: `packages/plugin/install/` (dir)
- Modify: `packages/plugin/tests/integration/plugin-smoke.test.ts`

- [ ] **Step 1: Update `commands/comprehend-init.md`**

```markdown
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
```

- [ ] **Step 2: Update `docs/user/data-flow.md` install-path reference**

The markdown uses `${CLAUDE_PLUGIN_ROOT}/docs/user/data-flow.md`. Ensure Task 8's data-flow doc is placed so this path resolves — which means it must ship INSIDE the plugin package, not just in the repo root. Approach: tsup build copies `docs/user/data-flow.md` from repo root into `packages/plugin/docs/user/data-flow.md`, and the plugin's `files` array includes `docs`. See Task 8 for the mechanics.

- [ ] **Step 3: Delete install dir**

```bash
rm -rf packages/plugin/install
```

- [ ] **Step 4: Update `tests/integration/plugin-smoke.test.ts`** — remove the two assertions that `install/post-install.js` and `install/package.json` exist. Replace with an assertion that `install/` does **not** exist:

```ts
it('no install/ directory ships (post-install script was deleted)', () => {
  expect(existsSync(resolve(pluginRoot, 'install'))).toBe(false);
});
```

- [ ] **Step 5: Run tests, verify PASS**

```
pnpm --filter @fos/plugin test
```

- [ ] **Step 6: Commit**

```bash
git add packages/plugin/commands/comprehend-init.md packages/plugin/tests/integration/plugin-smoke.test.ts
git rm -r packages/plugin/install
git commit -m "feat(plugin): consent gate in /comprehend-fos:comprehend-init; drop install/"
```

---

### Task 8: Write `docs/user/data-flow.md` + ship with plugin

**Files:**
- Create: `docs/user/data-flow.md`
- Modify: `packages/plugin/package.json` (copy-assets script + files array)

- [ ] **Step 1: Write `docs/user/data-flow.md`**

```markdown
# FOS Data Flow

This plugin analyzes your Claude Code session transcripts locally and builds a
comprehension graph under `.comprehension/` in each project you opt into. No
third-party providers are contacted.

## What the plugin reads

- **Claude Code session JSONL transcripts** under `~/.claude/projects/<hash>/*.jsonl`.
- **Your project's `.comprehension/` directory** (created by the plugin itself).
- **Claude Code plugin install location** (`${CLAUDE_PLUGIN_ROOT}`) for bundled
  assets (refiner prompt, DAG viewer template).

## What the plugin sends out

When the Stop hook fires or you run `/comprehend-fos:comprehend` or
`/comprehend-fos:comprehend-backfill`, the plugin invokes your existing `claude
-p` subprocess with a compressed representation of the session transcript.

**Claude Code's data policy governs what happens from there.** File contents
you read during the session are STRIPPED before the refiner sees them — only
tool-call summaries and your narrative/reasoning text are passed in. No API
keys, file contents, or OS-level secrets are included.

## What the plugin writes

Everything goes under the opted-in project's `.comprehension/` directory:
- `sessions/<date>-<id>.md` — per-session analysis artifact.
- `concepts/<slug>.md` — derived project-view entries.
- `graph.json` + `graph.html` — DAG data + self-contained viewer.
- `manifest.json` — plugin-version + per-project state.
- `.fos/` — internal state (consent flag, locks, logs).

The plugin also writes one machine-wide file:
- `~/.claude/fos-install-ack` — a marker that you've seen this consent text
  at least once. No other data.

## Opting out

- To opt one project out: `rm -rf <project>/.comprehension/`.
- To uninstall entirely: `claude plugins uninstall comprehend-fos@fos-dev`.

The plugin makes no network calls of its own. All network activity happens via
the `claude` CLI you already use.
```

- [ ] **Step 2: Extend plugin's `package.json` copy-assets script**

The plugin currently has `copy-assets` copying the refiner prompt + viewer template. Add the data-flow doc to it:

```json
"copy-assets": "node -e \"import('node:fs/promises').then(async fs=>{
  await fs.mkdir('dist/prompts',{recursive:true});
  await fs.copyFile('../core/prompts/refiner-v1.md','dist/prompts/refiner-v1.md');
  await fs.mkdir('dist/viewer',{recursive:true});
  await fs.copyFile('../core/dist/viewer/template.html','dist/viewer/template.html');
  await fs.mkdir('docs/user',{recursive:true});
  await fs.copyFile('../../docs/user/data-flow.md','docs/user/data-flow.md');
  console.log('assets copied');
})\"",
```

(Keep as one long string in the actual JSON — multi-line shown here for readability.)

Also update `files` in `package.json` to include `docs`:

```json
"files": ["dist", ".claude-plugin", "commands", "hooks", "docs"],
```

- [ ] **Step 3: Rebuild + verify asset ships**

```
pnpm --filter @fos/plugin build
ls packages/plugin/docs/user/data-flow.md    # should exist after build
```

- [ ] **Step 4: Commit**

```bash
git add docs/user/data-flow.md packages/plugin/package.json
git commit -m "feat(plugin): ship docs/user/data-flow.md with plugin; consent text references it"
```

---

## Phase 4 — Corpus Mining Utility + Expansion

### Task 9: Build `tools/scrub-transcript.mjs`

**Files:**
- Create: `tools/scrub-transcript.mjs`
- Create: `tools/README.md`

- [ ] **Step 1: Write the scrubber**

```js
#!/usr/bin/env node
// Usage: node tools/scrub-transcript.mjs <input.jsonl> <output.jsonl> [--redact-word foo] [--redact-word bar]
// Redacts common sensitive patterns; flags suspect lines for human review.

import { readFile, writeFile } from 'node:fs/promises';

const SECRET_PATTERNS = [
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '<redacted-email>' },
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '<redacted-token>' },
  { name: 'ghp-token', re: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: '<redacted-token>' },
  { name: 'unix-home', re: /\/Users\/[A-Za-z0-9._-]+/g, replacement: '<HOME>' },
  { name: 'windows-home', re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+/g, replacement: '<HOME>' },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '<redacted-aws-key>' },
];

const SUSPECT_PATTERNS = [
  /password[\s:=]+['"]?[^\s'"]+/gi,
  /secret[\s:=]+['"]?[^\s'"]+/gi,
  /\bAPI[_\- ]?KEY\b/gi,
  /\bTOKEN\b[\s:=]+['"]?[^\s'"]+/gi,
];

async function main() {
  const [, , inPath, outPath, ...rest] = process.argv;
  if (!inPath || !outPath) {
    console.error('usage: scrub-transcript <input.jsonl> <output.jsonl> [--redact-word word]*');
    process.exit(2);
  }
  const redactWords = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--redact-word' && rest[i + 1]) {
      redactWords.push(rest[i + 1]);
      i++;
    }
  }

  const raw = await readFile(inPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const suspects = [];
  const out = lines.map((line, lineNum) => {
    let replaced = line;
    for (const p of SECRET_PATTERNS) replaced = replaced.replace(p.re, p.replacement);
    for (const word of redactWords) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}\\b`, 'gi');
      replaced = replaced.replace(re, '<redacted-word>');
    }
    for (const p of SUSPECT_PATTERNS) {
      const matches = replaced.match(p);
      if (matches) suspects.push({ lineNum: lineNum + 1, matches });
    }
    return replaced;
  });

  await writeFile(outPath, out.join('\n'), 'utf8');

  console.log(`Wrote ${outPath} (${out.length} lines).`);
  if (suspects.length > 0) {
    console.error('\n⚠ Suspect patterns still present — manual review required:');
    for (const s of suspects) {
      console.error(`  line ${s.lineNum}: ${s.matches.slice(0, 3).join(', ')}`);
    }
    process.exit(1);   // non-zero exit so CI catches unreviewed suspects
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
```

- [ ] **Step 2: Write `tools/README.md`**

```markdown
# FOS dev tools

## scrub-transcript.mjs

Redact common secret patterns from a Claude Code JSONL transcript before
committing it to the golden corpus.

    node tools/scrub-transcript.mjs <input.jsonl> <output.jsonl> [--redact-word foo]*

Exit codes:
- 0: scrubbed cleanly
- 1: suspect patterns remain (manual review required)
- 2: usage error

**You MUST manually read the output transcript before `git add`.** This
script is a backstop, not a substitute. Project-specific identifiers,
internal service names, and org-specific jargon will not be auto-detected.
Use `--redact-word` for anything you want scrubbed beyond the built-in
patterns.
```

- [ ] **Step 3: Smoke test**

```bash
echo '{"type":"user","message":{"role":"user","content":"hi from alice@example.com with sk-AAAAAAAAAAAAAAAAAAAAAAAAAA"}}' > /tmp/scrub-test.jsonl
node tools/scrub-transcript.mjs /tmp/scrub-test.jsonl /tmp/scrub-out.jsonl
cat /tmp/scrub-out.jsonl
```

Expected: output contains `<redacted-email>` and `<redacted-token>`, no `alice@example.com`, no `sk-…`.

- [ ] **Step 4: Commit**

```bash
git add tools/scrub-transcript.mjs tools/README.md
git commit -m "feat(tools): scrub-transcript for mining real Claude Code transcripts"
```

---

### Task 10: Set up pre-commit guard + update `tests/golden/README.md`

**Files:**
- Create: `.husky/pre-commit` (or `scripts/pre-commit.sh`)
- Modify: `package.json` (root) — optional husky install script
- Modify: `packages/core/tests/golden/README.md`

Plan 3 does NOT require installing husky as a dependency if it's not already present. The guard can also be a plain shell script the author runs manually. Pick the simpler path given the repo's pnpm+turbo setup — a scripts/pre-commit.sh without husky is lowest friction.

- [ ] **Step 1: Create `scripts/pre-commit.sh`**

```bash
#!/usr/bin/env bash
set -e

# Pre-commit: warn if tests/golden/corpus/ contains common sensitive patterns.
# Run manually before committing corpus changes (or wire into husky later).

STAGED=$(git diff --cached --name-only | grep -E 'packages/core/tests/golden/corpus/.*\.(jsonl|json)' || true)
if [ -z "$STAGED" ]; then exit 0; fi

PATTERNS=(
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '\bsk-[A-Za-z0-9_-]{20,}\b'
  '\bghp_[A-Za-z0-9]{20,}\b'
  '\bAKIA[0-9A-Z]{16}\b'
  '/Users/[A-Za-z0-9._-]+'
  '[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+'
)

FLAGGED=0
for FILE in $STAGED; do
  for P in "${PATTERNS[@]}"; do
    if git show :"$FILE" | grep -E "$P" >/dev/null 2>&1; then
      echo "⚠ $FILE matches sensitive pattern: $P"
      FLAGGED=1
    fi
  done
done

if [ "$FLAGGED" = "1" ]; then
  echo ""
  echo "Refusing to commit. Re-run tools/scrub-transcript.mjs and review manually."
  echo "If false positive, use: git commit --no-verify"
  exit 1
fi
```

Make executable: `chmod +x scripts/pre-commit.sh`.

- [ ] **Step 2: Document in `tests/golden/README.md`**

Append to the existing README:

```markdown
## Mining real transcripts

1. Copy a real Claude Code JSONL from `~/.claude/projects/<hash>/*.jsonl` to a temp file.
2. Scrub: `node tools/scrub-transcript.mjs <input> <output> --redact-word <any-internal-name>`.
3. **Manually read the scrubbed output** before proceeding. Look for:
   - Project names, internal service names, customer names, URLs that identify you or your org.
   - Any quoted dialogue that names people.
4. Before committing, run `bash scripts/pre-commit.sh` to double-check.
5. Hand-author `expected.json` referencing the spec-approved `TAGS` taxonomy.
6. Hand-author `cached-response.json` that satisfies `expected.json`.
7. Commit.

## Tag taxonomy (from Plan 3 spec §3.1)

Allowed tags:
`algorithmic-choice`, `refactor`, `bug-fix`, `multi-turn-pivot`, `terse-user`,
`no-concepts-expected`, `slug-reuse`, `conflicting-decisions`,
`implicit-reasoning`, `abandoned-path`, `tool-heavy`, `pure-narrative`,
`mined`, `synthetic`.

Unknown tags print an eval warning but don't fail the build. To add a new
tag, update the `TAGS` constant in `metrics.ts` in the same commit.

## Difficulty

Optional field, mostly used on synthetic cases: `easy` | `medium` | `hard`.
```

- [ ] **Step 3: Add Plan 1 cases' tags retroactively**

Edit `tests/golden/corpus/sess-01-greeting/expected.json`, `sess-02-fuzzy/expected.json`, `sess-03-refine/expected.json` to add `tags` arrays:

- `sess-01-greeting`: `["no-concepts-expected", "synthetic"]`
- `sess-02-fuzzy`: `["algorithmic-choice", "synthetic"]`
- `sess-03-refine`: `["slug-reuse", "synthetic"]`

- [ ] **Step 4: Commit**

```bash
git add scripts/pre-commit.sh packages/core/tests/golden/README.md packages/core/tests/golden/corpus/sess-0{1,2,3}*/expected.json
git commit -m "chore(golden): pre-commit secret guard + tag Plan-1 cases"
```

---

### Task 11: Author 10 new cases (mined + synthetic)

This is the authoring-heavy task. Each case requires: transcript.jsonl, expected.json (with tags), cached-response.json (valid RefinerOutput), optional notes.md.

**Files:**
- Create: `packages/core/tests/golden/corpus/sess-04-terse-user/{transcript,expected,cached-response}.{jsonl,json,json}`
- Create: 9 more case directories under the same pattern.

This task is deliberately broken into **sub-batches** so the implementer commits each as they go, rather than one massive commit.

- [ ] **Sub-batch A — mined cases (4 of 6 target)**

For each of these, pick a real Claude Code JSONL from `~/.claude/projects/`, scrub it, author expected.json + cached-response.json:

1. `sess-04-terse-user` — a session where the user only typed short messages. Tags: `["terse-user", "mined"]`.
2. `sess-05-long-session` — a multi-topic session. Tags: `["long-session", "multi-turn-pivot", "mined"]`.
3. `sess-06-multiple-concepts` — a session introducing 3+ distinct concepts. Tags: `["multiple-concepts", "mined"]`.
4. `sess-07-refactor` — a session performing a refactor. Tags: `["refactor", "mined"]`.

After each case lands: `git commit -m "test(golden): add <slug> case"`.

- [ ] **Sub-batch B — mined cases (2 of 6 target)**

5. `sess-08-debugging` — a debugging session. Tags: `["bug-fix", "debugging", "mined"]`. (`debugging` isn't in TAGS; either use `bug-fix` alone or add to TAGS in this commit.)
6. `sess-09-no-concepts` — a session with no architectural content (chitchat, wrong-project, abandoned). Tags: `["no-concepts-expected", "mined"]`. Cached response: `{ "concepts": [], "unknowns": [] }`.

- [ ] **Sub-batch C — synthetic cases (4 of 8 target)**

Hand-author transcripts that stress specific refiner behaviors.

7. `sess-10-conflicting-decisions` — session where the assistant picks A then pivots to B. The expected concept should capture the PIVOT. Tags: `["conflicting-decisions", "synthetic"]`. `difficulty: "hard"`.
8. `sess-11-implicit-reasoning` — assistant makes a decision WITHOUT saying "because X" — the reasoning is in the CODE, not the prose. Tests whether the refiner can infer. Expected may legitimately be low-confidence / marked as an unknown. Tags: `["implicit-reasoning", "synthetic"]`. `difficulty: "hard"`.
9. `sess-12-abandoned-path` — assistant starts approach A, realizes it won't work, abandons, starts B. Expected concept = final approach only; `abandoned` path should NOT appear as a concept. Tags: `["abandoned-path", "synthetic"]`. `difficulty: "medium"`.
10. `sess-13-slug-reuse` — session that references an existing concept from prior sessions via the `slug_reuse_context`. Tests whether the refiner reuses the slug correctly. Tags: `["slug-reuse", "synthetic"]`. `difficulty: "medium"`.

- [ ] **Sub-batch D — synthetic edge cases (4 of 8 target)**

11. `sess-14-empty-transcript` — a valid JSONL file with only a single-line user message (no assistant activity). Expected: zero concepts. Tests the refiner's emptiness handling. Tags: `["empty-transcript", "synthetic"]`. `difficulty: "easy"`.
12. `sess-15-tool-heavy` — a session consisting almost entirely of tool calls (Read, Edit, Bash) with minimal prose. Tests whether the refiner can extract structure from tool patterns. Tags: `["tool-heavy", "synthetic"]`. `difficulty: "medium"`.
13. `sess-16-pure-narrative` — a session consisting of assistant explanation + user follow-up questions, NO tool calls. Tests whether the refiner extracts concepts from pure discussion. Tags: `["pure-narrative", "synthetic"]`. `difficulty: "medium"`.

(Total: 13 new synthetic/mined + 3 existing = 16 cases. Adjust the numbering if some targets merge.)

**After each sub-batch completes:**

```bash
pnpm --filter @fos/core eval
```

Expected: the existing 3-case eval runner still works on the expanded corpus (even though cases may fail substring checks until Task 12+ re-shape the eval to emit metrics instead of pass/fail).

- [ ] **Final commit for Phase 4:** confirm 16 cases are present.

```bash
ls packages/core/tests/golden/corpus/ | wc -l   # expect: 16
```

---

## Phase 5 — Eval Harness + Baseline

### Task 12: Introduce `expected-schema.ts` + updated eval runner

**Files:**
- Create: `packages/core/tests/golden/expected-schema.ts`
- Create: `packages/core/tests/golden/metrics.ts`
- Modify: `packages/core/tests/golden/eval.test.ts`

- [ ] **Step 1: Write `expected-schema.ts`**

```ts
import { z } from 'zod';

export const TAGS = [
  'algorithmic-choice', 'refactor', 'bug-fix', 'multi-turn-pivot',
  'terse-user', 'no-concepts-expected', 'slug-reuse',
  'conflicting-decisions', 'implicit-reasoning', 'abandoned-path',
  'tool-heavy', 'pure-narrative', 'mined', 'synthetic',
  'long-session', 'multiple-concepts', 'debugging', 'empty-transcript',
] as const;

export const ExpectedSchema = z.object({
  required_slugs: z.array(z.string()).default([]),
  slug_reuse_context: z.array(z.string()).default([]),
  required_reasoning_substrings: z.record(z.string(), z.array(z.string())).default({}),
  forbidden_slugs: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  notes: z.string().optional(),
});
export type Expected = z.infer<typeof ExpectedSchema>;
```

- [ ] **Step 2: Write `metrics.ts`**

```ts
import type { Expected } from './expected-schema.js';
import type { RefinerOutput } from '@fos/core';   // via barrel

export interface CaseMetrics {
  slug: string;
  tags: string[];
  concept_recall: number;
  slug_reuse_precision: number | null;
  reasoning_preservation: number;
  schema_valid: boolean;
  forbidden_slug_violations: number;
  elapsed_ms?: number;
}

export function scoreCase(caseName: string, expected: Expected, actual: RefinerOutput): Omit<CaseMetrics, 'elapsed_ms'> {
  const actualSlugs = new Set(actual.concepts.map((c) => c.slug));

  // concept_recall: fraction of required_slugs that appear in actual
  const recall = expected.required_slugs.length === 0
    ? 1
    : expected.required_slugs.filter((s) => actualSlugs.has(s)).length / expected.required_slugs.length;

  // slug_reuse_precision: of the context slugs that SHOULD have been reused, how many were?
  // Applicable only when slug_reuse_context is non-empty AND at least one context slug's topic appears in the transcript.
  // For Plan 3, we approximate: if required_slugs intersects slug_reuse_context, measure reuse.
  const contextRelevant = expected.slug_reuse_context.filter((s) => expected.required_slugs.includes(s));
  const slug_reuse_precision = contextRelevant.length === 0
    ? null
    : contextRelevant.filter((s) => actualSlugs.has(s)).length / contextRelevant.length;

  // reasoning_preservation: per-concept, fraction of required substrings found (case-insensitive)
  let total = 0, matched = 0;
  for (const [slug, substrings] of Object.entries(expected.required_reasoning_substrings)) {
    const concept = actual.concepts.find((c) => c.slug === slug);
    const body = concept ? [concept.summary, ...concept.reasoning].join(' ').toLowerCase() : '';
    for (const s of substrings) {
      total += 1;
      if (body.includes(s.toLowerCase())) matched += 1;
    }
  }
  const reasoning_preservation = total === 0 ? 1 : matched / total;

  const forbidden_slug_violations = expected.forbidden_slugs.filter((s) => actualSlugs.has(s)).length;

  // schema_valid: caller passes true/false based on zod parse of raw refiner response
  return {
    slug: caseName,
    tags: expected.tags,
    concept_recall: recall,
    slug_reuse_precision,
    reasoning_preservation,
    schema_valid: true,     // caller overrides when appropriate
    forbidden_slug_violations,
  };
}

export interface Aggregate {
  concept_recall: { p50: number; p25: number; mean: number };
  slug_reuse_precision: { p50: number; p25: number; mean: number; applicable_cases: number };
  reasoning_preservation: { p50: number; p25: number; mean: number };
  schema_valid_rate: number;
  forbidden_violations: number;
}

function percentile(xs: number[], p: number): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx]!;
}

export function aggregate(cases: CaseMetrics[]): Aggregate {
  const recalls = cases.map((c) => c.concept_recall);
  const reuseApplicable = cases.filter((c) => c.slug_reuse_precision !== null);
  const reuses = reuseApplicable.map((c) => c.slug_reuse_precision as number);
  const reasonings = cases.map((c) => c.reasoning_preservation);
  return {
    concept_recall: {
      p50: percentile(recalls, 0.5),
      p25: percentile(recalls, 0.25),
      mean: recalls.reduce((a, b) => a + b, 0) / (recalls.length || 1),
    },
    slug_reuse_precision: {
      p50: percentile(reuses, 0.5),
      p25: percentile(reuses, 0.25),
      mean: reuses.reduce((a, b) => a + b, 0) / (reuses.length || 1),
      applicable_cases: reuseApplicable.length,
    },
    reasoning_preservation: {
      p50: percentile(reasonings, 0.5),
      p25: percentile(reasonings, 0.25),
      mean: reasonings.reduce((a, b) => a + b, 0) / (reasonings.length || 1),
    },
    schema_valid_rate: cases.filter((c) => c.schema_valid).length / (cases.length || 1),
    forbidden_violations: cases.reduce((a, c) => a + c.forbidden_slug_violations, 0),
  };
}
```

- [ ] **Step 3: Rewrite `eval.test.ts`** to emit metrics and compare against baseline.json

```ts
import { describe, it, expect } from 'vitest';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { ExpectedSchema, type Expected } from './expected-schema.js';
import { scoreCase, aggregate, type CaseMetrics } from './metrics.js';
import { analyzeSession, rebuildProjectView, RefinerOutputSchema } from '../../src/index.js';
import type { InvokeFn } from '../../src/refiner/index.js';

const here = dirname(fileURLToPath(import.meta.url));

interface Baseline {
  refiner_version: string;
  tolerance: { concept_recall_pct: number; schema_valid_pct: number; reasoning_preservation_pct: number };
  per_case: Array<Omit<CaseMetrics, 'elapsed_ms'>>;
}

async function loadBaseline(): Promise<Baseline | null> {
  try {
    const raw = await readFile(join(here, 'baseline.json'), 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch { return null; }
}

function makeEvalInvoke(caseDir: string): InvokeFn {
  if (process.env['FOS_EVAL_REAL'] === '1') {
    return async ({ systemPrompt, userInput }) => {
      const { invokeClaude } = await import('../../src/refiner/invoke.js');
      return invokeClaude({ systemPrompt, userInput, claudeBin: 'claude', timeoutMs: 120_000 });
    };
  }
  return async () => readFile(join(caseDir, 'cached-response.json'), 'utf8');
}

const corpusDir = join(here, 'corpus');
const caseDirs = (await readdir(corpusDir)).filter((n) => !n.startsWith('.')).sort();

const caseMetrics: CaseMetrics[] = [];

describe('golden corpus eval', () => {
  for (const name of caseDirs) {
    it(`scores case: ${name}`, async () => {
      const caseDir = join(corpusDir, name);
      const expected = ExpectedSchema.parse(JSON.parse(await readFile(join(caseDir, 'expected.json'), 'utf8')));
      const transcript = join(caseDir, 'transcript.jsonl');

      const tmp = await mkdtemp(join(tmpdir(), `fos-eval-${name}-`));
      try {
        const invoke = makeEvalInvoke(caseDir);
        let rawRefinerResponse = '';
        const recordingInvoke: InvokeFn = async (args) => {
          const out = await invoke(args);
          rawRefinerResponse = out;
          return out;
        };

        await analyzeSession({
          projectRoot: tmp,
          transcriptPath: transcript,
          sessionId: name,
          now: () => new Date('2026-04-21T00:00:00Z'),
          invoke: recordingInvoke,
        });

        // Parse raw response for schema_valid + score.
        const parseResult = RefinerOutputSchema.safeParse(JSON.parse(stripFences(rawRefinerResponse)));
        const base = scoreCase(name, expected, parseResult.success ? parseResult.data : { concepts: [], unknowns: [] });
        const metric: CaseMetrics = { ...base, schema_valid: parseResult.success };
        caseMetrics.push(metric);

        // Inline assertions for hard invariants that don't depend on baseline:
        expect(metric.forbidden_slug_violations).toBe(0);
      } finally {
        await rm(tmp, { recursive: true, force: true });
      }
    });
  }

  it('aggregate report + baseline regression check', async () => {
    const agg = aggregate(caseMetrics);
    const baseline = await loadBaseline();

    console.log('\n=== eval aggregate ===');
    console.log(JSON.stringify(agg, null, 2));

    if (!baseline) {
      console.log('(no baseline.json yet — run `pnpm eval --snapshot` to create one)');
      return;
    }

    const tol = baseline.tolerance;
    const failures: string[] = [];

    for (const current of caseMetrics) {
      const prior = baseline.per_case.find((b) => b.slug === current.slug);
      if (!prior) continue;
      if (prior.concept_recall - current.concept_recall > tol.concept_recall_pct) {
        failures.push(`${current.slug}: recall regressed ${prior.concept_recall.toFixed(2)} → ${current.concept_recall.toFixed(2)}`);
      }
      if (Number(prior.schema_valid) - Number(current.schema_valid) > tol.schema_valid_pct) {
        failures.push(`${current.slug}: schema_valid regressed`);
      }
      // reasoning_preservation is advisory — log but don't fail
      if (prior.reasoning_preservation - current.reasoning_preservation > tol.reasoning_preservation_pct) {
        console.warn(`  advisory: ${current.slug}: reasoning_preservation ${prior.reasoning_preservation.toFixed(2)} → ${current.reasoning_preservation.toFixed(2)}`);
      }
    }

    if (failures.length > 0) {
      throw new Error('Regression vs baseline.json:\n' + failures.join('\n'));
    }
  });
});

function stripFences(s: string): string {
  const m = s.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  return m ? m[1]!.trim() : s.trim();
}
```

- [ ] **Step 4: Run and expect failures until baseline is snapshotted**

```
pnpm --filter @fos/core eval
```

Expect: aggregate printed, but "no baseline.json yet" message. Individual cases either pass or fail schema/forbidden assertions.

- [ ] **Step 5: Commit**

```bash
git add packages/core/tests/golden/expected-schema.ts packages/core/tests/golden/metrics.ts packages/core/tests/golden/eval.test.ts
git commit -m "feat(eval): metrics-emitting golden eval with baseline regression check"
```

---

### Task 13: Add `--snapshot` + `--against <ref>` flags

**Files:**
- Modify: `packages/core/package.json`
- Create: `packages/core/tests/golden/snapshot.ts`
- Create: `packages/core/tests/golden/diff.ts`
- Create: `packages/core/tests/golden/run-eval.mjs` (Node CLI shim; vitest still orchestrates cases)

The cleanest wiring: `pnpm eval` runs vitest as today (regression test); `pnpm eval --snapshot` runs a small Node script that imports the metrics module, invokes each case, writes baseline.json, and skips the regression check. `pnpm eval --against <ref>` runs vitest in a mode that loads the baseline from `git show <ref>:packages/core/tests/golden/baseline.json` instead of the on-disk file.

- [ ] **Step 1: Write `run-eval.mjs`** (small Node CLI):

```js
#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFile, readFile, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flags = process.argv.slice(2);

if (flags.includes('--snapshot')) {
  process.env['FOS_EVAL_MODE'] = 'snapshot';
  await runVitestOnce();
  // vitest's final 'aggregate' test will have collected caseMetrics and
  // written baseline.json via a side channel (see snapshot.ts).
  process.exit(0);
}

if (flags.includes('--against')) {
  const idx = flags.indexOf('--against');
  const ref = flags[idx + 1];
  if (!ref) { console.error('--against requires a git ref'); process.exit(2); }
  // Write the fetched baseline to a tmp file for eval to load.
  const tmp = join(here, 'baseline.against.tmp.json');
  const p = spawn('git', ['show', `${ref}:packages/core/tests/golden/baseline.json`], { stdio: ['ignore', 'pipe', 'inherit'] });
  let out = '';
  p.stdout.on('data', (d) => out += d);
  await new Promise((r) => p.on('close', r));
  await writeFile(tmp, out, 'utf8');
  process.env['FOS_EVAL_BASELINE_PATH'] = tmp;
}

await runVitestOnce();

async function runVitestOnce() {
  return new Promise((resolve, reject) => {
    const v = spawn('pnpm', ['exec', 'vitest', 'run', 'tests/golden'], { stdio: 'inherit', shell: true });
    v.on('close', (code) => code === 0 ? resolve() : reject(new Error(`vitest exit ${code}`)));
  });
}
```

- [ ] **Step 2: Write `snapshot.ts`** (collects metrics into baseline.json when FOS_EVAL_MODE=snapshot)

Add a lightweight "snapshot writer" the eval.test.ts calls at the end when `FOS_EVAL_MODE === 'snapshot'`:

```ts
import { writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CaseMetrics, Aggregate } from './metrics.js';
import { readFile } from 'node:fs/promises';

export async function maybeSnapshot(cases: CaseMetrics[], agg: Aggregate): Promise<void> {
  if (process.env['FOS_EVAL_MODE'] !== 'snapshot') return;
  const here = dirname(fileURLToPath(import.meta.url));
  const refinerPromptPath = join(here, '..', '..', 'prompts', 'refiner-v1.md');
  const refinerText = await readFile(refinerPromptPath, 'utf8');
  const { createHash } = await import('node:crypto');
  const refinerHash = `sha256:${createHash('sha256').update(refinerText).digest('hex')}`;

  const baseline = {
    generated_at: new Date().toISOString(),
    refiner_version: 'v1.0.0',
    refiner_prompt_hash: refinerHash,
    mode: process.env['FOS_EVAL_REAL'] === '1' ? 'real' : 'cached',
    corpus_size: cases.length,
    tolerance: {
      concept_recall_pct: 0.05,
      schema_valid_pct: 0.02,
      reasoning_preservation_pct: 0.10,
    },
    aggregate: agg,
    per_case: cases.map((c) => {
      const { elapsed_ms: _, ...rest } = c;
      return rest;
    }),
  };
  await writeFile(join(here, 'baseline.json'), JSON.stringify(baseline, null, 2) + '\n', 'utf8');
  console.log('✓ wrote baseline.json');
}
```

Then in `eval.test.ts`'s final aggregate test, call `await maybeSnapshot(caseMetrics, agg)` after computing aggregate.

- [ ] **Step 3: Update `eval.test.ts`** to honor `FOS_EVAL_BASELINE_PATH`

```ts
async function loadBaseline(): Promise<Baseline | null> {
  const path = process.env['FOS_EVAL_BASELINE_PATH'] ?? join(here, 'baseline.json');
  try {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as Baseline;
  } catch { return null; }
}
```

- [ ] **Step 4: Write `diff.ts`** (compares two baseline.json instances and prints per-case deltas). Keep it simple — print a markdown table to stdout. Called from `run-eval.mjs` as a post-step when `--against` is used.

- [ ] **Step 5: Update `package.json`:**

```json
"eval": "node tests/golden/run-eval.mjs"
```

- [ ] **Step 6: Commit**

```bash
git add packages/core/tests/golden/run-eval.mjs packages/core/tests/golden/snapshot.ts packages/core/tests/golden/diff.ts packages/core/tests/golden/eval.test.ts packages/core/package.json
git commit -m "feat(eval): --snapshot and --against flags for baseline management"
```

---

### Task 14: Generate and commit `baseline.json`

- [ ] **Step 1: Snapshot the current refiner-v1 against the full corpus (cached mode)**

```
pnpm --filter @fos/core eval --snapshot
```

Expected: `packages/core/tests/golden/baseline.json` is created with per-case metrics for all 16 cases.

- [ ] **Step 2: Inspect the output**

```
cat packages/core/tests/golden/baseline.json | head -40
```

Check: `aggregate.concept_recall.mean`, `reasoning_preservation.mean`, `schema_valid_rate`. Record the numbers in the commit message — Plan 4 will compare against them.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/golden/baseline.json
git commit -m "$(cat <<'EOF'
chore(eval): initial baseline.json for refiner-v1.0.0 (cached corpus)

Starting-line measurement of refiner-v1 against the 16-case corpus in
cached mode. §8.2 bars are display-only in Plan 3; Plan 4 will iterate
the refiner to close the gap.

Mode: cached
Corpus: 16 cases (3 from Plan 1, 13 added in Plan 3)
Regression tolerance: recall 5%, schema-valid 2%, reasoning 10% (advisory)
EOF
)"
```

- [ ] **Step 4: Run plain `pnpm eval`** to confirm regression gate is now green

```
pnpm --filter @fos/core eval
```

Expected: all cases pass, no regressions (since the baseline was just snapshotted). If anything flaps, investigate before moving on.

---

### Task 15: Confirm `--against` works end-to-end

- [ ] **Step 1: Exercise the diff path against the just-committed baseline**

```
pnpm --filter @fos/core eval --against HEAD~1   # may fail if HEAD~1 predates baseline.json
```

If HEAD~1 is before Task 14's commit, the diff path can't load a baseline — expected. Instead use `HEAD` to confirm the code path works:

```
pnpm --filter @fos/core eval --against HEAD
```

Expected: no regressions (baseline is identical). The diff output should be empty or "all cases unchanged."

- [ ] **Step 2: Commit any small `run-eval.mjs` fixups** if the above surfaced bugs

```bash
git add -u && git commit -m "fix(eval): minor fix from --against smoke" || echo "nothing to commit"
```

Phase 5 complete.

---

## Phase 6 — Release Prep

### Task 16: Full workspace verification

- [ ] **Step 1: Build + test + lint all packages**

```
pnpm build
pnpm test
pnpm --filter @fos/core lint
pnpm --filter @fos/plugin lint
```

Expected: all green. If the plugin's lint complains about anything added in Phases 1–3, fix before moving on.

- [ ] **Step 2: Run full eval**

```
pnpm --filter @fos/core eval
```

Expected: 16 cases, aggregate report prints, no regressions.

- [ ] **Step 3: Manual CLI smokes**

```
# rerun
node packages/plugin/dist/cli/bin.js rerun --show-preview --project-root /tmp/plan3-smoke 2>&1 || echo "exit=$?"
# init with fresh fos-install-ack home
HOME_OVERRIDE=/tmp/plan3-home node packages/plugin/dist/cli/bin.js init --show-consent --project-root /tmp/plan3-smoke-fresh
```

Confirm: rerun's preview JSON includes `refiner_version_current`; init's `consent_required_text` is non-null when ack is missing.

---

### Task 17: Dogfood + summary notes

- [ ] **Step 1: Reinstall the plugin** against the latest dist:

```
cd D:/comprehension-debt
pnpm --filter @fos/plugin build
claude plugins uninstall comprehend-fos@fos-dev
claude plugins install comprehend-fos@fos-dev
```

- [ ] **Step 2: Smoke the new consent flow**

```
# remove existing ack if present, to force the consent path
rm -f ~/.claude/fos-install-ack
mkdir /tmp/plan3-dogfood && cd /tmp/plan3-dogfood
git init -q
claude --dangerously-skip-permissions
# inside: /comprehend-fos:comprehend-init → should see the consent text + 3-option AskUserQuestion
```

Confirm: consent text appears; accepting writes `~/.claude/fos-install-ack`; subsequent init on another project skips consent.

- [ ] **Step 3: Smoke rerun**

Inside a session on an opted-in project:

```
/comprehend-fos:comprehend-rerun
```

Confirm: `AskUserQuestion` lists the four options (Rebuild / Re-analyze current / Re-analyze all / Cancel). Pick "Rebuild". Exit. Verify `.comprehension/graph.html` mtime updated.

- [ ] **Step 4: Write dogfood notes**

Create `docs/superpowers/plans/2026-04-21-fos-v3-dogfood-notes.md` documenting anything that differs from expected. Commit.

```bash
git add docs/superpowers/plans/2026-04-21-fos-v3-dogfood-notes.md
git commit -m "docs(plans): Plan-3 dogfood notes"
```

---

## Plan 3 Completion Criteria

All of these must be objectively true before Plan 3 is done:

- [ ] `pnpm build` succeeds across all packages.
- [ ] `pnpm test` passes all existing tests + new tests (lock primitive, rerun, consent).
- [ ] `pnpm --filter @fos/core eval` passes with the committed baseline.
- [ ] `pnpm --filter @fos/core eval --snapshot` regenerates baseline.json cleanly.
- [ ] `pnpm --filter @fos/core eval --against HEAD` runs end-to-end without error.
- [ ] `tryAcquireLock` and `tryAcquireQueueLock` both delegate to `acquireExclusiveLock` — grep confirms no duplicated `open(..., 'wx')` or `pidExists` calls outside the primitive.
- [ ] `/comprehend-fos:comprehend-rerun` works from a live Claude Code session for rebuild, --session, and --all modes.
- [ ] `/comprehend-fos:comprehend-init` consent flow fires once per machine; second-project invocation skips consent.
- [ ] `packages/plugin/install/` is deleted; plugin-smoke test asserts its absence.
- [ ] `docs/user/data-flow.md` exists and ships with the plugin dist.
- [ ] 16 golden corpus cases present (3 existing + 13 new); each validates against the expected schema; each has a cached-response that parses as a RefinerOutput.
- [ ] `baseline.json` committed and reflects refiner-v1.0.0's current metrics against the full corpus.

When every checkbox above is marked, Plan 3 is complete. Merge `feat/plan-3-cleanup-and-quality` → `main` via `--no-ff`. Plan 4 (refiner iteration + publication) can begin.
