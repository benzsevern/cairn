# FOS v4 — Refiner Iteration Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Iterate `refiner-v1.md` → `refiner-v1.1.md` against an expanded 13+ case golden corpus until §8.2 quality bars pass on Sonnet (or a stop condition fires). Ship as a semver-minor prompt bump; verify on Opus and Haiku; refresh `baseline.json`.

**Architecture:** Phase 0 carries over Plan 3's deferred corpus expansion (6 mined from `D:\show_case` + `D:\comprehension-debt` only, 6–8 synthetic). Phase 1 measures refiner-v1.0.0 against the real Anthropic API via a new opt-in eval provider (`FOS_EVAL_PROVIDER=api` + `ANTHROPIC_API_KEY`). Phases 2–3 are iteration loops (AI-assisted diff proposals, then human polish). Phase 4 verifies tier coverage on Opus + Haiku. Phase 5 ships `refiner-v1.1.md`, bumps `SHIPPED_REFINER_VERSION`, regenerates baseline.

**Tech Stack:** no new runtime deps. `@anthropic-ai/sdk` added as a `devDependencies`-only entry (eval-only, tree-shaken from plugin dist). Existing stack: Node 20+, TypeScript 5.x, ESM, pnpm workspaces, vitest, tsup.

**Related docs:**
- Spec: `docs/superpowers/specs/2026-04-21-fos-plan-4-refiner-iteration-design.md`
- Parent spec: `docs/superpowers/specs/2026-04-20-fos-retrospective-comprehension-layer-design.md`
- Plan 3 spec (corpus + eval harness foundations): `docs/superpowers/specs/2026-04-21-fos-plan-3-cleanup-and-quality-infra-design.md`

**Plan 4 stop conditions (any of these completes the plan):**
1. §8.2 bars met on Sonnet (ideal).
2. 25 iterations reached (any mode — Phase 2 or Phase 3).
3. $40 API wallet consumed.
4. 3-iteration convergence stall (< 2% gain on primary failing metric, three runs in a row).

**Branch:** `feat/plan-4-refiner-iteration` off `main`. Merge back via `--no-ff` after final verification.

**Important procedural note:** Phases 2 and 3 are **iteration loops**, not enumerated tasks. The plan documents the loop's per-cycle mechanics + termination checks. How many cycles run is determined by the stop conditions above.

---

## File Structure

All paths relative to repo root `D:\comprehension-debt\`:

```
packages/core/
├── package.json                              # MODIFIED — @anthropic-ai/sdk devDep + scripts
├── prompts/
│   ├── refiner-v1.md                         # KEPT in-tree as historical record
│   └── refiner-v1.1.md                       # NEW — created at end of Plan 4
├── src/
│   └── refiner/
│       └── load-prompt.ts                    # MODIFIED — SHIPPED_REFINER_VERSION bump
└── tests/
    └── golden/
        ├── corpus/                           # 10 new case dirs added in Phase 0
        │   ├── sess-01-greeting/             # existing
        │   ├── sess-02-fuzzy/                # existing
        │   ├── sess-03-refine/               # existing
        │   ├── sess-04-terse-user/           # NEW — mined from D:/show_case or D:/comprehension-debt
        │   ├── sess-05-long-session/         # NEW — mined
        │   ├── sess-06-multiple-concepts/    # NEW — mined
        │   ├── sess-07-refactor/             # NEW — mined
        │   ├── sess-08-debugging/            # NEW — mined
        │   ├── sess-09-no-concepts/          # NEW — mined
        │   ├── sess-10-conflicting/          # NEW — synthetic
        │   ├── sess-11-implicit-reasoning/   # NEW — synthetic
        │   ├── sess-12-abandoned-path/       # NEW — synthetic
        │   ├── sess-13-slug-reuse/           # NEW — synthetic
        │   ├── sess-14-empty-transcript/     # NEW — synthetic
        │   ├── sess-15-tool-heavy/           # NEW — synthetic
        │   └── sess-16-pure-narrative/       # NEW — synthetic
        ├── api-invoke.ts                     # NEW — @anthropic-ai/sdk wrapper
        ├── baseline.json                     # REGENERATED — v1.1.0 + per-tier
        ├── baseline-real.json                # NEW (or merged into baseline.json — decided Phase 5)
        ├── eval.test.ts                      # MODIFIED — provider switch + --snapshot-delta
        ├── iterations/                       # NEW directory — gitignored
        │   └── <timestamp>-<hash>.json       # one file per eval run
        ├── metrics.ts                        # UNCHANGED (from Plan 3)
        ├── diff.ts                           # UNCHANGED (from Plan 3)
        ├── run-eval.mjs                      # MODIFIED — new flags
        ├── snapshot.ts                       # UNCHANGED (from Plan 3)
        └── expected-schema.ts                # UNCHANGED (from Plan 3)

scripts/
└── pre-commit.sh                             # NEW — secret-pattern guard (Plan 3 carryover)

tools/
└── scrub-transcript.mjs                      # NEW — mining utility (Plan 3 carryover)
└── README.md                                 # NEW (Plan 3 carryover)

