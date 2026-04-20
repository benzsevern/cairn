# FOS — Retrospective Comprehension Layer (v1) — Design

**Status:** Approved (brainstorming phase) — ready for implementation planning
**Date:** 2026-04-20
**Author:** brainstormed with Claude Opus 4.7 (1M context)
**Next step:** implementation plan via `superpowers:writing-plans`

---

## 0. Context

This spec is the v1 scope of a larger vision originally described as the **Fractal Orchestration Sidecar (FOS)** — a "Copilot for the Copilot" that would build an interactive tech-tree of a project's architecture and drive Claude Code via terminal injection.

The original pitch contained four pillars: a headless data layer, a passive-watcher MCP daemon, a live sidecar UI with fog-of-war, and a terminal injector for click-to-deploy prompts. The full vision is a multi-quarter effort.

This spec scopes v1 to the **retrospective** pillar only: build a high-quality comprehension graph from Claude Code session transcripts. The prospective pillars (live UI, injection, fractal fan-out) are deferred to later versions and are easier to build *because* v1 produces the graph they would drive.

The core bet: **if the retrospective refiner is good enough, the resulting graph is valuable on its own merits.**

---

## 1. Product Shape

A Claude Code plugin (plus a standalone CLI engine) that passively builds and maintains a per-project **comprehension graph**: a structured set of markdown files documenting what each Claude Code session built, *why* it made the decisions it made, and how those decisions relate to each other across sessions. Output includes a self-contained static HTML DAG for visual navigation.

**Target user:** developers using Claude Code heavily for multi-step or multi-session work, who experience the core symptom of "vibe coding" — agents write code faster than humans can internalize the *why*, chat logs evaporate, architectural intuition decays.

**How it runs:**

1. User installs the plugin (primary) or the CLI (fallback).
2. A registered `Stop` hook fires at the end of every Claude Code session.
3. The hook shells out to the engine, which reads the session's JSONL transcript, walks the prompt boundaries, and invokes `claude -p` with a versioned *refiner prompt* to produce structured concept nodes.
4. The engine writes a per-session markdown file (the event) and regenerates the derived project view (markdown concept files + `graph.html`).
5. Over many sessions, the user's `.comprehension/` directory becomes a committable, grep-able, diff-able record of their project's accumulated architectural knowledge.

**Locked decisions** (from the brainstorming session):

| Decision | Choice |
|---|---|
| Product orientation | Shippable product for other developers |
| Value direction | Retrospective-first; no live injection or fog-of-war in v1 |
| Data source | Post-hoc JSONL reader + `Stop` hook convenience trigger |
| Node strategy | Prompt boundaries as skeleton + *mandatory* LLM refiner |
| Persistence model | Per-session artifacts + derived project view (event-sourcing) |
| Output surface | Markdown files + self-contained static HTML DAG |
| LLM invocation | Shell out to the user's existing `claude -p` |
| Packaging | `@fos/plugin` (primary) + `@fos/core` (npm CLI fallback) |

---

## 2. Architecture & Components

Two repo-level artifacts (published independently), plus the per-project data directory they produce.

### 2.1 `@fos/core` — the engine (npm package, Node 20+)

Pure function. No background processes, no network server, no state outside `.comprehension/`.

Public API (three entry points):

- **`analyzeSession(transcriptPath, opts) → Promise<SessionArtifact>`**
  Reads a single JSONL transcript, segments by prompt boundary, invokes the refiner, writes `.comprehension/sessions/<session-id>.md`, returns the parsed artifact.

- **`rebuildProjectView(comprehensionDir) → Promise<void>`**
  Reads all session artifacts, joins by canonical concept slug, regenerates `.comprehension/concepts/*.md` and `.comprehension/graph.html`. Pure derivation — deleting the outputs and re-running this is safe.

- **`backfill(projectHash, opts) → Promise<BackfillReport>`**
  On first install, walks `~/.claude/projects/<hash>/*.jsonl` and analyzes any sessions the user opts into. Rate-limited, cost-bounded, interruptible.

**Transactional coupling.** `analyzeSession` and `rebuildProjectView` are separate entry points, but the plugin's Stop hook invokes them sequentially as one logical unit. If `analyzeSession` succeeds but `rebuildProjectView` fails (disk full, crash, etc.), the session artifact is not orphaned — it's a valid file on disk, and the next successful rebuild (manual or automatic) will incorporate it. The invariant: *a session file is never written unless it's valid*, and *the project view is always derivable from the set of session files that currently exist*. Partial states are always recoverable by re-running `rebuildProjectView`.

