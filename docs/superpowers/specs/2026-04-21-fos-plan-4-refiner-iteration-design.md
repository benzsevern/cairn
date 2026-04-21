# FOS Plan 4 — Refiner Quality Iteration — Design

**Status:** Approved (brainstorming phase) — ready for implementation planning
**Date:** 2026-04-21
**Author:** brainstormed with Claude Opus 4.7 (1M context)
**Next step:** implementation plan via `superpowers:writing-plans`
**Depends on:** Plans 1, 2, 3 merged on main (latest merge `710b201`). Plan 3 Phase 4 (corpus expansion 3 → 13+) is carried over into this plan as Phase 0.
**Defers to Plan 5:** marketplace publication, accumulated dogfood hours, §6 spec's ≥ 50 session-hour threshold.

---

## 0. Context

Plans 1 + 2 shipped the retrospective-comprehension loop end-to-end. Plan 3 shipped cleanup + quality-measurement infrastructure (the eval harness, baseline.json, metrics.ts). Plan 3 deferred Phase 4 (corpus expansion 3 → 13+) and Plan 4 was framed as "iterate the refiner prompt until §8.2 bars pass, then publish."

We split that framing during Plan 4 brainstorming: **this plan is iteration-only**. Publication + dogfood-hour accumulation becomes Plan 5.

The parent spec's §8.2 bars are:
- `concept_recall ≥ 0.90`
- `slug_reuse_precision ≥ 0.95`
- `reasoning_preservation ≥ 0.80`
- `schema_valid_rate ≥ 0.99`

These must pass on Sonnet as the primary tier; Opus and Haiku are verified at the end.

Plan 4 ends when the §8.2 bars pass OR one of four explicit stop conditions fires. Either way, a new `refiner-v1.1.md` ships with honestly-labeled metrics in baseline.json.

---

## 1. Product Shape

Two-phase work landing on `main` after Plans 1–3:

- **Phase 0:** corpus expansion from Plan 3 carried over — 6 mined (scoped to `D:\show_case` + `D:\comprehension-debt`) + 6–8 synthetic = 13+ cases.
- **Phases 1–5:** real-mode measurement → AI-assisted iterations → human polish → tier verification → ship `refiner-v1.1.md`.

**Locked decisions** (from brainstorming):

| Decision | Choice |
|---|---|
| Corpus mining scope | Subagent autonomously picks transcripts from `~/.claude/projects/D--show_case/*` + `~/.claude/projects/D--comprehension-debt/*` only. Scrubber runs as defense-in-depth. |
| Iteration strategy | Hybrid — AI-assisted single-shot diffs early; human-driven polish once gains drop < 2% for 2 consecutive iterations. |
| Tier coverage during iteration | Sonnet only. Opus + Haiku verified in final Phase 4. |
| Stop condition (any triggers completion) | Bars met / 25 iterations reached / $40 API budget consumed / 3-iteration convergence stall. |
| Versioning | Semver minor bump to `prompts/refiner-v1.1.md`. `SHIPPED_REFINER_VERSION = "v1.1.0"`. Sessions pre-upgrade keep `v1.0.0`; `/comprehend-fos:comprehend-rerun --all` refreshes if user wants. |
| Eval cost source | Direct Anthropic API via `ANTHROPIC_API_KEY` + `FOS_EVAL_PROVIDER=api`. User's $40 API wallet funds iteration. Plugin production path (`claude -p`) untouched. |

**Success criterion for Plan 4 completion:**
Plan 4 is done when *any* of the stop conditions fires. Meeting §8.2 bars is the **goal but not the completion criterion** — if iteration stalls 5% below a bar within the budget, Plan 4 still ships with honestly-labeled refiner-v1.1 numbers in baseline.json. Plan 5 / future work can revisit.

**Explicitly NOT in Plan 4:**

- Marketplace publication — Plan 5.
- Automatic re-analysis of users' past sessions (ship new prompt; users opt in via `rerun --all`).
- Schema changes to refiner output (v1.1 is prompt-only; output shape unchanged).
- Iteration tooling beyond the eval harness (no dashboard, no prompt-diff UI, no custom git workflow).
- Publishing eval numbers publicly.
- `eval-history.jsonl` historical tracking — same deferral as Plan 3.
- Terminal injection, fog-of-war, fractal fan-out — Plan vNext+ deferrals persist.

---

## 2. Architecture & Components

