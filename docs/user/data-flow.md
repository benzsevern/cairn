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