docs/superpowers/plans/
├── 2026-04-21-fos-v4-refiner-iteration.md    # this plan
└── 2026-04-21-fos-v4-completion-notes.md     # NEW — written during Phase 5
```

---

## Phase overview

1. **Phase 0 — Setup + corpus expansion** (Tasks 1–18). Infrastructure + 13 new cases.
2. **Phase 1 — Honest starting line** (Task 19). One eval run.
3. **Phase 2 — AI-assisted iterations** (Task 20, iteration loop).
4. **Phase 3 — Human polish** (Task 21, iteration loop).
5. **Phase 4 — Tier verification** (Tasks 22–23).
6. **Phase 5 — Ship** (Tasks 24–28).

---

## Phase 0 — Setup + Corpus Expansion

### Task 1: Branch, devDep, eval provider switch scaffolding

**Files:**
- Create branch.
- Modify: `packages/core/package.json` — add `@anthropic-ai/sdk` to `devDependencies`, add new eval-related scripts.
- Create: `packages/core/tests/golden/api-invoke.ts` — thin SDK wrapper.
- Modify: `packages/core/tests/golden/eval.test.ts` — honor `FOS_EVAL_PROVIDER`.
- Modify: `packages/core/tests/golden/run-eval.mjs` — new flags `--real`, `--api`, `--snapshot-delta`.

- [ ] **Step 1: Branch**

```bash
cd D:/comprehension-debt
git checkout main
git checkout -b feat/plan-4-refiner-iteration
```

- [ ] **Step 2: Install the SDK as a devDep**

```bash
pnpm --filter @fos/core add -D @anthropic-ai/sdk
```

Verify: `packages/core/package.json` shows `@anthropic-ai/sdk` under `devDependencies`, NOT `dependencies`. If pnpm accidentally put it in `dependencies`, move it manually.

- [ ] **Step 3: Write `packages/core/tests/golden/api-invoke.ts`**

```ts
import Anthropic from '@anthropic-ai/sdk';
import type { InvokeFn } from '../../src/refiner/index.js';

export function makeApiInvoke(apiKey: string, model = 'claude-sonnet-4-6'): InvokeFn {
  const client = new Anthropic({ apiKey });
  return async ({ systemPrompt, userInput }) => {
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: 'user', content: userInput }],
    });
    const block = response.content[0];
    if (!block || block.type !== 'text') {
      throw new Error(`Anthropic API returned non-text content: ${block?.type ?? 'empty'}`);
    }
    return block.text;
  };
}
```

- [ ] **Step 4: Write failing test for provider switch in `eval.test.ts`**

Append to `packages/core/tests/golden/eval.test.ts` (or its helper file):

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

describe('makeEvalInvoke — provider switching', () => {
  const originalEnv = { ...process.env };
  afterEach(() => { process.env = { ...originalEnv }; });

  it('uses cli provider by default', async () => {
    delete process.env.FOS_EVAL_PROVIDER;
    delete process.env.FOS_EVAL_REAL;
    const { makeEvalInvoke } = await import('./eval.test.js');   // or wherever the factory lives
    const invoke = makeEvalInvoke('/tmp/nonexistent-case-dir');
    // In cached mode (FOS_EVAL_REAL not set), factory returns a reader for cached-response.json
    // In cli mode under FOS_EVAL_REAL=1, it would shell to `claude -p`.
    // Just assert the function type exists + is async. Actual behavior tested elsewhere.
    expect(typeof invoke).toBe('function');
  });

  it('uses api provider when FOS_EVAL_PROVIDER=api + ANTHROPIC_API_KEY set', async () => {
    process.env.FOS_EVAL_REAL = '1';
    process.env.FOS_EVAL_PROVIDER = 'api';
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-placeholder';
    const { makeEvalInvoke } = await import('./eval.test.js');
    const invoke = makeEvalInvoke('/tmp/nonexistent-case-dir');
    expect(typeof invoke).toBe('function');
    // Verify no actual SDK call happens in this unit test — mock the SDK at module level
    // if the factory calls Anthropic() synchronously. See implementation step below.
  });

  it('throws when api provider is selected without ANTHROPIC_API_KEY', async () => {
    process.env.FOS_EVAL_REAL = '1';
    process.env.FOS_EVAL_PROVIDER = 'api';
    delete process.env.ANTHROPIC_API_KEY;
    const { makeEvalInvoke } = await import('./eval.test.js');
    expect(() => makeEvalInvoke('/tmp/nonexistent-case-dir')).toThrow(/ANTHROPIC_API_KEY/);
  });
});
```

Adjust the import path for `makeEvalInvoke` based on where it's currently exported.

- [ ] **Step 5: Run test, see FAIL**

```
pnpm --filter @fos/core test tests/golden/eval.test.ts
```

Expected: FAIL on provider-switch tests.

- [ ] **Step 6: Modify `makeEvalInvoke` to honor the env var**

Replace the current `makeEvalInvoke` body with:

```ts
function makeEvalInvoke(caseDir: string): InvokeFn {
  if (process.env.FOS_EVAL_REAL !== '1') {
    // Cached mode: read cached-response.json
    return async () => readFile(join(caseDir, 'cached-response.json'), 'utf8');
  }
  const provider = process.env.FOS_EVAL_PROVIDER ?? 'cli';
  if (provider === 'api') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) throw new Error('FOS_EVAL_PROVIDER=api requires ANTHROPIC_API_KEY');
    const model = process.env.FOS_EVAL_MODEL ?? 'claude-sonnet-4-6';
    return async (args) => {
      const { makeApiInvoke } = await import('./api-invoke.js');
      return makeApiInvoke(apiKey, model)(args);
    };
  }
  // Default: cli provider
  return async ({ systemPrompt, userInput }) => {
    const { invokeClaude } = await import('../../src/refiner/invoke.js');
    return invokeClaude({ systemPrompt, userInput, claudeBin: 'claude', timeoutMs: 120_000 });
  };
}
```

- [ ] **Step 7: Run test, verify PASS**

