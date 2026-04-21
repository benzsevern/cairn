# FOS Plan 3 — Cleanup + Quality Infrastructure — Design

**Status:** Approved (brainstorming phase) — ready for implementation planning
**Date:** 2026-04-21
**Author:** brainstormed with Claude Opus 4.7 (1M context)
**Next step:** implementation plan via `superpowers:writing-plans`
**Depends on:** Plan 1 (`@fos/core`, merged at `06b7015`) + Plan 2 (`@fos/plugin`, merged at `05a3474`).

---

## 0. Context

Plans 1 and 2 shipped the full retrospective-comprehension loop end-to-end: `@fos/core` analyzes Claude Code session transcripts via `claude -p`, `@fos/plugin` wraps it in a Claude Code plugin with a detached-background Stop hook. Users can install the plugin, opt a project in, and the plugin passively produces comprehension artifacts on every session end.

Plan 3 is the **last plan before Plan 4 tackles refiner quality + marketplace publication**. It handles three categories of work:

1. **Residuals from Plans 1 and 2:** the install-time consent script never actually runs (post-merge dogfood finding); `/comprehend rerun` was deferred from Plan 2; the `analysis.lock` tmp+rename primitive is racy and should use O_EXCL like `queue.lock` already does.
2. **Quality-measurement infrastructure:** expand the golden corpus from 3 to 13+ cases, build a metrics harness that reports §8.2 spec numbers, commit a baseline snapshot.
3. **No quality iteration, no publication.** Those are Plan 4.

The goal is a clean, plannable cycle that ends with measured numbers — Plan 4 can then iterate the refiner prompt against a live benchmark.

---

## 1. Product Shape

Five mechanical work items landing on `main` after Plans 1 + 2:

| Item | Why it's in Plan 3 | Rough effort |
|---|---|---|
| Consent-flow redesign | Plan 2 residual; current install-ack gate is user-hostile | 1–2 days |
| `/comprehend rerun` with 3 modes | Deferred command from Plan 2 | 1–2 days |
| `analysis.lock` O_EXCL upgrade + lock primitive refactor | Plan 2 final-review tech debt | 1 day |
| Golden corpus expansion (3 → ~13 cases) | Spec §8.2 measurement prerequisite | 3–5 days |
| A/B eval harness: metrics + diffing + baseline.json | Spec §8.2 scoring infrastructure | 2–3 days |

**End state:** cleaner onboarding UX; rerun command available; locks atomic and deduplicated; refiner-v1 is measured against a 13-case corpus with a committed `baseline.json` recording exactly where it stands on §8.2 metrics today.

**Locked decisions** (from brainstorming):

| Decision | Choice |
|---|---|
| Consent UX | One-time machine-wide consent on first `/comprehend-fos:comprehend-init`. Ack stored at `~/.claude/fos-install-ack`. |
| `/comprehend rerun` modes | Three: bare = rebuild only (deriver, no refiner); `--session <id>` = re-analyze one session; `--all` = re-analyze all. |
| Golden corpus composition | 4–6 real mined + 6–8 synthetic. ~13 total including Plan 1's 3. |
| Eval harness scope | Metrics + diffing via `--against <git-ref>`. `tests/golden/baseline.json` committed. Regenerable with `pnpm eval --snapshot`. No historical tracking. |
| Lock refactor | Single `acquireExclusiveLock(path, content, staleAfterMs)` primitive consumed by both `tryAcquireLock` and `tryAcquireQueueLock`. |

**Explicitly NOT in Plan 3:**

- Refiner prompt iteration to hit §8.2 numeric bars (Plan 4).
- Marketplace publication (Plan 4).
- Multi-prompt A/B experimentation tooling beyond single-pair `--against` diffing.
- Historical quality tracking (`eval-history.jsonl`).
- Plugin bundle size reduction / `sideEffects: false`.
- Terminal injection, fog-of-war, fractal fan-out — Plan vNext+.
- Schema migrations for existing `.comprehension/` data (no breaking schema changes planned).

---

## 2. Architecture & Components

### 2.1 Lock primitive refactor

**Files touched:**
- `packages/plugin/src/lock.ts` — restructure around a single `acquireExclusiveLock` helper.
- `packages/plugin/tests/unit/lock.test.ts` — tests collapse onto the primitive + thin per-consumer assertions.

**Design:**

