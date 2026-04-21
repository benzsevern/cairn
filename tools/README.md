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