Internal layers, each replaceable:

1. **Transcript reader** — parses Claude Code JSONL into a typed event stream. Version-pinned to a known JSONL schema; guards against unknown event types.
2. **Segmenter** — produces prompt-bounded groups of events (one per user turn, plus tool-calls/results until the next user turn). Fully deterministic. Works without an LLM.
3. **Refiner** — shells out to `claude -p`, passes the segments + existing concept names as context, receives a structured JSON response. I/O contract is versioned (see §4).
4. **Writer** — serializes session artifacts and derived concept files + graph HTML. Idempotent. Overwrite-safe.

### 2.2 `@fos/plugin` — the Claude Code plugin

Thin wrapper over `@fos/core`. Registers:

- **`Stop` hook** — on session end, invokes `@fos/core.analyzeSession` for the just-completed transcript, then `rebuildProjectView`. Runs async so Claude Code exits cleanly.
- **`/comprehend` slash command** — on-demand re-analysis of the current session or past sessions, with cost preview.
- **`/comprehend status`** — pending analyses, last refiner version, project view timestamp.
- **`/comprehend backfill`** — interactive backfill wizard for existing projects.
- **`SessionStart` hook (optional)** — one-line summary of the project's current comprehension state on session open.

### 2.3 `.comprehension/` — the per-project data directory

```
.comprehension/
├── manifest.json              # schema version, refiner version, project metadata
├── sessions/
│   ├── 2026-04-20-<uuid>.md   # one per analyzed session (event; committed)
│   └── ...
├── concepts/
│   ├── fuzzy-matching.md      # derived; regenerated from sessions
│   └── ...
├── graph.json                 # derived; structured DAG for programmatic consumers
├── graph.html                 # derived; self-contained visual DAG
└── .fos/
    ├── refiner-prompt.md      # versioned; users can override per-project
    └── cache/                 # token-deduplication cache (gitignored)
```

`.comprehension/` is committed to git. Sessions *are* the architectural history — PR reviewers see new concepts appear; `git blame` on a concept file tells you which session introduced it; old branches have old comprehension graphs. Committing turns tool output into part of the repo's story.

### 2.4 Data flow (happy path)

```
Claude Code session ends
    ↓  [Stop hook fires]
@fos/plugin invokes @fos/core.analyzeSession(<transcript-path>)
    ↓  [reader] parse JSONL → typed events
    ↓  [segmenter] group by prompt boundary → Segment[]
    ↓  [refiner] read existing concepts/*.md for canonical names
    ↓            shell out: claude -p "<refiner prompt>" < <segments + context>
    ↓            parse structured JSON response → ConceptNode[]
    ↓  [writer] sessions/<id>.md
@fos/plugin invokes @fos/core.rebuildProjectView(.comprehension/)
    ↓  [deriver] union ConceptNode[] across all sessions by slug
    ↓           write concepts/*.md
    ↓           write graph.json, graph.html
Done. User sees completion notification. .comprehension/ is updated.
```

---

## 3. Data Model

Three schemas matter: the **session artifact** (primary — written by the refiner), the **concept file** (derived — rebuilt on every change), and **`graph.json`** (derived — drives the HTML view).

### 3.1 Session artifact — `.comprehension/sessions/<id>.md`

One file per analyzed Claude Code session. Source of truth for everything downstream.

```markdown
---
session_id: <claude-code-session-uuid>
transcript_path: ~/.claude/projects/<hash>/<id>.jsonl
analyzed_at: 2026-04-20T15:42:11Z
refiner_version: v0.3.1
refiner_prompt_hash: sha256:a1b2...
model: claude-opus-4-7
segment_count: 11
concept_count: 4
unknown_count: 1
---

## Concept: Fuzzy Matching  {#fuzzy-matching}

**Kind:** introduced
**Depends on:** [entity-resolution]
**Files:** src/matching/fuzzy.ts, src/matching/types.ts

**Summary**
Implements Levenshtein-based approximate string matching for entity pairs scoring below the exact-match threshold.

**Reasoning (why these decisions)**
- Chose Levenshtein over Jaro-Winkler because the input domain is full company names, not short identifiers; Levenshtein's length-sensitivity matches observed false-positive patterns.
- Threshold set at 0.82 because empirical sampling on the test fixture showed 0.80 admitted too many acronym collisions.
- Rejected using the `fast-levenshtein` package because it lacks Unicode normalization; the input contains accented characters.

**Transcript refs:** [tool-use:12, tool-use:14, tool-use:17]

## Concept: Entity Resolution  {#entity-resolution}
...

## Unknowns

- **reasoning-unknown: why boundary case at threshold 0.82?**
  Transcript shows threshold selection but no explicit reasoning for 0.82 vs. 0.80 or 0.85.
  Recovery prompt: "What led you to 0.82 specifically in the fuzzy matcher?"
```