```ts
interface ExclusiveLockArgs {
  lockPath: string;
  content: string;                        // JSON-serialized record written to file
  staleAfterMs: number;
  now: () => Date;
  pidForStalenessCheck?: number | null;   // null = skip liveness check (queue);
                                          // number = reclaim if dead (analysis)
  maxAttempts?: number;                   // O_EXCL retry budget (default 20)
  backoffMs?: number;                     // default 15
}

async function acquireExclusiveLock(args: ExclusiveLockArgs): Promise<boolean>;
async function releaseExclusiveLock(lockPath: string): Promise<void>;
```

`tryAcquireLock` (analysis.lock) and `tryAcquireQueueLock` become one-line wrappers:
- Analysis: `staleAfterMs = 30 * 60 * 1000`, `pidForStalenessCheck = existing.pid`.
- Queue: `staleAfterMs = 10 * 1000`, `pidForStalenessCheck = null`.

**Ordering:** this goes first. Every other item writes lock-protected state; clean foundation prevents cascading fixes later.

### 2.2 `/comprehend rerun`

**Files touched:**
- `packages/plugin/src/cli/commands/comprehend-rerun.ts` — new subcommand impl.
- `packages/plugin/src/cli/bin.ts` — register in commander.
- `packages/plugin/commands/comprehend-rerun.md` — new prompt template.
- `packages/plugin/tests/cli/commands/comprehend-rerun.test.ts` — new tests.

**CLI interface:**

```
Usage: bin.js rerun [<session_id>] [--all] [--force] [--dry-run] [--show-preview]

Flags:
  --all             Re-analyze every session.md on disk. Requires confirmation
                    unless --force is passed.
  --force           Skip the "refiner version matches" warning on --all.
  --dry-run         Print what would run + cost estimate; no refiner calls.
  --show-preview    Emit JSON {mode, count, estimated_cost_usd_low,
                    estimated_cost_usd_high, refiner_version_current,
                    refiner_version_on_sessions} and exit 0. Used by markdown.

Bare invocation (no args/flags) = rebuild only (deriver re-runs, no refiner).
```

**Markdown template** (`comprehend-rerun.md`) mirrors the `backfill` pattern:
1. Bash-probe `bin.js rerun --show-preview` (with optional `--session <id>`/`--all`).
2. `AskUserQuestion` with options *Rebuild only*, *Re-analyze current session*, *Re-analyze all sessions ($X–$Y)*, *Cancel*.
3. Exec chosen mode via the CLI.

**Exit codes:** 0 success, 1 refiner failure, 2 aborted/cancelled, 3 not opted in, 4 lock held (for `--session`/`--all`).

**Lock behavior:**
- Bare (rebuild only) — no lock.
- `--session` — acquires analysis lock synchronously like `/comprehend`.
- `--all` — acquires analysis lock for the entire batch run.

**`backfill_batch` log event reuse** — `--all` writes a `backfill_batch` log event at completion with `mode: 'rerun'`. `/comprehend status`'s last-3-runs renderer labels it accordingly.

### 2.3 Consent-flow redesign

**Files touched:**
- `packages/plugin/commands/comprehend-init.md` — add consent-gate block at top.
- `packages/plugin/src/cli/commands/comprehend-init.ts` — extend `--show-consent` output; add `--accept-machine-consent` flag.
- `packages/plugin/install/post-install.js` — **delete** (never ran).
- `packages/plugin/install/package.json` — **delete** (no longer needed).
- `packages/plugin/tests/integration/plugin-smoke.test.ts` — remove install/post-install assertions.
- `packages/plugin/tests/cli/commands/comprehend-init.test.ts` — new cases for ack-missing + ack-present paths.
- `docs/user/data-flow.md` — new: plain-prose data-flow statement referenced by the consent text.

**Markdown flow:**

1. Bash-probe `bin.js init --show-consent`. Returned JSON now includes:
   - `install_ack: boolean`
   - `consent_required_text: string | null` (non-null iff `install_ack` is false)
2. If `consent_required_text` is non-null:
   - Display the text as a plain assistant message.
   - Use `AskUserQuestion` with options: *Accept and continue* / *Read the linked data-flow doc first* / *Decline*.
   - On Accept: pass through to step 3 with `--accept-machine-consent`.
   - On Read first: Bash `cat docs/user/data-flow.md`, present, re-ask.
   - On Decline: exit quietly, no files written.
3. Step 3 onward = existing project-level opt-in: `AskUserQuestion` for consent scope → `bin.js init --accept [--skip-backfill]`.

**CLI changes:**
- `--show-consent` returns `consent_required_text` when ack is missing.
- `--accept` without `--accept-machine-consent` refuses to proceed if ack is missing (exit 1, unchanged from today).
- `--accept --accept-machine-consent` touches `~/.claude/fos-install-ack` as its first step, then runs the normal `--accept` flow.
- Per-project `--accept` without the machine flag continues to work when ack is already present.