### 2.1 Corpus mining (`tools/scrub-transcript.mjs` — deferred from Plan 3)

**Files:**
- Create: `tools/scrub-transcript.mjs` (per Plan 3 Task 9 spec — already designed).
- Create: `scripts/pre-commit.sh` (per Plan 3 Task 10 — already designed).

The scrubber's design is unchanged. Plan 4's new constraint: the mining subagent **only reads from** `~/.claude/projects/D--show_case/` and `~/.claude/projects/D--comprehension-debt/`. Enforced by the mining subagent's prompt, not the tool (which remains scope-agnostic).

**Transcript selection** (subagent):
1. List `~/.claude/projects/`, filter to directories starting with `D--show_case` or `D--comprehension-debt`.
2. For each candidate JSONL, read first line → extract `cwd` → double-check matches allowed roots.
3. For each coverage theme (`terse-user`, `long-session`, `multiple-concepts`, `refactor`, `debugging`, `no-concepts-expected`), pick ONE representative. Scrub it. Author `expected.json` + `cached-response.json`.
4. Show the user each case before committing. User approves or redirects.

### 2.2 Dual-provider eval invoke (`FOS_EVAL_PROVIDER`)

**Files:**
- Modify: `packages/core/tests/golden/eval.test.ts` — `makeEvalInvoke` factory honors env var.
- Create: `packages/core/tests/golden/api-invoke.ts` — thin wrapper around `@anthropic-ai/sdk` with the same signature as `invokeClaude`.
- Modify: `packages/core/package.json` — add `@anthropic-ai/sdk` as a `devDependencies` entry.

Two code paths:

- `FOS_EVAL_PROVIDER=cli` (default) — current behavior. Shells to `claude -p`.
- `FOS_EVAL_PROVIDER=api` + `ANTHROPIC_API_KEY=sk-ant-...` — uses `@anthropic-ai/sdk`:
  ```
  anthropic.messages.create({
    model: process.env.FOS_EVAL_MODEL ?? 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: promptText,
    messages: [{role: 'user', content: userPayload}],
  })
  ```
  Returns assistant message text → same shape as `claude -p` stdout.

**Isolation guarantee:** `@anthropic-ai/sdk` is `devDependencies` only. `api-invoke.ts` is imported only by `eval.test.ts` (and its runner). When `@fos/plugin` builds via tsup, no production code path references it, so it's tree-shaken out of the plugin dist. End users' installed plugins have zero awareness of this code path.

### 2.3 Iteration workflow

No daemon, no automation. Each cycle is manual:

```
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api ANTHROPIC_API_KEY=sk-ant-... pnpm --filter @fos/core eval --snapshot-delta
```

New flag `--snapshot-delta` writes `packages/core/tests/golden/iterations/<timestamp>-<refiner-hash>.json` — a per-run metrics snapshot. `iterations/` is gitignored (not committed).

**Per iteration:**
1. `pnpm eval --snapshot-delta` — ~$1, ~8 min on Sonnet × 13 cases.
2. Dispatch subagent with: current `refiner-v1.md` content, current `iterations/<latest>.json`, per-case raw refiner outputs for failing cases, the target metrics, the delta vs previous. Subagent produces a unified-diff patch to `refiner-v1.md`. **Note:** this subagent IS intentionally given the raw refiner outputs — that's how it diagnoses what went wrong. The corpus-gaming constraint in §4.1 (authoring subagent must NOT run the refiner) applies only to Phase 0 case authoring, not to iteration here.
3. Ratify (accept / tweak / reject).
4. Apply, run eval again.
5. Loop until stop condition.

**Handoff trigger:** three consecutive iterations producing < 2% gain on the primary failing metric → transition to Phase 3 (human polish).

### 2.4 Versioning mechanics (`refiner-v1.1.md`)

**Files (at end of Plan 4 only):**
- Create: `packages/core/prompts/refiner-v1.1.md` — the final iterated prompt.
- Modify: `packages/core/src/refiner/load-prompt.ts` — `SHIPPED_REFINER_VERSION` bumped `"v1.0.0"` → `"v1.1.0"`.
- Keep: `packages/core/prompts/refiner-v1.md` — historical record, not loaded at runtime.

**Propagation:** no new plumbing. Plugin's next build picks up the new constant. Users reinstall → `/comprehend-fos:comprehend-status` shows "N sessions on refiner-v1.0.0; current v1.1.0; run `/comprehend-fos:comprehend-rerun --all` to refresh." This comes from Plan 3's status command already.