```
pnpm --filter @fos/core test tests/golden/eval.test.ts
```

All new tests pass + existing tests still pass.

- [ ] **Step 8: Commit**

```bash
git add packages/core/package.json pnpm-lock.yaml packages/core/tests/golden/api-invoke.ts packages/core/tests/golden/eval.test.ts
git commit -m "feat(eval): @anthropic-ai/sdk devDep + FOS_EVAL_PROVIDER switch"
```

---

### Task 2: `--snapshot-delta` flag + `iterations/` directory

**Files:**
- Modify: `packages/core/tests/golden/run-eval.mjs` — add `--snapshot-delta` flag handling.
- Modify: `packages/core/tests/golden/snapshot.ts` — add `writeIterationDelta` export.
- Modify: `packages/core/tests/golden/eval.test.ts` — honor new env var in final aggregate block.
- Modify: `.gitignore` (root or `packages/core/`) — ignore `tests/golden/iterations/`.

- [ ] **Step 1: Update `.gitignore`**

Append to repo-root `.gitignore`:

```
# Plan 4 per-iteration eval snapshots (not committed)
packages/core/tests/golden/iterations/
```

- [ ] **Step 2: Write failing test for `writeIterationDelta`**

Append to `packages/core/tests/golden/snapshot.test.ts` (create the test file if it doesn't exist):

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeIterationDelta } from '../../tests/golden/snapshot.js';

describe('writeIterationDelta', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-iter-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('writes a timestamped + hashed JSON file under iterations/', async () => {
    await writeIterationDelta({
      targetDir: tmp,
      refinerHash: 'sha256:abc123',
      mode: 'real',
      provider: 'api',
      model: 'claude-sonnet-4-6',
      metrics: [{ slug: 'sess-01', tags: [], concept_recall: 0.8, slug_reuse_precision: null, reasoning_preservation: 0.6, schema_valid: true, forbidden_slug_violations: 0 }],
      aggregate: { concept_recall: { p50: 0.8, p25: 0.8, mean: 0.8 }, slug_reuse_precision: { p50: 0, p25: 0, mean: 0, applicable_cases: 0 }, reasoning_preservation: { p50: 0.6, p25: 0.6, mean: 0.6 }, schema_valid_rate: 1, forbidden_violations: 0 },
    });
    const files = await readdir(tmp);
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}.*\.json$/);
    const parsed = JSON.parse(await readFile(join(tmp, files[0]!), 'utf8'));
    expect(parsed.refiner_hash).toBe('sha256:abc123');
    expect(parsed.mode).toBe('real');
    expect(parsed.provider).toBe('api');
    expect(parsed.aggregate.concept_recall.mean).toBe(0.8);
  });
});
```

- [ ] **Step 3: Implement `writeIterationDelta` in `snapshot.ts`**

The per-case records include `raw_response` — the actual refiner stdout text — so Phase 2's iteration subagent can diagnose weak cases without re-running the refiner.

```ts
import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { CaseMetrics, Aggregate } from './metrics.js';

export interface IterationCaseRecord extends CaseMetrics {
  raw_response?: string;        // the refiner's stdout text, for diagnosis
}

export interface IterationDeltaArgs {
  targetDir: string;             // absolute path to iterations/ dir
  refinerHash: string;
  mode: 'cached' | 'real';
  provider: 'cli' | 'api';
  model: string;
  metrics: IterationCaseRecord[];
  aggregate: Aggregate;
}