### 2.4 Golden corpus expansion

**Files touched:**
- `packages/core/tests/golden/corpus/<slug>/` — 10 new case directories (4–6 mined + 6–8 synthetic).
- `packages/core/tests/golden/README.md` — authoring workflow + tag taxonomy.
- `tools/scrub-transcript.mjs` — new utility for mining real transcripts.
- `.husky/pre-commit` (or similar) — pre-commit warning for common secret patterns under `tests/golden/corpus/`.

**`scrub-transcript.mjs`** reads a JSONL file and redacts:
- File paths containing `/Users/<x>/` or `C:\Users\<x>\` → `<HOME>`.
- Email addresses → `<redacted-email>`.
- API-key-looking tokens (`sk-...`, `ghp_...`, long base64) → `<redacted-token>`.
- User-supplied `--redact-word <w>` (repeatable) → `<redacted-word>`.

Output goes to a target directory. Flags suspect lines that look sensitive but weren't auto-redacted. **Author must manually read the final `transcript.jsonl` before `git add`** — script + pre-commit warning are backstops, not replacements.

**Case directory shape** (unchanged from Plan 1):

```
sess-NN-<slug>/
├── transcript.jsonl     # scrubbed (mined) or handcrafted (synthetic)
├── expected.json        # human-authored; see §3.1
├── cached-response.json # valid RefinerOutput satisfying expected
└── notes.md             # optional authoring notes
```

**Case coverage targets** (author's judgment during mining):
- **Mined:** `terse-user`, `long-session`, `multiple-concepts`, `refactor`, `debugging`, `no-concepts-expected`.
- **Synthetic:** `conflicting-decisions`, `implicit-reasoning`, `abandoned-path`, `slug-reuse-across-sessions`, `rejected-alternative-only`, `empty-transcript`, `tool-heavy`, `pure-narrative`.

### 2.5 Eval harness + baseline

**Files touched:**
- `packages/core/tests/golden/eval.test.ts` — expand from required-slug/forbidden-slug/substring checks into a metrics emitter.
- `packages/core/tests/golden/metrics.ts` — new module: per-case + aggregate scoring.
- `packages/core/tests/golden/diff.ts` — new module: compare two runs.
- `packages/core/tests/golden/baseline.json` — committed snapshot of refiner-v1's scores.
- `packages/core/package.json` — `scripts.eval` enhancements: `--snapshot`, `--against <ref>`, `--real` (alias for `FOS_EVAL_REAL=1`).

**Per-case metrics:**

```ts
interface CaseMetrics {
  slug: string;
  tags: string[];
  concept_recall: number;           // 0..1; matched required_slugs / total required
  slug_reuse_precision: number | null;  // 0..1; null when no slug_reuse_context
  reasoning_preservation: number;   // 0..1; required_reasoning_substrings matched
  schema_valid: boolean;            // refiner output first-parse validity
  forbidden_slug_violations: number;
  elapsed_ms?: number;              // only populated under real-invoke mode
}
```

**Aggregate report:**

```
Eval against refiner-v1.0.0 (sha256:73f91c…), mode=cached, cases=13/13 ran
  concept_recall:         p50=0.92, p25=0.83, mean=0.85, n=13
  slug_reuse_precision:   p50=1.00, p25=1.00, mean=0.98, n=9 applicable
  reasoning_preservation: p50=0.80, p25=0.67, mean=0.74, n=13
  schema_valid:           13/13 (100%)
  forbidden_violations:   0

Spec §8.2 bars (display-only, NOT enforced in Plan 3):
  recall        ≥ 0.90  — current 0.85 corpus-avg   [below bar]
  slug-reuse    ≥ 0.95  — current 0.98              [above bar]
  reasoning     ≥ 0.80  — current 0.74              [below bar]
  schema-valid  ≥ 0.99  — current 1.00              [above bar]