### 2.5 Baseline refresh

**Files:**
- Modify: `packages/core/tests/golden/baseline.json` — regenerated with v1.1.0 metrics + per-tier subsection.

Plan 3's regression gate continues to enforce no-regression against this new baseline. The baseline grows a new sub-block:

```json
{
  "aggregate": {
    "concept_recall": { … },
    ...
  },
  "per_tier": {
    "sonnet": { "concept_recall": { "mean": … }, … },
    "opus":   { … },
    "haiku":  { … }
  }
}
```

---

## 3. Iteration Lifecycle

### Phase 0 — Corpus expansion

Subagent-driven; user reviews each case.

1. Build `tools/scrub-transcript.mjs` + `scripts/pre-commit.sh`.
2. For each of 6 coverage themes, subagent picks one transcript from scoped roots, scrubs, authors expected + cached, shows user, commits.
3. Subagent authors 6–8 synthetic edge cases (no privacy risk; fully fabricated).
4. Re-snapshot baseline.json (cached mode) against the 13+ corpus.

**End of Phase 0:** 13+ cases committed; baseline.json cached-mode 1.0 across the board.

### Phase 1 — Honest starting line

```
FOS_EVAL_REAL=1 FOS_EVAL_PROVIDER=api ANTHROPIC_API_KEY=sk-ant-... pnpm eval --snapshot-delta
```

Runs refiner-v1.0.0 against the real API on all cases. Cost ~$1. Numbers surface in terminal + `iterations/` log. Do NOT overwrite baseline.json yet — keep cached-mode as regression guard during iteration.

**Decision gate:** if v1.0.0 passes §8.2 bars already, skip Phases 2–3. Jump to Phase 4.

### Phase 2 — AI-assisted single-shot iterations

Per iteration:
1. Eval with `--snapshot-delta`.
2. Subagent proposes unified diff to `refiner-v1.md`.
3. User ratifies.
4. Eval again.
5. Stop conditions:
   - §8.2 bars met → Phase 4.
   - Primary failing metric < 2% gain for 2 consecutive iterations → Phase 3.
   - 25 iterations reached → Phase 5 with honest numbers.
   - $40 budget consumed → Phase 5 with honest numbers.
   - 3-iteration convergence stall → Phase 5 with honest numbers.

### Phase 3 — Human polish

User hand-edits the prompt. Same eval loop. Same stop conditions (sans subagent-assist). Usually 2–5 polish iterations.

### Phase 4 — Tier verification

1. `FOS_EVAL_MODEL=claude-opus-4-7 pnpm eval` — ~$3. Record numbers.
2. `FOS_EVAL_MODEL=claude-haiku-4-5 pnpm eval` — ~$0.30. Record numbers.
3. If Opus equal or better (expected) → note in commit, no action.
4. If Haiku fails bars: two branches:
   - **4a** — tier-specific polish: add few-shot examples tuned for Haiku's narrower reasoning. ~5 runs × $0.30 ≈ $1.50. If bars hit, great.
   - **4b** — Haiku still fails after polish → document as "graceful degradation tier" in `@fos/plugin` README. Plan 4 still ships.

### Phase 5 — Ship

1. Save final prompt as `packages/core/prompts/refiner-v1.1.md`.
2. `SHIPPED_REFINER_VERSION = "v1.1.0"` in `load-prompt.ts`.
3. `pnpm eval --snapshot` (cached mode) — writes new baseline.json with v1.1.0 numbers.
4. `pnpm eval --real --api --snapshot` — writes second real-mode snapshot (either alongside in the same baseline.json or in a separate `baseline-real.json`; decide during implementation).
5. Create `docs/superpowers/plans/2026-04-21-fos-v4-completion-notes.md` summarizing: final metrics, iteration count, total cost, which stop condition fired.
6. `pnpm build && pnpm test` — 245 existing tests still pass (refiner prompt is a data file; unit tests use mocks).
7. Manual dogfood: reinstall plugin, confirm new session frontmatter shows `refiner_version: v1.1.0`.
8. Merge `feat/plan-4-refiner-iteration` → `main` via `--no-ff`.

---

## 4. Risks, Stop Conditions, Success Criteria

### 4.1 High-severity risks

**Bars unreachable within budget.** Current refiner might have fundamental gaps 25 iterations can't close.
*Mitigation:* Phase 1's starting-line measurement tells us early. If starting numbers are ~60% recall, expected trajectory at 2%/iter × 25 iters → ~90%, borderline. We can surface early and either expand budget or accept the final numbers.