**Key properties:**

- The **refiner only writes `sessions/`**. Never writes `concepts/` or `graph.json` directly — those are pure derivations.
- **`{#slug}` anchors are canonical.** The deriver joins across sessions by these slugs. Refiner must reuse existing slugs when referring to known concepts; this is enforced via prompt context (existing slugs passed in) and validated on write.
- **Transcript refs are citations.** They point back into the original JSONL so a user can always "show me the turn where this decision happened." Critical for debt paydown — the whole point is preserving the *why*.
- **Unknowns are first-class.** When the refiner can't confidently recover reasoning, it says so and emits a recovery prompt. These become "shrouded" nodes in future versions and are the hook for iterative debt paydown.

### 3.2 Concept file — `.comprehension/concepts/<slug>.md`

Derived. Regenerated from scratch on every `rebuildProjectView`. Append-only reconciliation: multiple sessions' reasoning is merged chronologically, never overwritten.

```markdown
---
slug: fuzzy-matching
name: Fuzzy Matching
introduced_in: 2026-04-20-<id>
last_updated_in: 2026-04-23-<id>
depends_on: [entity-resolution]
depended_on_by: [scoring-pipeline]
files: [src/matching/fuzzy.ts, src/matching/types.ts, src/matching/index.ts]
confidence: high
---

# Fuzzy Matching

<most-recent session's summary — elevated to top>

## Reasoning
<unioned reasoning bullets across all sessions, deduplicated by prefix match>

## History
- **2026-04-20** (introduced): <summary from that session>
- **2026-04-23** (refined): added threshold tuning; see session for reasoning.

## Related
- [Entity Resolution](./entity-resolution.md)
- [Scoring Pipeline](./scoring-pipeline.md)

## Open questions
<unknowns from any session referencing this concept>
```

**Key design choice:** the deriver **never runs an LLM**. Pure join/merge. All LLM work happens at session-analysis time. Keeps rebuild cheap (milliseconds), deterministic, and re-runnable.

### 3.3 `graph.json`

```json
{
  "schema_version": "1.0.0",
  "generated_at": "2026-04-23T11:02:00Z",
  "project_view_version": 17,
  "nodes": [
    {
      "slug": "fuzzy-matching",
      "name": "Fuzzy Matching",
      "confidence": "high",
      "introduced_in": "2026-04-20-<id>",
      "file_count": 3,
      "session_touch_count": 2,
      "has_unknowns": false
    }
  ],
  "edges": [
    {"from": "fuzzy-matching", "to": "entity-resolution", "kind": "depends_on"}
  ]
}
```

Drives `graph.html`. Stable public format for programmatic consumers (future IDE plugins, CI checks, dashboards).

### 3.4 `manifest.json`

```json
{
  "schema_version": "1.0.0",
  "refiner_version": "v0.3.1",
  "refiner_prompt_hash": "sha256:a1b2...",
  "last_rebuild": "2026-04-23T11:02:00Z",
  "project_view_version": 17,
  "opt_in": {
    "analyze_all_future_sessions": true,
    "backfill_completed": true,
    "backfilled_session_count": 12,
    "skipped_sessions": []
  }
}
```

### 3.5 Conflict resolution

- **Slugs** — refiner is prompted to reuse existing; duplicates-with-different-slugs are kept as separate concepts (false-split > silent overwrite).
- **Names** — latest session wins for display; earlier names surface in the History section.
- **Dependencies** — union of all edges ever asserted. Removed dependencies are soft-deprecated: the edge remains in `graph.json` with a `status: "deprecated"` field and a `last_asserted_in` session reference; `graph.html` renders it struck-through and dimmed; `concepts/*.md` lists it under a "Previously depended on" sub-section rather than "Depends on". Never physically removed — removal is a recoverable fact about the project's history.
- **Files** — union.
- **Reasoning** — append-only; deduplicated via exact-match on first sentence.