```

**Diffing** (`pnpm eval --against <git-ref>`): run current refiner, load baseline from git at `<ref>`, report per-case deltas.

**Snapshot** (`pnpm eval --snapshot`): write current metrics to `baseline.json`. Commit manually.

**Regression gate** (normal `pnpm eval`): fail if any case's `concept_recall` drops by more than 5% OR `schema_valid` drops by more than 2% vs. committed baseline. Tolerance accommodates refiner non-determinism in cached mode (which should be zero but might surface from future corpus churn).

**Tolerance config** in `baseline.json`:

```json
{
  "tolerance": {
    "concept_recall_pct": 0.05,
    "schema_valid_pct": 0.02,
    "reasoning_preservation_pct": 0.10
  }
}
```

---

## 3. Data Model

Three changes. Everything else unchanged.

### 3.1 `expected.json` — new fields

```json
{
  "required_slugs": ["fuzzy-matching"],
  "slug_reuse_context": ["entity-resolution"],
  "required_reasoning_substrings": { "fuzzy-matching": ["levenshtein", "unicode"] },
  "forbidden_slugs": ["trigram-matching"],

  "tags": ["algorithmic-choice", "mined"],
  "difficulty": "medium",
  "notes": "optional free-form authoring note"
}
```

**`tags: string[]`** — canonical set enforced by `metrics.ts`'s `TAGS` constant:
`algorithmic-choice`, `refactor`, `bug-fix`, `multi-turn-pivot`, `terse-user`, `no-concepts-expected`, `slug-reuse`, `conflicting-decisions`, `implicit-reasoning`, `abandoned-path`, `tool-heavy`, `pure-narrative`, `mined`, `synthetic`.

Unknown tags print a warning during eval but don't fail; new tags require updating the `TAGS` constant.

**`difficulty`** — optional, applies mainly to synthetic cases. `easy` | `medium` | `hard`.

**`notes`** — optional, free-form, never read by eval.

**Backward compat:** Plan 1's 3 cases get tags added during Plan 3. No schema break.

### 3.2 `baseline.json` — new file

Committed at `packages/core/tests/golden/baseline.json`. Shape:

```json
{
  "generated_at": "2026-04-21T16:00:00Z",
  "refiner_version": "v1.0.0",
  "refiner_prompt_hash": "sha256:73f91c...",
  "mode": "cached",
  "corpus_size": 13,
  "tolerance": {
    "concept_recall_pct": 0.05,
    "schema_valid_pct": 0.02,
    "reasoning_preservation_pct": 0.10
  },
  "aggregate": {
    "concept_recall":         { "p50": 0.92, "p25": 0.83, "mean": 0.85 },
    "slug_reuse_precision":   { "p50": 1.00, "p25": 1.00, "mean": 0.98, "applicable_cases": 9 },
    "reasoning_preservation": { "p50": 0.80, "p25": 0.67, "mean": 0.74 },
    "schema_valid_rate": 1.0,
    "forbidden_violations": 0
  },
  "per_case": [
    {
      "slug": "sess-02-fuzzy",
      "tags": ["algorithmic-choice", "synthetic"],
      "concept_recall": 1.0,
      "slug_reuse_precision": null,
      "reasoning_preservation": 0.83,
      "schema_valid": true,
      "forbidden_slug_violations": 0
    }
  ]
}
```

`pnpm eval --snapshot` regenerates. Mode field (`cached` vs `real`) prevents cross-mode false alarms: a cached baseline isn't compared against a real-invoke run.

### 3.3 `LogEvent` — `backfill_batch.mode` field

Minor: the existing `backfill_batch` event (added in Plan 2's final housekeeping) gains a `mode: 'backfill' | 'rerun'` field. `/comprehend status` labels rows accordingly.

### 3.4 No schema migrations

Existing `.comprehension/` data continues working. `manifest.schema_version` stays at `"1.0.0"`.

### 3.5 `docs/user/data-flow.md`

New non-code file. ~20 lines, plain prose describing:
- What the plugin reads (Claude Code JSONL transcripts).
- What it sends to `claude -p` (compressed session content — file contents stripped).
- Where artifacts land (`.comprehension/` in the opted-in project).
- How to opt out / uninstall.

Linked from the install-time consent flow via the "Read the linked data-flow doc first" `AskUserQuestion` option.

---

## 4. Risks, Open Questions & Success Criteria

### 4.1 High-severity risks

**Secrets leaking through the scrubber into committed golden cases.**
*Mitigation:* mandatory two-step author process (scrub + manual read-through). Pre-commit hook warns on common sensitive-pattern matches under `tests/golden/corpus/`. Not bulletproof; manual review is load-bearing.

**§8.2 bars unmet at baseline time — awkward framing.**
*Mitigation:* the parent spec already labels §8.2 as the release-for-publication bar (Plan 4). Plan 3's README + baseline commit message frame the numbers as "starting line for Plan 4's iteration," not quality failure.

### 4.2 Medium-severity risks

**Lock refactor regression.** Folding racy `tryAcquireLock` and strict `tryAcquireQueueLock` into one primitive means both call sites get the stricter semantics. Possibility of subtle behavioral change.
*Mitigation:* existing 102 plugin tests are the regression gate. Plus a new lock-primitive stress test (10 concurrent acquirers) verifies strict exclusivity.

**`/comprehend rerun --all` cost blowup.** On a 50-session project, `rerun --all` is ~25 minutes and ~$2.50–$5.00.
*Mitigation:* `--show-preview` always emits cost. Markdown template's `AskUserQuestion` shows cost in option labels. Raw CLI requires `--force` to skip confirmation.

**Baseline drift on non-determinism.** Refiner isn't deterministic; two `pnpm eval --snapshot --real` runs can diverge enough to trip the tolerance gate.
*Mitigation:* default baseline mode is `cached` (deterministic by construction). `--real` only snapshots with explicit `--snapshot --real`. Plan 4 uses real-mode repeatedly.

### 4.3 Lower-severity risks

- **`tags` taxonomy drift.** `TAGS` constant is the sanctioned set; unknown tags print a warning. Gentle enforcement.
- **Consent flow edge case — declined user re-invokes.** Second `init` re-offers consent. Acceptable.
- **Scrubber false-positives.** Aggressive redaction can make cases artificially hard. `notes.md` records what was scrubbed so authors can tune.

### 4.4 Open questions (resolve during implementation)

1. **Exact regex set for `scrub-transcript.mjs`.** Starter set in §2.4; extend on first false-negative.
2. **Tolerance thresholds for regression.** Starter: 5% recall, 2% schema-valid, 10% reasoning. Revisit after Plan 4's first real iteration.
3. **CI integration for `pnpm eval`.** Plan 3 decision: yes for cached mode, no for real mode. CI fails on regression vs baseline.
4. **External URL for `docs/user/data-flow.md`.** Leave as TODO placeholder until a public repo exists. Consent text primary path: "see `docs/user/data-flow.md` in this plugin's install directory."

### 4.5 Success criteria

Plan 3 is complete when all the following are objectively true:

**Functional:**

- `pnpm build && pnpm test` — 230+ existing tests pass, plus new tests for lock primitive, `/comprehend rerun`, eval metrics.
- Fresh install (no `~/.claude/fos-install-ack`): `/comprehend-fos:comprehend-init` shows consent text, then project-level opt-in. Second project's `init` skips consent and goes straight to opt-in.
- `/comprehend-fos:comprehend-rerun` bare re-derives without refiner calls. `--session <id>` re-analyzes synchronously. `--all` shows cost preview via `AskUserQuestion`, only proceeds on Accept.
- `packages/plugin/install/post-install.js` + `install/package.json` are deleted; smoke test updated.
- `pnpm eval` runs 13+ cases, emits aggregate metrics report, compares against `baseline.json`.
- `pnpm eval --snapshot` updates `baseline.json`.
- `pnpm eval --against <git-ref>` prints per-case deltas.
- `baseline.json` committed and reflects refiner-v1's current performance.

**Corpus:**

- 13+ total cases in `tests/golden/corpus/`. ≥ 4 tagged `mined`; ≥ 6 tagged `synthetic`.
- Each case has `transcript.jsonl`, `expected.json`, `cached-response.json`, optional `notes.md`.
- Every `cached-response.json` validates against refiner zod schema (automated test).
- Every `expected.json` uses sanctioned `TAGS` set.

**Code health:**

- `tryAcquireLock` + `tryAcquireQueueLock` both delegate to `acquireExclusiveLock`.
- No new `process.env.HOME` without `USERPROFILE` fallback.
- No new `fileURLToPath(import.meta.url)` in entry files needing argv-based paths.
- `pnpm --filter @fos/plugin lint && pnpm --filter @fos/core lint` clean.

**NOT a Plan 3 completion criterion:**

- §8.2 bars met (Plan 4's goal).
- Marketplace publication (Plan 4).
- Historical quality tracking.
- Refiner prompt changes.

---

## 5. Transition to Implementation

After user approval, the next step is `superpowers:writing-plans` to produce a sequenced implementation plan with phase checkpoints. No other implementation skill is invoked before the plan exists.

Recommended phase order (matches §2.1–§2.5 ordering — foundation first, then features, then corpus + harness):

1. Lock refactor (§2.1) — foundation.
2. `/comprehend rerun` (§2.2) — builds on lock.
3. Consent-flow redesign (§2.3) — independent of 1–2.
4. Corpus expansion (§2.4) — independent; mostly authoring work.
5. Eval harness + baseline (§2.5) — depends on §2.4 for cases to measure.