**Corpus gaming.** Authors could tune `expected.json` to match the refiner's existing habits, making Plan 4 look artificially successful.
*Mitigation:* synthetic cases authored FIRST (from spec definitions), measured AGAINST the refiner, tweaked only if measurement reveals an unfair case (not tweaked to suit the refiner). Subagent instructed explicitly to NOT run the refiner during authoring.

**Mined transcripts leak org content despite scope + scrubber.** Even within `D:\show_case` and `D:\comprehension-debt`, transcripts might contain generated content referencing real-looking names/URLs.
*Mitigation:* user reviews each case pre-commit per Phase 0 step 2.

### 4.2 Medium-severity risks

**SDK drift vs `claude -p` behavior.** Iterating against the API then shipping a prompt deployed via `claude -p` means environments aren't identical. Server-side prompt wrapping by Anthropic's hosted CLI might diverge from the raw SDK.
*Mitigation:* Phase 5 step 4 includes a one-shot `pnpm eval --real` using `claude -p` (not `--api`) as a sanity check. Costs Max quota once. If numbers diverge materially, document in commit as known risk.

**Haiku fundamentally can't hit bars.** Plausible — smaller model, narrower reasoning envelope.
*Mitigation:* Phase 4b's graceful-degradation fallback. baseline.json records divergence. Plugin README documents tier recommendations.

**Subagent diffs drift the prompt in a direction the user dislikes.** AI-assisted iteration can over-optimize local metric at the cost of clarity/brevity/style.
*Mitigation:* Phase 3 (human polish) is the escape valve. Shift to Phase 3 earlier than the 2-iteration stall trigger if early diffs look off.

### 4.3 Lower-severity risks

- **`iterations/` directory growth** — gitignored.
- **$40 wallet underfunded** — top up if needed.
- **Pre-commit guard false-positives** — `git commit --no-verify` documented in `tests/golden/README.md`.
- **`FOS_EVAL_MODEL` env var collision** — `FOS_` prefix mitigates.

### 4.4 Open questions (resolve during implementation)

1. **Whether to commit `iterations/` log.** Current plan: gitignore. Alternative: commit for transparent record of iteration. Decide in Phase 2.
2. **Whether Phase 5 creates `baseline-real.json` alongside `baseline.json`.** Cleaner separation for cached vs real. Decide in Phase 5.
3. **Where to document the known Haiku gap (if 4b triggers).** Probably `@fos/plugin/README.md` or `docs/model-tier-notes.md`.
4. **Subagent prompt template for Phase 2 diffs.** Author in first iteration; refine as we learn.

### 4.5 Success criteria

Plan 4 is complete when:

**Functional:**

- 13+ cases in `packages/core/tests/golden/corpus/`. Each with `transcript.jsonl`, `expected.json`, `cached-response.json`.
- `tools/scrub-transcript.mjs` + `scripts/pre-commit.sh` exist.
- `packages/core/prompts/refiner-v1.1.md` exists.
- `SHIPPED_REFINER_VERSION === "v1.1.0"`.
- `packages/core/tests/golden/baseline.json` regenerated with v1.1.0 numbers + per-tier data.
- `pnpm --filter @fos/core eval --real --api --snapshot-delta` runs end-to-end.
- Plugin rebuilt + reinstalled; new sessions' frontmatter shows `refiner_version: v1.1.0`.

**Quality outcome (any counts as Plan 4 done):**

- §8.2 bars met on Sonnet (ideal).
- Stop condition fired (iteration cap / budget / convergence stall). Commit messages state which + final numbers. baseline.json records honest result.

**Opus/Haiku:**

- Opus numbers recorded. No enforcement.
- Haiku numbers recorded. If bars missed, Phase 4b polish attempted. Final state documented in plugin README.

**Code health:**

- `@anthropic-ai/sdk` is `devDependencies` only. Plugin bundle size unchanged.
- All 245 existing tests pass.
- `pnpm --filter @fos/core lint && pnpm --filter @fos/plugin lint` clean.

**NOT a Plan 4 completion criterion:**

- Marketplace publication (Plan 5).
- ≥ 50 session-hours dogfood accumulation.
- Historical quality tracking log.

---

## 5. Transition to Implementation

After user approval, next step is `superpowers:writing-plans`. No other skill invoked first.
