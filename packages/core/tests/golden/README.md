# Golden corpus (Plan 1 stub)

This directory contains a hand-curated mini-corpus used by the basic refiner
eval (`pnpm --filter @fos/core eval`). Plan 1 ships only 3 cases — just enough
to catch gross regressions. Plan 3 will grow this to 15+ transcripts with the
full §8.2 quality bars (recall, precision, slug-reuse rate, reasoning fidelity).

## Layout

```
tests/golden/
  README.md              <- this file
  eval.test.ts           <- the eval runner
  corpus/
    sess-01-greeting/
      transcript.jsonl      <- synthetic Claude Code transcript
      expected.json         <- hand-authored expectations
      cached-response.json  <- hand-authored refiner output (CI determinism)
    sess-02-fuzzy/
    sess-03-refine/
```

## Case shape: `expected.json`

```json
{
  "required_slugs":            ["fuzzy-matching"],
  "slug_reuse_context":        ["entity-resolution"],
  "required_reasoning_substrings": {
    "fuzzy-matching": ["levenshtein", "unicode"]
  },
  "forbidden_slugs":           ["trigram-matching"]
}
```

- `required_slugs` — concepts the refiner MUST surface.
- `slug_reuse_context` — existing-concept summaries that would be injected
  into the refiner prompt in a real run; listed here so the grader knows
  which reuse opportunities the transcript references.
- `required_reasoning_substrings` — per-concept, case-insensitive substrings
  that MUST appear in the concept's reasoning bullets.
- `forbidden_slugs` — slugs a naive refiner might hallucinate but are
  explicitly wrong for this transcript.

## CI mode vs real-invoke mode

- **Default (CI, local dev):** the eval reads `cached-response.json` from
  each case dir and asserts the rendered session markdown satisfies
  `expected.json`. Deterministic, zero-cost, no `claude` binary required.

- **Real invoke:** `FOS_EVAL_REAL=1 pnpm --filter @fos/core eval` shells out
  to the real `claude -p` refiner. Run this locally before shipping prompt
  changes. When the real refiner drifts from the cached output, either
  re-cache (if the new output is better), tighten/weaken the expected
  substrings, or adjust the prompt.

## Authoring a new case

1. Pick a transcript. For Plan 1 these were hand-written synthetic Claude
   Code JSONL excerpts (3–10 events) that model a specific refiner
   behavior (greeting vs algorithmic choice vs concept refinement).
   In Plan 3 these come from real `~/.claude/projects/` traces with PII
   and secrets scrubbed.
2. Write `expected.json` — be strict about `required_slugs` and reasoning
   substrings, generous about `forbidden_slugs` (only include things a
   reasonable refiner might actually produce).
3. Hand-author `cached-response.json` so it satisfies `expected.json`.
   Validate it by running `pnpm --filter @fos/core eval` — the case
   should pass.
4. Once prompt work stabilizes, run
   `FOS_EVAL_REAL=1 pnpm --filter @fos/core eval` and replace the cached
   response with the real refiner output if it also satisfies `expected.json`.

## Scrubbing real transcripts (Plan 3)

When promoting real transcripts into the corpus:
- Replace API keys, tokens, email addresses, customer names.
- Drop any `tool_result` blocks containing file contents from private repos.
- Keep the event indices contiguous from 0 so `transcript_refs` in the
  expected output remain meaningful.