export async function writeIterationDelta(args: IterationDeltaArgs): Promise<string> {
  await mkdir(args.targetDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const shortHash = args.refinerHash.replace('sha256:', '').slice(0, 12);
  const filename = `${ts}-${shortHash}.json`;
  const path = join(args.targetDir, filename);
  const payload = {
    written_at: new Date().toISOString(),
    refiner_hash: args.refinerHash,
    mode: args.mode,
    provider: args.provider,
    model: args.model,
    aggregate: args.aggregate,
    per_case: args.metrics,
  };
  await writeFile(path, JSON.stringify(payload, null, 2), 'utf8');
  return path;
}
```

**Wiring note for Task 2 Step 5 (`eval.test.ts` modification):** the `recordingInvoke` wrapper in the existing eval flow already captures raw response text per case. Thread it into the `CaseMetrics` or a parallel array so `writeIterationDelta` has access. Exact plumbing:

1. In the per-case `it(...)` block, after `scoreCase`, store the captured `rawRefinerResponse` alongside the case metric: `caseMetrics.push({ ...metric, raw_response: rawRefinerResponse });` (widen the type to `IterationCaseRecord`).
2. In the final aggregate block where `writeIterationDelta` is called, pass the widened array.

- [ ] **Step 4: Wire `--snapshot-delta` into `run-eval.mjs`**

Add to the flag handling:

```js
if (flags.includes('--snapshot-delta')) {
  process.env['FOS_EVAL_MODE'] = 'snapshot-delta';
}
if (flags.includes('--real')) {
  process.env['FOS_EVAL_REAL'] = '1';
}
if (flags.includes('--api')) {
  process.env['FOS_EVAL_PROVIDER'] = 'api';
}
```

- [ ] **Step 5: Update `eval.test.ts` final aggregate block**

In the existing `it('aggregate report + baseline regression check', …)` test, add:

```ts
if (process.env.FOS_EVAL_MODE === 'snapshot-delta') {
  const { writeIterationDelta } = await import('./snapshot.js');
  const { createHash } = await import('node:crypto');
  const { readFile } = await import('node:fs/promises');
  const { dirname, join } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const hereDir = dirname(fileURLToPath(import.meta.url));
  const promptPath = join(hereDir, '..', '..', 'prompts', 'refiner-v1.md');
  const promptText = await readFile(promptPath, 'utf8');
  const refinerHash = `sha256:${createHash('sha256').update(promptText).digest('hex')}`;
  await writeIterationDelta({
    targetDir: join(hereDir, 'iterations'),
    refinerHash,
    mode: process.env.FOS_EVAL_REAL === '1' ? 'real' : 'cached',
    provider: (process.env.FOS_EVAL_PROVIDER as 'cli' | 'api') ?? 'cli',
    model: process.env.FOS_EVAL_MODEL ?? 'claude-sonnet-4-6',
    metrics: caseMetrics,
    aggregate: agg,
  });
  console.log('✓ wrote iteration delta');
}
```

- [ ] **Step 6: Test**

```
pnpm --filter @fos/core test tests/golden/snapshot.test.ts
pnpm --filter @fos/core eval --snapshot-delta   # runs cached mode, writes one iteration file
ls packages/core/tests/golden/iterations/
```

Expected: new file created, contents look right.

- [ ] **Step 7: Commit**

```bash
git add .gitignore packages/core/tests/golden/snapshot.ts packages/core/tests/golden/snapshot.test.ts packages/core/tests/golden/eval.test.ts packages/core/tests/golden/run-eval.mjs
git commit -m "feat(eval): --snapshot-delta flag + iterations/ per-run logging"
```

---

### Task 3: `tools/scrub-transcript.mjs` (Plan 3 Task 9 carryover)

**Files:**
- Create: `tools/scrub-transcript.mjs`
- Create: `tools/README.md`

Copy the code verbatim from Plan 3's Task 9 (`docs/superpowers/plans/2026-04-21-fos-v3-cleanup-and-quality-infra.md`). Full code is there. Test with the same smoke command:

```bash
echo '{"type":"user","message":{"role":"user","content":"hi from alice@example.com with sk-AAAAAAAAAAAAAAAAAAAAAAAAAA"}}' > /tmp/scrub-test.jsonl
node tools/scrub-transcript.mjs /tmp/scrub-test.jsonl /tmp/scrub-out.jsonl
cat /tmp/scrub-out.jsonl
```

Expected: `<redacted-email>`, `<redacted-token>`, no originals.

Commit: `feat(tools): scrub-transcript for mining real Claude Code transcripts`.

---

### Task 4: `scripts/pre-commit.sh` (Plan 3 Task 10 Steps 1-2 carryover)

**Files:**
- Create: `scripts/pre-commit.sh` (chmod +x)
- Modify: `packages/core/tests/golden/README.md` — add the "Mining real transcripts" + "Tag taxonomy" sections per Plan 3 Task 10 Step 2.

Copy both from Plan 3. Commit: `chore(golden): pre-commit secret guard + corpus README update`.

**(Plan 3 Task 10 Step 3 — retroactive tagging of the 3 Plan-1 cases — was already completed in Plan 3 at commit `bec42ab`. No action needed.)**

---

### Tasks 5–10: Mine 6 real cases (one per commit)

This is the authoring-heavy part. The subagent dispatching this work reads the allowed-roots constraint verbatim and picks ONE transcript per coverage theme. The user reviews each case before it commits.

**Allowed source directories (ENFORCED IN SUBAGENT PROMPT — do not mine from anywhere else):**
- `C:/Users/bsevern/.claude/projects/D--show_case/*.jsonl`
- `C:/Users/bsevern/.claude/projects/D--comprehension-debt/*.jsonl`

**Per-case procedure:**

1. Enumerate JSONLs in the allowed dirs. For each, read the first JSON line → extract `cwd` → double-check it's one of the two roots.
2. Pick ONE representative transcript for the target theme. Criteria per theme documented below.

**Fallback if no representative transcript exists** (e.g., no `refactor`-flavored session is in scope): skip that theme and compensate with one extra synthetic case in Tasks 11–17 covering the same behavior pattern. Record the skip in the completion notes (Task 27).
3. Run `node tools/scrub-transcript.mjs <input> <output> [--redact-word X]*` — output goes to the new case's `transcript.jsonl`.
4. Present the scrubbed `transcript.jsonl` to the user for review. Wait for approval.
5. Author `expected.json` — human-reviewable set of `required_slugs`, `forbidden_slugs`, `required_reasoning_substrings`, `tags`, `difficulty`. **Subagent must NOT run the refiner against this case during authoring** (corpus-gaming mitigation per spec §4.1).
6. Author `cached-response.json` — a plausible RefinerOutput that would satisfy `expected.json`. This satisfies the cached-mode regression gate; real-mode performance is what Plan 4 iterates against.
7. Show both `expected.json` and `cached-response.json` to the user. Wait for approval.
8. Commit the new case directory.

### Task 5: Case `sess-04-terse-user`

Theme: session where the user only typed short messages (< 10 words each). Tests refiner's ability to extract concepts when prose is thin.
Tags: `["terse-user", "mined"]`.

Per-case procedure above. Commit message: `test(golden): sess-04-terse-user mined case`.

### Task 6: Case `sess-05-long-session`

Theme: a session spanning 50+ events, possibly multi-topic.
Tags: `["long-session", "multi-turn-pivot", "mined"]`.

Commit message: `test(golden): sess-05-long-session mined case`.

### Task 7: Case `sess-06-multiple-concepts`

Theme: a session introducing 3+ distinct concepts (e.g., a new feature that touches parser + writer + deriver).
Tags: `["multiple-concepts", "mined"]`.

Commit message: `test(golden): sess-06-multiple-concepts mined case`.

### Task 8: Case `sess-07-refactor`

Theme: a session performing a refactor of existing code.
Tags: `["refactor", "mined"]`.

Commit message: `test(golden): sess-07-refactor mined case`.

### Task 9: Case `sess-08-debugging`

Theme: a session debugging a specific issue.
Tags: `["bug-fix", "debugging", "mined"]`.

Commit message: `test(golden): sess-08-debugging mined case`.

### Task 10: Case `sess-09-no-concepts`

Theme: a session with no architectural content (chitchat, wrong-project, abandoned). Expected output: zero concepts. Tests the refiner doesn't hallucinate when there's nothing to extract.
Tags: `["no-concepts-expected", "mined"]`.
`cached-response.json`: `{"concepts":[],"unknowns":[]}`.

Commit message: `test(golden): sess-09-no-concepts mined case`.

---

### Tasks 11–17: Author 7 synthetic cases

Synthetic cases are fully subagent-authored (no privacy risk). Still subject to the **subagent must NOT run the refiner during authoring** constraint. Author `transcript.jsonl` from scratch, author `expected.json` from the theme's definition, author `cached-response.json` satisfying expected.

### Task 11: `sess-10-conflicting-decisions`

Transcript: assistant picks approach A, then pivots to B after the user pushes back. The expected concept captures the PIVOT, not both.
Tags: `["conflicting-decisions", "synthetic"]`. `difficulty: "hard"`.
Commit: `test(golden): sess-10-conflicting-decisions synthetic case`.

### Task 12: `sess-11-implicit-reasoning`

Transcript: assistant makes a decision without explicitly saying "because X" — the reasoning is implicit in the code changes. Tests whether the refiner can infer or correctly flag as `reasoning-unknown`.
Tags: `["implicit-reasoning", "synthetic"]`. `difficulty: "hard"`.
Commit: `test(golden): sess-11-implicit-reasoning synthetic case`.

### Task 13: `sess-12-abandoned-path`

Transcript: assistant starts approach A, realizes it's wrong, abandons, starts B. Expected: only B as a concept; A should NOT appear.
Tags: `["abandoned-path", "synthetic"]`. `difficulty: "medium"`.
Commit: `test(golden): sess-12-abandoned-path synthetic case`.

### Task 14: `sess-13-slug-reuse`

Transcript: mentions an existing concept (provided via `slug_reuse_context`), expects the refiner to reuse the slug.
Tags: `["slug-reuse", "synthetic"]`. `difficulty: "medium"`.
Commit: `test(golden): sess-13-slug-reuse synthetic case`.

### Task 15: `sess-14-empty-transcript`

Transcript: a single line with one user message, no assistant reply. Edge case.
Tags: `["empty-transcript", "synthetic"]`. `difficulty: "easy"`. `cached-response.json`: `{"concepts":[],"unknowns":[]}`.
Commit: `test(golden): sess-14-empty-transcript synthetic case`.

### Task 16: `sess-15-tool-heavy`

Transcript: almost all tool calls (Read / Edit / Bash), minimal prose. Tests concept extraction from tool patterns.
Tags: `["tool-heavy", "synthetic"]`. `difficulty: "medium"`.
Commit: `test(golden): sess-15-tool-heavy synthetic case`.

### Task 17: `sess-16-pure-narrative`

Transcript: assistant explanation + user follow-up questions, NO tool calls.
Tags: `["pure-narrative", "synthetic"]`. `difficulty: "medium"`.
Commit: `test(golden): sess-16-pure-narrative synthetic case`.

---

### Task 18: Re-snapshot baseline.json with expanded corpus

After all 13 new cases are committed (16 total with the 3 existing):

- [ ] **Step 1: Run the cached-mode snapshot**

```bash
pnpm --filter @fos/core eval --snapshot
```

Expected: baseline.json regenerates with 16 cases. Since cached responses were authored to satisfy expected, metrics should be ~1.0 across the board.

- [ ] **Step 2: Run regression gate**

```bash
pnpm --filter @fos/core eval
```

Expected: all cases pass, no regressions.

- [ ] **Step 3: Commit**

```bash
git add packages/core/tests/golden/baseline.json
git commit -m "chore(eval): snapshot baseline.json with 16-case corpus (cached mode)"
```

**End of Phase 0:** 16 cases committed, eval provider switch works, baseline.json reflects the expanded corpus.

---

## Phase 1 — Honest starting line

### Task 19: Measure refiner-v1.0.0 against the real API

- [ ] **Step 1: Ensure API wallet + key**

Confirm `ANTHROPIC_API_KEY` is set in the shell (or pass inline). Confirm the wallet has ≥ $5 before starting.

- [ ] **Step 2: Run the eval**

```bash
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

Expected: ~$1 burned, ~8 min wall-clock. One new file under `packages/core/tests/golden/iterations/`.

- [ ] **Step 3: Inspect the numbers**

```bash
cat packages/core/tests/golden/iterations/*.json | tail -1 | jq '.aggregate'
```

Record:
- `concept_recall.mean`
- `slug_reuse_precision.mean` (+ `applicable_cases`)
- `reasoning_preservation.mean`
- `schema_valid_rate`
- `forbidden_violations`

Compare against §8.2 bars (0.90 / 0.95 / 0.80 / 0.99 / 0).

- [ ] **Step 4: Decision gate**

- If ALL §8.2 bars met → SKIP Phases 2–3. Jump to Phase 4 (Task 22). Plan 4 done sooner than expected. Note starting numbers in Task 27's completion notes.
- If any bar is NOT met → proceed to Phase 2 (Task 20).

- [ ] **Step 5: No commit required** — iterations/ is gitignored.

---

## Phase 2 — AI-assisted iteration loop

### Task 20: Iteration loop (runs until handoff to Phase 3 or until a stop condition fires)

This is NOT a single atomic task. It's a **procedure you execute repeatedly**. Each loop iteration is ~$1 + one subagent dispatch + one manual review.

**Per iteration — repeat until handoff or stop:**

- [ ] **A. Measure**

```bash
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

Note wall time (~8 min) + check wallet burn.

- [ ] **B. Check stop conditions**

Count total iterations so far (files in `packages/core/tests/golden/iterations/` since Phase 1):
- If ≥ 25 total → STOP. Jump to Phase 4 with whatever numbers you have.
- Sum approximate cost (iteration count × $1, ± actual model pricing). If ≥ $40 → STOP. Jump to Phase 4.
- Compare the last 3 iterations' primary failing metric. If all three gained < 2% → either transition to Phase 3 (human polish) or STOP to Phase 4.

- [ ] **C. Check success condition**

If latest iteration's aggregate now meets all §8.2 bars on Sonnet → STOP Phase 2. Jump to Phase 4.

- [ ] **D. Dispatch iteration subagent**

Use this dispatch prompt template (copy into the Task tool):

```
You are proposing a refiner prompt edit. You are NOT the refiner itself.

## Your inputs

1. Current refiner prompt: `packages/core/prompts/refiner-v1.md` (read the file).
2. Latest eval metrics: `packages/core/tests/golden/iterations/<NEWEST>.json` (read the file).
3. Per-case raw refiner outputs: read them directly from `iterations/<NEWEST>.json` — each `per_case[i]` entry has a `raw_response` field containing the actual refiner stdout for that case. For weak cases, compare `raw_response` to the case's `expected.json` to identify the specific gap.
4. Target bars:
   - concept_recall ≥ 0.90
   - slug_reuse_precision ≥ 0.95
   - reasoning_preservation ≥ 0.80
   - schema_valid_rate ≥ 0.99
   - forbidden_violations = 0
5. Previous iteration's metrics (for delta reference): `packages/core/tests/golden/iterations/<PREV>.json`.

## Your job

Read the weak cases — those where the aggregate-failing metric is below bar for that case. Diagnose WHY the refiner is falling short (concept missed, slug reused incorrectly, reasoning missing, schema violation, etc.). Propose the MINIMUM prompt edit that would close the identified gap.

## Output format

Produce a unified-diff patch against `packages/core/prompts/refiner-v1.md`. One diff, not a rewrite. Keep edits surgical: added instructions, clarified directives, new few-shot examples. Do NOT rewrite the whole prompt.

## Hard rules

- You may not run the refiner, invoke any eval, or execute code. You read, diagnose, propose.
- You may not edit any file other than `refiner-v1.md`.
- You may not modify the JSON schema of refiner output. v1.x must stay output-compatible.
- Diff must apply cleanly to the current refiner-v1.md.

## Report

Return:
- The unified diff (as a code block).
- A 1-paragraph rationale per hunk: what case(s) motivated this change, what the expected impact is.
```

(No extra attachment step — `iterations/<NEWEST>.json` already embeds `per_case[i].raw_response` for every case, produced by Task 2's `writeIterationDelta` wiring.)

- [ ] **E. Review the subagent's diff**

Read the diff carefully. Questions to ask:
- Does the rationale hold up?
- Does the edit address the stated case without breaking others?
- Does the edit match the refiner prompt's established voice/style?
- Is any instruction contradicting an earlier one?

Options:
- **Accept** — apply the diff as-is: `git apply <subagent-diff-file>` or paste the new prompt content.
- **Tweak** — apply + manually adjust.
- **Reject** — discard, note why in a scratchpad, continue the loop (next iteration might produce a better diff).

- [ ] **F. Run the new eval**

Loop back to A.

**Handoff trigger (transition to Phase 3 — Task 21):** three consecutive iterations' subagent-proposed edits produced a primary-failing-metric gain of < 2%.

---

## Phase 3 — Human polish loop

### Task 21: Hand-edit the prompt

**Same measurement loop as Phase 2, subagent-assist off.** You edit `refiner-v1.md` directly based on your own diagnosis of the latest `iterations/<NEWEST>.json`.

**Per polish iteration:**

- [ ] **A. Eval** — same command as Phase 2 step A.
- [ ] **B. Check stop conditions** — same as Phase 2 step B (iteration counter includes Phase 2 runs).
- [ ] **C. Check success** — same as Phase 2 step C.
- [ ] **D. Inspect + hand-edit** — read the weakest cases' raw outputs, modify `refiner-v1.md` based on your own judgment, save.
- [ ] **E. Loop back to A.**

**Phase 3 typically runs 2–5 iterations if it runs at all.** Exit on same stop conditions as Phase 2.

---

## Phase 4 — Tier verification

### Task 22: Verify on Opus

- [ ] **Step 1: Run eval against Opus**

```bash
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api FOS_EVAL_MODEL=claude-opus-4-7 ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

Cost ~$3.

- [ ] **Step 2: Compare to Sonnet numbers**

Read the newest `iterations/` file. Opus numbers should be ≥ Sonnet numbers (Opus is strictly more capable).

- [ ] **Step 3: If Opus meets bars (expected)**, no action. Record the numbers for Phase 5.

- [ ] **Step 4: If Opus numbers are lower than Sonnet somehow** — unexpected; investigate. Might indicate a prompt edit in Phase 2/3 that specifically benefited Sonnet's behavior at Opus's expense. Note as a risk in the completion notes.

---

### Task 23: Verify on Haiku (+ optional Phase 4a polish, or Phase 4b graceful degradation)

- [ ] **Step 1: Run eval against Haiku**

```bash
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api FOS_EVAL_MODEL=claude-haiku-4-5 ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

Cost ~$0.30.

- [ ] **Step 2: Check against §8.2 bars**

If Haiku meets all bars: great. Continue to Phase 5. Record numbers.

- [ ] **Step 3: If Haiku misses a bar: Phase 4a — tier-specific polish**

Up to ~5 additional iterations (~$1.50 budget) where the prompt is edited with Haiku-specific refinements (e.g., extra few-shot examples, more explicit schema reminders, simpler phrasings). Each iteration re-runs Haiku only.

- [ ] **Step 4: If Phase 4a succeeds**, Haiku now meets bars. Continue to Phase 5. Record numbers.

- [ ] **Step 5: If Phase 4a fails (bars still missed after 5 iterations or budget depleted)**: Phase 4b — graceful degradation.

Document the known gap:
- Update `packages/plugin/README.md` with a "Model tier recommendations" section listing Haiku's measured numbers + note it's a graceful-degradation tier.
- baseline.json's `per_tier.haiku` records the actual numbers; bars are not enforced for Haiku.

Continue to Phase 5.

---

## Phase 5 — Ship

### Task 24: Create `refiner-v1.1.md` + bump version

- [ ] **Step 1: Copy the iterated prompt**

```bash
cp packages/core/prompts/refiner-v1.md packages/core/prompts/refiner-v1.1.md
```

- [ ] **Step 2: Update `SHIPPED_REFINER_VERSION` in `load-prompt.ts`**

Edit `packages/core/src/refiner/load-prompt.ts`:

```ts
export const SHIPPED_REFINER_VERSION = 'v1.1.0';
```

Update the `shippedPromptPath()` function to reference `refiner-v1.1.md` if it's currently hardcoded to `refiner-v1.md`. (If it auto-discovers by pattern, no change needed.)

- [ ] **Step 3: Revert `refiner-v1.md` to its pre-Plan-4 state** (historical record)

```bash
git checkout main -- packages/core/prompts/refiner-v1.md
```

This restores the v1.0.0 content to `refiner-v1.md`, while the iterated content lives in `refiner-v1.1.md`. The file stays in-tree as an archive.

- [ ] **Step 4: Rebuild + run full test suite**

```bash
pnpm build
pnpm test
```

All 245+ tests still pass (unit tests use mocked refiner outputs; the prompt change doesn't affect them).

- [ ] **Step 5: Rerun Phase 1's starting-line check, but now with v1.1 loaded**

```bash
pnpm --filter @fos/core build   # ensures load-prompt.ts changes are compiled
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

Confirm the numbers match what Phase 2/3 ended on. Sanity check.

- [ ] **Step 6: Commit**

```bash
git add packages/core/prompts/refiner-v1.1.md packages/core/src/refiner/load-prompt.ts packages/core/prompts/refiner-v1.md
git commit -m "feat(core): ship refiner-v1.1.md; SHIPPED_REFINER_VERSION=v1.1.0"
```

---

### Task 25: Snapshot final baselines

- [ ] **Step 1: Cached-mode snapshot**

```bash
pnpm --filter @fos/core eval --snapshot
```

baseline.json now reflects v1.1.0 in cached mode.

- [ ] **Step 2: Real-mode snapshot (decide location)**

Decide whether to put the real-mode numbers into `baseline.json` (add a `per_tier` + `mode_metadata` sub-block) or into a separate `baseline-real.json`. Recommend: if `per_tier` already exists from Phase 4, just extend baseline.json to include a top-level `real_mode_snapshot` field. If it starts getting messy, split into `baseline-real.json`.

Either way, ensure the file records:
- Timestamp, refiner hash, mode, provider, model.
- Per-tier aggregate numbers (Sonnet, Opus, Haiku).
- Top-level aggregate (Sonnet, the primary).

```bash
# Option A: inline
jq '...' packages/core/tests/golden/iterations/<opus-run>.json >> update baseline.json

# Option B: separate file
cp packages/core/tests/golden/iterations/<real-sonnet-run>.json packages/core/tests/golden/baseline-real.json
# (then edit to normalize + add per_tier Opus + Haiku blocks)
```

The cleanest approach in practice: manually merge the three real-mode iteration files (sonnet, opus, haiku from Tasks 22–23) into a single `baseline-real.json`.

- [ ] **Step 3: Commit both**

```bash
git add packages/core/tests/golden/baseline.json packages/core/tests/golden/baseline-real.json
git commit -m "chore(eval): snapshot v1.1.0 baselines (cached + real per-tier)"
```

---

### Task 26: `claude -p` sanity check

The iteration used `@anthropic-ai/sdk`. Production uses `claude -p`. Confirm the prompt works similarly through the CLI.

- [ ] **Step 1: Run real-mode via CLI provider**

```bash
FOS_EVAL_REAL=1 pnpm --filter @fos/core eval --snapshot-delta
```

(No `FOS_EVAL_PROVIDER=api` → uses CLI provider.) Burns Max quota for one full eval (~8 min).

- [ ] **Step 2: Compare to real-mode API numbers**

Inspect the latest `iterations/` file. Numbers should be comparable (± 5%) to the API-mode Sonnet numbers from Task 22-ish time frame.

- [ ] **Step 3: Document the comparison in the completion notes**

If numbers diverge materially (> 10% on any primary bar), record it as a known risk in Task 27's completion notes. Don't block the merge — publication (Plan 5) will revisit.

- [ ] **Step 4: No commit** — iterations/ gitignored.

---

### Task 27: Write completion notes

**Files:**
- Create: `docs/superpowers/plans/2026-04-21-fos-v4-completion-notes.md`

- [ ] **Step 1: Draft the notes**

Template:

```markdown
# Plan 4 Completion Notes

**Merge commit:** <tbd>
**Branch:** `feat/plan-4-refiner-iteration`
**Corpus size at completion:** 16 cases (6 mined + 7 synthetic + 3 grandfathered from Plan 1).

## Which stop condition fired

- [ ] §8.2 bars met on Sonnet
- [ ] 25-iteration cap reached
- [ ] $40 budget consumed
- [ ] 3-iteration convergence stall
- [ ] (Other — explain)

## Final numbers

### Cached mode (baseline.json)
- concept_recall.mean: <>
- slug_reuse_precision.mean: <> (applicable_cases: <>)
- reasoning_preservation.mean: <>
- schema_valid_rate: <>

### Real mode — Sonnet (baseline-real.json or baseline.json per-tier)
- concept_recall.mean: <>
- slug_reuse_precision.mean: <> (applicable_cases: <>)
- reasoning_preservation.mean: <>
- schema_valid_rate: <>
- §8.2 bars status: <✅ all met / ❌ recall: below by X%>

### Real mode — Opus
<>

### Real mode — Haiku
<>
- Phase 4a polish attempted? <yes/no>
- Graceful degradation (Phase 4b)? <yes/no — if yes, link README section>

## Iteration summary

Total iterations: <N>
- Phase 2 (AI-assisted): <X>
- Phase 3 (human polish): <Y>
- Phase 4a (Haiku polish): <Z>

Total API cost: <$ amount based on wallet check>

## Divergence between API and CLI providers

<Numbers from Task 26 comparison. If >10% on any metric, explain.>

## Known risks carried forward

- Marketplace publication (Plan 5) depends on ≥ 50 session-hours of dogfood; status as of merge: <>
- <any iteration artifacts worth flagging>
```

- [ ] **Step 2: Fill in the numbers + narrative**

Consult `packages/core/tests/golden/iterations/` for exact numbers.

- [ ] **Step 3: Commit**

```bash
git add docs/superpowers/plans/2026-04-21-fos-v4-completion-notes.md
git commit -m "docs(plans): Plan-4 completion notes"
```

---

### Task 28: Rebuild + manual dogfood + merge prep

- [ ] **Step 1: Final rebuild**

```bash
pnpm build
pnpm test
```

Confirm 245+ tests still pass.

- [ ] **Step 2: Plugin dogfood**

```bash
pnpm --filter @fos/plugin build
claude plugins uninstall comprehend-fos@fos-dev
claude plugins install comprehend-fos@fos-dev
mkdir /tmp/plan4-dogfood
cd /tmp/plan4-dogfood
git init -q
claude --dangerously-skip-permissions
# inside: /comprehend-fos:comprehend-init → accept, skip backfill
# type a quick user message, get a reply, /exit
# wait ~40s for worker to complete
```

- [ ] **Step 3: Verify new session's frontmatter shows v1.1.0**

```bash
head -10 /tmp/plan4-dogfood/.comprehension/sessions/*.md
```

Expected: `refiner_version: v1.1.0` in the frontmatter. (NOT v1.0.0.)

- [ ] **Step 4: Merge back to main**

```bash
git checkout main
git merge --no-ff feat/plan-4-refiner-iteration -m "Merge Plan 4 — refiner iteration (v1.1.0)"
git log --oneline -3
```

**Plan 4 complete.**

---

## Plan 4 Completion Criteria

All of these must be objectively true before calling Plan 4 done:

- [ ] 16+ cases in `packages/core/tests/golden/corpus/` (6 mined + 7 synthetic + 3 existing).
- [ ] `tools/scrub-transcript.mjs` + `scripts/pre-commit.sh` exist.
- [ ] `packages/core/prompts/refiner-v1.1.md` exists.
- [ ] `packages/core/prompts/refiner-v1.md` retained as archive (v1.0.0 content).
- [ ] `SHIPPED_REFINER_VERSION === "v1.1.0"`.
- [ ] `packages/core/tests/golden/baseline.json` regenerated.
- [ ] Real-mode numbers recorded (either in baseline.json per-tier or `baseline-real.json`).
- [ ] `pnpm --filter @fos/core eval --real --api --snapshot-delta` runs end-to-end.
- [ ] `@anthropic-ai/sdk` is `devDependencies` only; plugin dist size unchanged.
- [ ] Dogfood confirms new sessions' frontmatter shows `refiner_version: v1.1.0`.
- [ ] Completion notes (`docs/superpowers/plans/2026-04-21-fos-v4-completion-notes.md`) committed with final numbers + stop-condition reasoning.
- [ ] Merged to `main` via `--no-ff`.
- [ ] All 245+ existing tests still pass.

**NOT completion criteria:**

- §8.2 bars met on all tiers (desirable, not required — stop conditions handle the other path).
- Marketplace publication (Plan 5).
- ≥ 50 session-hours dogfood.
- `eval-history.jsonl` historical log.