Guiding principle: **the deriver is not authoritative about truth, only about aggregation.** Contradictions are surfaced, not resolved. Resolution is an LLM question — it happens at the next session's analysis time.

---

## 4. Refiner Prompt Contract

The refiner **is the product**. Everything else is plumbing. Its I/O contract, failure modes, and iteration workflow deserve first-class design attention.

### 4.1 Input

The refiner never sees raw JSONL. The segmenter pre-digests into a compact prompt payload:

```
<mission>
  <user-goal>...first few lines from the session's first user message, if any...</user-goal>
  <existing-concepts>
    - fuzzy-matching: "Fuzzy Matching" (files: src/matching/fuzzy.ts) — "Levenshtein approximate..."
    - entity-resolution: "Entity Resolution" — "Top-level pipeline for deduplicating..."
  </existing-concepts>
</mission>

<segment index="1">
  <user>Original user message verbatim.</user>
  <assistant-actions>
    - tool-use[Edit]: src/matching/fuzzy.ts (3 edits, ~40 lines changed)
    - tool-use[Bash]: "npm test -- fuzzy" → exit 0
  </assistant-actions>
  <assistant-narrative>
    Compressed summary of assistant prose interleaved with tool calls.
    Preserves reasoning markers: "Because...", "Chose X over Y because...",
    "Rejected Z because..."
  </assistant-narrative>
</segment>
```

Deliberate choices:

1. **Raw file contents are stripped.** Tool results containing file reads are replaced with `<file: path, N lines>` unless the assistant's prose explicitly cites specific lines. Huge token saver; focuses the refiner on decisions.
2. **Existing concepts are injected.** The refiner is told: *"Prefer reusing the slugs above when you see the same concept; only introduce a new slug if genuinely new."* This is how canonical slugs stabilize across sessions.
3. **Narrative markers preserved verbatim.** "Chose X because Y" phrases are the micro-decision matrix. Segmenter keeps them; other prose can be compressed.

### 4.2 Output

Refiner responds with a single JSON document. No preamble, no fences, no explanation.

```json
{
  "concepts": [
    {
      "slug": "fuzzy-matching",
      "name": "Fuzzy Matching",
      "kind": "introduced",
      "summary": "...one or two sentences...",
      "reasoning": [
        "Chose Levenshtein over Jaro-Winkler because...",
        "Threshold 0.82 because empirical sampling..."
      ],
      "depends_on": ["entity-resolution"],
      "files": ["src/matching/fuzzy.ts", "src/matching/types.ts"],
      "transcript_refs": [12, 14, 17],
      "confidence": "high"
    }
  ],
  "unknowns": [
    {
      "slug_ref": "fuzzy-matching",
      "question": "Why threshold 0.82 specifically, versus 0.80 or 0.85?",
      "recovery_prompt": "In the fuzzy matcher, what led you to 0.82 specifically..."
    }
  ]
}
```

**Writer transformation note:** the refiner emits `transcript_refs` as bare integers (`[12, 14, 17]`), and the writer renders them in the session markdown as `[tool-use:12, tool-use:14, tool-use:17]`. The integers are indices into the original JSONL event array; the `tool-use:` prefix is a display convention that survives round-tripping because the parser strips known prefixes. If future event kinds need citation (e.g., `user:N`, `assistant:N`), the refiner's integer output remains stable — only the writer's rendering changes.

### 4.3 Validation and retry

The writer validates JSON against a schema before writing. Three classes of failure:

- **Malformed JSON** — retry once with an error-feedback message including the parse error and the target schema. Second failure: abort session analysis, log, leave a `.comprehension/sessions/<id>.failed.json` stub, do not touch the project view.
- **Schema-valid but semantically broken** (e.g., `depends_on` references an unknown slug) — same retry-once pattern with a structured critique.
- **Timeout / subprocess failure** — exponential backoff, cap at 3 attempts, same failure-stub behavior.

**The project view is never written from a partial analysis.** A visible missing session is better than a corrupt concept file.

### 4.4 Prompt versioning

Refiner prompt ships inside `@fos/core` at `prompts/refiner-v<N>.md`. Each version:

