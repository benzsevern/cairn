# @fos/core

Engine for FOS — the comprehension layer for Claude Code sessions. Reads session JSONL transcripts, invokes an LLM refiner, and produces a persistent comprehension graph on disk.

See the design spec for the full story: `docs/superpowers/specs/2026-04-20-fos-retrospective-comprehension-layer-design.md`

## Install

    npm i -g @fos/core   # global — provides `fos` CLI
    # or
    npm i --save-dev @fos/core   # per-project

## Quick start

    fos init                                           # scaffolds .comprehension/
    fos analyze ~/.claude/projects/<hash>/<id>.jsonl   # analyze one session
    fos rebuild                                        # regenerate project view
    fos backfill --project-hash <hash>                 # analyze all prior sessions

Outputs live in `.comprehension/` and are meant to be committed to git.

## What this package is NOT

- A Claude Code plugin (that's `@fos/plugin`, Plan 2 of the roadmap).
- A marketplace-ready release (Plan 3 completes release prep and quality gates).

## Development

    pnpm install
    pnpm --filter @fos/core test
    pnpm --filter @fos/core build
    pnpm --filter @fos/core eval            # cached golden corpus
    FOS_EVAL_REAL=1 pnpm --filter @fos/core eval   # real refiner

## License

(TBD in Plan 3)