- Markdown file containing system prompt + JSON schema + few-shot examples
- Referenced in `manifest.json` by version tag AND content hash
- Semver'd with a changelog

Session files record which version produced them. Bumping the refiner does not silently rewrite old sessions — they stay on their analysis-time version unless explicitly re-analyzed.

Per-project override at `.comprehension/.fos/refiner-prompt.md`. Override is recorded in the manifest with its own hash. Power-user escape hatch.

**Quality contract for overrides.** When a user supplies their own refiner prompt, the §8.2 quality bars no longer apply to their output — those bars measure the shipped prompt against the shipped golden corpus. `manifest.json` records an `override_active: true` flag when a custom prompt is in use, and sessions analyzed under it record the override's hash in `refiner_prompt_hash`. The graph viewer surfaces this as a small "custom refiner" badge next to affected nodes so reviewers can tell at a glance which parts of the project view came from shipped prompts versus user modifications.

### 4.5 Model tier robustness

The refiner must produce valid JSON from Opus, Sonnet, and Haiku tiers alike:

- Narrow output schema; every optional field is a chance for hallucination or omission.
- Few-shot examples inside the prompt (stabilizes smaller models substantially).
- Enums over open strings where possible (`"kind": "introduced|refined|referenced"`).
- Regression tests across all tiers.

### 4.6 Iteration infrastructure

Non-optional from day one:

- **Golden corpus** — 15+ real Claude Code transcripts with human-reviewed expected outputs. Lives under `tests/golden/`.
- **Regression harness** — `npm run eval` runs the current refiner against the corpus; reports concept recall/precision, reasoning-bullet overlap, schema validity rate.
- **A/B diffing** — `npm run eval -- --against v0.3` runs current and prior prompts side-by-side.
- **Prompt-response caching during development** — so iteration doesn't re-bill N invocations per change.

Treating the prompt as a normal file without this infrastructure is how v0.4 ships worse than v0.3 without anyone noticing.

### 4.7 Non-duties

The refiner must NOT:

- Run any tools. It's `claude -p` without tool permissions. Pure text-in, text-out.
- Decide which files to read. Works only from the segments it's given.
- Invent dependencies or concepts not grounded in the segments.
- Rewrite concept files directly — it writes a session artifact; the deriver does the join.
- Issue side effects of any kind.

---

## 5. Packaging & Install

### 5.1 Repo layout

Single repo, two published packages (pnpm/turbo workspace):

```
fos/
├── packages/
│   ├── core/                  # @fos/core — engine (published to npm)
│   │   ├── src/
│   │   ├── prompts/refiner-v1.md
│   │   └── tests/golden/
│   └── plugin/                # @fos/plugin — Claude Code plugin
│       ├── plugin.json
│       ├── commands/          # /comprehend, /comprehend status, /comprehend backfill
│       ├── hooks/             # Stop, SessionStart
│       └── src/               # thin wrappers over @fos/core
├── apps/
│   └── viewer/                # graph.html template source (builds to core/dist/viewer)
├── docs/
└── pnpm-workspace.yaml
```

The viewer is a separate app because its iteration loop (rendering graph.json fixtures in a browser) is independent from the engine's. It builds to a single inlined HTML template that core emits at runtime — zero dependencies in `graph.html`.

### 5.2 Install — primary path

```
claude plugins install @fos/plugin
```

Plugin's post-install step:

1. Verifies `claude` is callable from PATH (the plugin depends on the user's own Claude Code auth).
2. Registers the `Stop` hook at **user level** (fires on every Claude Code session across all projects), with a consent prompt explaining data flow.
3. Prints next-steps guidance.

**Why user-level, not per-project:** the hook is a trivial guard — on fire, it checks whether the session's working directory contains a `.comprehension/` directory. If not, the hook exits silently (zero cost, invisible to the user). If yes, it invokes the engine. This means users opt *projects* in via `/comprehend init` (which scaffolds `.comprehension/`), not sessions; and there is no per-project hook installation step, which would be tedious and error-prone. The hook is installed once, system-wide; enablement is directory-scoped.

No global state. No daemon. Plugin is dormant until a hook fires on a project that has opted in.

### 5.3 Install — CLI fallback

```
npm i -g @fos/core
fos init         # in a project directory
fos analyze <transcript-path>
fos rebuild
fos backfill
```

For: CI jobs, re-analyzing old transcripts with a new refiner version, scripted automation, users who don't want the plugin to hook every session automatically.

### 5.4 Backfill

On an existing repo, `/comprehend backfill` walks `~/.claude/projects/<project-hash>/*.jsonl`, estimates token cost based on segment sizes and current model tier, and confirms:

```
Found 47 prior sessions for this project (est. ~312k tokens at claude-opus-4-7).
Estimated cost: $4.68.
Analyze all / analyze recent N / skip backfill / customize?
```

Backfill runs serially with progress output, is interruptible (Ctrl-C leaves `.comprehension/` consistent — only fully-written session files contribute to the project view).

### 5.5 Upgrade path

- Plugin auto-upgrades `@fos/core` via standard dependency management.
- Existing session files are **not** auto-re-analyzed. They keep their recorded `refiner_version`.
- Re-analysis is user-initiated: `/comprehend rerun --session <id>` or `/comprehend rerun --all`, always with a cost preview.

Session files are the event log; events are immutable unless the user asks to rewrite them.

---

## 6. Explicit Non-Goals (v1)

Deferred features from the original vision, with the reason each is out of v1:

- **Terminal injection / click-to-deploy prompts.** Fragile across multiplexers, platforms, and Claude Code versions; no value until the retrospective graph is already high quality. v2.
- **Live web UI with fog-of-war.** Static HTML DAG covers the visual hook. A live server adds port management, SSR/hydration, hot-reload-during-writes complexity. v2.
- **Fractal fan-out.** Prospective behavior; requires the prospective pillar we explicitly deferred. v2+.
- **Semantic embeddings, HDBSCAN, vector storage.** The LLM refiner does the clustering. Might add value later for cross-project search or very large projects. Speculative v3.
- **Multi-provider LLM support.** Relying on the user's existing `claude` is the point.
- **IDE extensions (VS Code, JetBrains).** Static HTML + markdown already works in every editor. Separate product track. v3.
- **Multi-project cross-referencing.** Each `.comprehension/` is self-contained. v3.
- **Team collaboration beyond git commits.** The `.comprehension/` directory IS the collaboration surface. No SaaS backend. v3.
- **Fine-grained edit-level provenance.** Concept-level is the correct granularity; line-level is what `git blame` is for.
- **Re-analyzing a session mid-flight.** Analysis only happens after `Stop`. v2.
- **Privacy-preserving modes** (local model, redaction, on-prem). v1 inherits the user's Claude Code data policies. Enterprise redaction is a separate track.

Two meta non-goals:

- **No stability promises on `graph.json` or session file schemas before v1.0.** Pre-1.0 we break when the data model evolves. Post-1.0 we ship migrations.
- **No marketplace publication before 50 internal session-hours of dogfooding.** Refiner quality earns its public listing.

---

## 7. Risks & Open Questions

### 7.1 High-severity

**Refiner quality is the product.** Mediocre refiner → mediocre graph → immediate churn. *Mitigation:* the golden-corpus eval harness is non-optional from day one. Concrete quality bar (§8.2) gates v1 release.

**Claude Code JSONL schema is an internal interface.** Silent schema changes could break the reader. *Mitigation:* pin to a tested Claude Code version range; schema-validation layer fails loudly on unknown event types; budget reactive engineering time.

**Privacy / data egress perception.** Transcripts have already been sent to Anthropic during the session, so marginal egress is zero — but users may not internalize this. *Mitigation:* install consent prompt states explicitly that analysis runs through the existing `claude` CLI and is subject to the same data policies.

### 7.2 Medium-severity

**Cost surprise on backfill.** 200 prior sessions on Opus could be a real bill. *Mitigation:* hard-coded cost preview before backfill; per-session post-analysis cost visibility; `FOS_MAX_COST_PER_SESSION_USD` config guard.

**`.comprehension/` noise in git history / PRs.** Every session produces new files; PRs will show comprehension diffs alongside code changes. *Mitigation (flag, don't resolve here):* docs section + a `fos commit` helper that groups comprehension updates into their own commits.

**Slug canonicalization is the refiner's hardest job.** Same concept under different phrasings must produce the same slug while still admitting genuinely-new concepts. *Mitigation:* aggressive normalization rules (kebab-case, no articles, singular); existing-concepts context always injected; nightly eval measuring slug stability under paraphrase.

**Large-session context limits.** A 6-hour session may exceed context windows after compression. *Mitigation:* segmenter size cap; split and merge if exceeded. v1 may ship without if golden corpus never hits the cap; clear failure message otherwise.

### 7.3 Lower-severity

- **`claude` not on PATH in hook subprocesses.** *Mitigation:* record absolute path at install time.
- **Parallel sessions on one repo** (git worktrees, background agents). *Mitigation:* file lock on rebuild; races cost at most "run rebuild again."
- **Static DAG doesn't scale past ~100 concepts.** *Mitigation:* force-directed layout fine to ~150; beyond that, v2 live UI is the right path; v1 emits a warning.

### 7.4 Open questions (resolve during implementation)

1. **Does the refiner need source-file grounding?** Flag for evaluation: run golden corpus with and without a "relevant file contents" supplement; measure quality delta vs. token cost delta.
2. **Pre-1.0 migration policy for session files.** Lean: leave in place, deriver handles both old/new, document each break.
3. **Clickable transcript-ref links in `graph.html`.** Nice feature; defer until post-v1 unless trivial.
4. **Multi-project `.comprehension/` scope.** Lean: git repo root if present, else Claude Code project hash.
5. **`transcript_refs` stability.** Consider content-hashing the referenced tool-use event rather than line-indexing.

---

## 8. Success Criteria

### 8.1 Functional

- Fresh install registers the `Stop` hook, runs a session through it, and produces valid `sessions/<id>.md` + rebuilt `concepts/*.md` + `graph.html` with zero manual intervention.
- `fos backfill` completes on a repo with ≥50 prior sessions; cost estimate within ±10% of actual spend.
- `fos rebuild` with no new sessions is a no-op at content level (deterministic fields bit-identical).
- Deleting any `sessions/*.md` and re-running `fos rebuild` yields a correct project view reflecting the remaining sessions.
- `graph.html` opens in Chrome, Firefox, Safari with no console errors; usable DAG layout up to 100 nodes.

### 8.2 Refiner quality (hard release bar)

Measured against a `tests/golden/` corpus of 15+ human-reviewed transcripts:

- **Concept recall ≥ 90%** — every human-identified concept produces a matching slug (exact or semantic-equivalent).
- **Slug-reuse precision ≥ 95%** — when a test session references an already-established concept, the refiner reuses the existing slug ≥95% of the time.
- **Reasoning preservation ≥ 80%** — top-3 "Chose X because Y / Rejected Z because W" statements per transcript captured ≥80% of the time (substring or semantic match).
- **Schema-valid output ≥ 99%** — first-attempt parse+validate rate across the corpus.
- **Works across tiers** — bars hold on Haiku 4.5, not just Opus. If Haiku can't clear them, ship with a documented tier recommendation in the consent prompt.

### 8.3 Install / onboarding

- Time from `claude plugins install @fos/plugin` to first valid analysis artifact ≤ 3 minutes end-to-end.
- Zero environment variables or API keys beyond what Claude Code itself already needs.
- Three dogfood users with no project context install and reach a generated artifact without assistance.

### 8.4 Performance / cost

- Session analysis latency: p50 ≤ 15s, p95 ≤ 60s for a typical 30-minute session on Sonnet.
- Refiner token cost per typical 30-minute session ≤ \$0.08 on Sonnet, ≤ \$0.40 on Opus.
- `rebuildProjectView` < 2s for a project with 100 sessions / 50 concepts.
- Backfill of 50 sessions < 30 minutes wall-clock at default settings.

### 8.5 Code health

- `@fos/core` ≥ 80% line coverage; 100% on segmenter, writer, deriver (deterministic layers).
- Refiner layer measured by eval (§8.2), not line coverage.
- Transcript reader has integration fixtures from at least 3 real Claude Code version variants.

### 8.6 Adoption signals (post-ship, not a shipping bar)

Criteria for deciding whether v2 is worth building:

- ≥ 50 unique installs within 30 days of marketplace publication.
- ≥ 20% of installs still have the hook firing after 14 days (retention).
- ≥ 3 unsolicited user reports citing "I used the comprehension graph to re-onboard / hand off / review code."

---

## 9. Transition to Implementation

After this spec is approved by the user, the next step is the `superpowers:writing-plans` skill — which will produce a sequenced implementation plan with task dependencies, verification checkpoints, and agent-dispatchable work units.

No other implementation skill should be invoked until the plan exists and the user has approved it.
