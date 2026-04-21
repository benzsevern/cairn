# FOS v2 Plan 2 — Phase 0 Plugin-Format Probe Findings

**Date:** 2026-04-21
**Branch:** `feat/plan-2-plugin-layer`
**Claude Code version:** `2.1.116`
**Platform:** Windows 11, bash (Git Bash), pnpm 9

This document records the empirical answers to the open questions listed
in the Plan-2 spec §7.4 and Phase 0 tasks. Findings were gathered by:

1. Inspecting the installed plugin cache at
   `C:\Users\bsevern\.claude\plugins\cache\claude-plugins-official\` (four
   first-party plugins: `superpowers`, `plugin-dev`, `security-guidance`,
   `vercel` — all ship the same manifest/hook shape).
2. Building a throwaway `plugin-probe/` plugin and installing it via the
   real install flow (`claude plugins marketplace add ./plugin-probe`
   + `claude plugins install fos-probe@fos-probe-dev`).
3. Running `claude plugins validate` against the probe with a battery of
   good/bad manifests to observe the validator's error surface.
4. Reading the first-party `plugin-dev` plugin's documentation skills
   (`hook-development`, `command-development`), which are the authoritative
   ground-truth docs that ship with Claude Code itself.

Dynamic execution of the `SessionStart` and `Stop` hooks (which requires
starting a real top-level Claude Code session, not a subagent) could not
be performed from this subagent's sandboxed context. The behavior of those
hooks at runtime is answered from static evidence in the official hook
docs plus the working `superpowers` SessionStart hook (see
`C:\Users\bsevern\.claude\plugins\cache\claude-plugins-official\superpowers\5.0.4\hooks\session-start`).
Items that still need a human to run them are called out explicitly in
section 6.

---

## 1. `plugin.json` schema

**The spec's guess was wrong in several important ways.** The corrected
facts:

### 1.1 Manifest location

The plugin manifest **must** live at `<plugin-root>/.claude-plugin/plugin.json`
— NOT at `<plugin-root>/plugin.json`. The `.claude-plugin/` directory is
required and is where the CLI looks.

Install from a local directory is a two-step flow:

```bash
claude plugins marketplace add ./my-plugin    # path, URL, or GitHub repo
claude plugins install <plugin-name>@<marketplace-name>
```

This means the FOS plugin also needs a `.claude-plugin/marketplace.json`
(a tiny wrapper that points at itself) so that `pnpm run install-plugin`
or its equivalent can reach `claude plugins install` successfully. There
is no `claude plugins install file:./path` flow — that shape the spec
assumed does not exist.

### 1.2 Required vs optional fields

`claude plugins validate` enforces a **strict, closed schema** (unknown
keys are errors). Observed rules:

| Field | Status | Notes |
|---|---|---|
| `name` | **required** (error if missing/wrong type) | Case-sensitive. `"Name"` is rejected with `Unrecognized key: "Name"` + `name: Invalid input: expected string, received undefined`. |
| `version` | optional but **warned** if missing | Warning text: `No version specified. Consider adding a version following semver`. |
| `description` | optional, warned if missing | — |
| `author` | optional, warned if missing | Either a string or `{"name":"…","email":"…"}` object. |
| `homepage` | optional | String URL. |
| `repository` | optional | String URL. |
| `license` | optional | SPDX string. |
| `keywords` | optional | Array of strings. |
| `hooks` | optional | **Inline** hook config, same shape as `hooks/hooks.json`'s top-level `hooks` object. Either inline or separate-file works; separate file is the community convention. |
| `commands` | optional | **String path** (e.g. `"./commands"`). Default auto-discovery picks up `commands/*.md` even if field is absent. |
| `agents` | optional | Object shape; plain string and array-of-strings both rejected (`agents: Invalid input`). Not needed by FOS. |
| `skills` | optional | String path; auto-discovery from `skills/` works by default. |
| `mcpServers` | optional | Object mapping names to server configs (per MCP skill docs). |

**Anything else is rejected:** e.g. a stray `"foo":"bar"` produces
`root: Unrecognized key: "foo"`.

### 1.3 Minimal valid FOS `plugin.json`

```json
{
  "name": "comprehend-fos",
  "version": "0.2.0",
  "description": "Comprehension-debt failure-observing sidecar.",
  "author": { "name": "FOS" },
  "license": "MIT"
}
```

Commands are picked up from `commands/*.md` and hooks from `hooks/hooks.json`
automatically; those fields do NOT need to be listed in plugin.json.

---

## 2. Hook event payload delivery

**All three delivery mechanisms are used simultaneously:** stdin (for the
per-event payload), env vars (for ambient plugin/project context), and
stdout (for the hook's response to Claude). argv is NOT used.

### 2.1 Hook configuration (`hooks/hooks.json`)

The wrapper schema (plugin format) is:

```json
{
  "description": "Optional hook-file-level description",
  "hooks": {
    "<EventName>": [
      {
        "matcher": "<optional tool-name regex, omit for non-tool events>",
        "hooks": [
          {
            "type": "command",
            "command": "node \"${CLAUDE_PLUGIN_ROOT}/hooks/my-hook.js\"",
            "async": false,
            "timeout": 60
          }
        ]
      }
    ]
  }
}
```

Supported event names (from the authoritative `hook-development` skill):
`PreToolUse`, `PostToolUse`, `UserPromptSubmit`, `Stop`, `SubagentStop`,
`SessionStart`, `SessionEnd`, `PreCompact`, `Notification`.

`"type": "prompt"` is also available (Claude evaluates a natural-language
prompt instead of running a command). For FOS we stick with `"type":
"command"`.

### 2.2 Payload shape (stdin, JSON)

Every hook receives a JSON document on **stdin**, terminated by EOF (not a
newline). Common fields:

```json
{
  "session_id": "abc123",
  "transcript_path": "/path/to/transcript.txt",
  "cwd": "/current/working/dir",
  "permission_mode": "ask|allow",
  "hook_event_name": "Stop"
}
```

Event-specific additions:

- **PreToolUse / PostToolUse:** `tool_name`, `tool_input`, `tool_result`
- **UserPromptSubmit:** `user_prompt`
- **Stop / SubagentStop:** `reason`

### 2.3 Environment variables

Available in every command hook invocation:

- `CLAUDE_PROJECT_DIR` — project root path (FOS's `$ROOT`)
- `CLAUDE_PLUGIN_ROOT` — this plugin's install directory (use for
  resolving bundled files; equivalent to `dist/` root after install)
- `CLAUDE_ENV_FILE` — SessionStart only; write `export KEY=val` lines to
  persist env vars for the rest of the session
- `CLAUDE_CODE_REMOTE` — set when running in a remote/cloud context
- `CURSOR_PLUGIN_ROOT` — set when the same plugin runs under Cursor, not
  Claude Code. Useful fallback key to detect host.

### 2.4 Hook stdout contract (response)

Hooks communicate back to Claude Code by **writing JSON to stdout**.
Generic envelope:

```json
{ "continue": true, "suppressOutput": false, "systemMessage": "…" }
```

Event-specific richer shapes:

- **SessionStart context injection:**
  ```json
  { "hookSpecificOutput": { "hookEventName": "SessionStart", "additionalContext": "…" } }
  ```
  (Cursor uses `{ "additional_context": "…" }` at top level; the
  superpowers hook sniffs `CLAUDE_PLUGIN_ROOT` vs `CURSOR_PLUGIN_ROOT` to
  pick the right field. FOS should do the same.)

- **PreToolUse decision:**
  ```json
  { "hookSpecificOutput": { "permissionDecision": "allow|deny|ask", "updatedInput": {…} }, "systemMessage": "…" }
  ```

- **Stop / SubagentStop decision:**
  ```json
  { "decision": "approve|block", "reason": "…", "systemMessage": "…" }
  ```

Exit codes: `0` = success (stdout rendered in transcript), `2` = blocking
error (stderr fed back to Claude as a tool result), any other non-zero =
non-blocking error (logged, session continues).

**Important constraint:** hooks run in **parallel**. Multiple hooks
matching the same event don't see each other's output and run in
non-deterministic order. FOS's Stop hook must therefore be self-contained
and must not depend on another plugin's hook firing first.

### 2.5 Implications for FOS

- The Plan-2 spec's Stop hook design (read stdin JSON, scan transcript,
  produce facet files, maybe detach a subprocess, exit fast) is aligned
  with this contract. No changes needed there.
- Resolve bundled assets with `${CLAUDE_PLUGIN_ROOT}/dist/prompts/...` —
  not with `__dirname` or `process.cwd()`. The installed plugin root is a
  fully-copied directory (see §4), so `dist/` layout is preserved.
- When FOS wants to surface text to Claude (e.g. the "you have 3 pending
  comprehension queries" reminder from the roadmap), emit it via
  `systemMessage` on a SessionStart hook's stdout JSON.

---

## 3. Interactive slash commands — **MAJOR SPEC DELTA**

**The spec's assumption is fundamentally wrong.** Slash commands in Claude
Code are not executables, and therefore have no stdin/stdout/TTY of their
own. The spec sketch of `/comprehend init` reading readline input and
falling back to `--accept` is based on a mental model that does not match
reality.

### 3.1 What slash commands actually are

A slash command is a **Markdown file** (e.g. `commands/init.md`) with
optional YAML frontmatter. When the user types `/init`, Claude Code
**loads the markdown file contents and prepends them as instructions to
the LLM**. The command "runs" in the sense that the LLM receives new
instructions; nothing executes outside the LLM unless those instructions
tell Claude to invoke a tool (Bash, Read, Write, AskUserQuestion, etc.).

Exact quote from the `command-development` skill that ships with
Claude Code:

> "Commands are written for agent consumption, not human consumption.
> When a user invokes `/command-name`, the command content becomes
> Claude's instructions. Write commands as directives TO Claude about
> what to do, not as messages TO the user."

### 3.2 What "interactive" means in this world

Interactive commands use the **`AskUserQuestion` tool** — an LLM-facing
tool that pauses the agent turn, renders structured multi-choice
questions in the Claude Code UI, and returns the user's selection to the
LLM. Quote from the official `interactive-commands.md` reference:

> "Comprehensive guide to creating commands that gather user feedback and
> make decisions through the AskUserQuestion tool. […] For these cases,
> use the AskUserQuestion tool within command execution rather than
> relying on command arguments."

There is no way for a slash command to reach raw stdin/TTY. The questions
`stdin_tty` / `stdout_tty` don't apply.

### 3.3 Corrected design for `/comprehend init`

The Plan-2 spec's `/comprehend init` can still be interactive, but the
mechanism is:

1. `commands/init.md` contains instructions to Claude telling it to:
   - Run `comprehend-fos init --show-consent` via Bash to gather the
     consent prompt content + defaults from the JS side.
   - Use `AskUserQuestion` to ask the user whether to accept the consent
     (or customize facet selection, etc.).
   - On the answer, run `comprehend-fos init --accept` (or
     `--accept --facets=…`) via Bash to commit the decision.
2. Non-interactive flow (CI, scripts, user typing the CLI directly)
   stays as-is: `comprehend-fos init --accept` from a bash shell.

The `--accept` flag and non-interactive path the spec already has are
correct; the "readline fallback" text is not. The plan's Phase 3/4 tasks
that describe prompting from `commands/init.js` need to be rewritten in
terms of a markdown prompt that drives `AskUserQuestion` + Bash tool
calls.

**This is the finding that most warrants a spec amendment.** It does NOT
block Phase 1, but it WILL affect Phase 3+ task wording. Flagging for the
user: see §6.

---

## 4. Plugin install location + layout

### 4.1 Install path

Installed plugins land at:

```
~/.claude/plugins/cache/<marketplace-name>/<plugin-name>/<version>/
```

Concrete observed path for the probe:

```
C:\Users\bsevern\.claude\plugins\cache\fos-probe-dev\fos-probe\0.0.1\
```

Registry entries are written to `~/.claude/plugins/installed_plugins.json`:

```json
{
  "fos-probe@fos-probe-dev": [{
    "scope": "user",
    "installPath": "C:\\Users\\bsevern\\.claude\\plugins\\cache\\fos-probe-dev\\fos-probe\\0.0.1",
    "version": "0.0.1",
    "installedAt": "2026-04-21T13:43:37.893Z",
    "lastUpdated": "2026-04-21T13:43:37.893Z",
    "gitCommitSha": "3a72975be4e039135ea125bdcf38904ca278dfc1"
  }]
}
```

### 4.2 Copy vs symlink

**Copy**, not symlink. Every file in the plugin is materialized as a
regular file in the install dir (confirmed via `ls -la` — no `l` flags
in the mode column). This means:

- Editing files in the source `plugin-probe/` had **no effect** on the
  installed copy. A full `claude plugins uninstall && install` cycle (or
  `claude plugins update`) is required for changes to take effect.
- The plugin's relative directory structure (`.claude-plugin/`,
  `commands/`, `hooks/`, and any `dist/`, `dist/prompts/`, `dist/viewer/`
  subtrees FOS ships) is preserved verbatim. `${CLAUDE_PLUGIN_ROOT}`
  points at the install copy's root, so paths like
  `${CLAUDE_PLUGIN_ROOT}/dist/prompts/fact-sheet.md` resolve correctly
  post-install.
- `gitCommitSha` is pinned at install time, suggesting the install flow
  goes through git even for local-path marketplaces. This is fine but
  means the source directory must be a git repo (or the marketplace must
  be a git-reachable remote).

### 4.3 Scope options

`--scope user | project | local` controls where the install is declared
(not where files live — files always go in `~/.claude/plugins/cache/`).
For FOS's "opt-in per project" flow, `--scope project` writes the
declaration to `.claude/settings.json` in the project root, which is what
Plan-2's `/fos setup` should use.

---

## 5. Error surfacing for malformed manifests

`claude plugins validate <path>` produces **structured, actionable
errors**. Observed outputs for a plugin.json with various mistakes:

| Mutation | Validator output |
|---|---|
| `{"name":"p","version":"0.0.1"}` (valid) | `⚠ Found 2 warnings: description / author` + `✔ Validation passed with warnings` |
| Missing `name` | `✘ name: Invalid input: expected string, received undefined` |
| `"Name"` (wrong case) | `✘ name: Invalid input: expected string, received undefined` + `✘ root: Unrecognized key: "Name"` |
| Missing `version` | `⚠ version: No version specified. Consider adding a version following semver (e.g., "1.0.0")` (warning only, not error) |
| Unknown field `"foo":"bar"` | `✘ root: Unrecognized key: "foo"` |
| Wrong shape for `agents: "./agents"` | `✘ agents: Invalid input` |
| Invalid JSON syntax | `✘ json: Invalid JSON syntax: JSON Parse error: Expected '}'` |

**At session load time** (per the `hook-development` skill), the same
validation runs and reports issues to `claude --debug`. Invalid JSON
causes the hooks.json load to fail; missing scripts produce warnings but
the session still starts. There is no silent-fail behavior observed; FOS
can count on the validator to catch most mistakes pre-commit if we add a
simple `pnpm run validate:plugin` that calls `claude plugins validate
packages/plugin` (or the built `dist/` variant) in CI.

**Implication for `@fos/plugin`:** we don't need to build a heavyweight
custom validator on top of Zod just for plugin.json; `claude plugins
validate` is the authority. We DO still want a unit test that constructs
the manifest JSON and then asserts Zod-parses it (so our build output
can't drift from what `@fos/core` expects internally), but the ultimate
arbiter is the CLI's validator.

---

## 6. Surprising behavior & spec adjustments

### 6.1 Commands are LLM prompts, not scripts (**major**)

Already covered in §3. The Plan-2 spec's `commands/*.js` files that
directly do readline, write files, etc. are not how slash commands work.
Commands must be `.md` files that *tell Claude what to do*, and any
imperative logic lives in the `comprehend-fos` Node CLI (invoked via
the Bash tool by Claude) rather than inside the command file itself.

**Proposed spec amendment** (summary; full redraft left for the user to
approve before Phase 3):

- Rewrite the "Phase 3 — Plugin package" section so `commands/setup.md`,
  `commands/init.md`, `commands/status.md`, `commands/why.md`,
  `commands/report.md`, `commands/queue.md` are markdown prompt templates
  whose job is to orchestrate the `comprehend-fos` CLI (which is the one
  true binary, living in `@fos/plugin` or `@fos/core` as a bin entry).
- The `--accept` flag, the JSON facet specs, and the exit-code contract
  from the CLI remain load-bearing and survive unchanged.
- The `@fos/plugin` package's published output is effectively:
  1. `.claude-plugin/plugin.json`
  2. `.claude-plugin/marketplace.json` (self-wrapper)
  3. `commands/*.md` (LLM-facing prompts)
  4. `hooks/hooks.json` (SessionStart, Stop)
  5. `hooks/*.js` (command-type hooks, real code)
  6. `dist/prompts/*.md`, `dist/viewer/*.html`, `dist/cli.js` (the
     `comprehend-fos` CLI)

### 6.2 Plugin install flow is marketplace-first (minor but real)

There is no `claude plugins install file:./path` shortcut; you must
`marketplace add` first. Plan-2's Phase 7 (publish / distribution) needs
a marketplace descriptor. For local dev, Phase 1/2 tasks should add a
`.claude-plugin/marketplace.json` self-wrapper (tiny file) to
`packages/plugin/` so developers can `pnpm run install-plugin-locally`
end-to-end.

### 6.3 Source dir must be a git repo (minor)

The install registry records a `gitCommitSha`, so install from a local
path appears to go via git. The FOS monorepo is already a git repo — no
action needed, just document this for users who might try installing
from a tarball download.

### 6.4 Hooks run in parallel (minor)

Multiple plugins' hooks on the same event run concurrently and
independently. FOS's Stop hook must be self-contained — it cannot
assume it runs after (or before) any other Stop hook. This is compatible
with the Plan-2 spec's current design (the Stop hook writes to
`.comprehension/.fos/` and detaches a subprocess; no cross-hook
coordination).

### 6.5 Hot-reload is not supported (minor)

Per the `hook-development` skill: "Hooks are loaded when Claude Code
session starts. Changes to hook configuration require restarting Claude
Code." This means iteration on the FOS Stop hook during development
requires exit + `claude` restart, not just a file save. The DX section
of the plan should mention this.

### 6.6 Dynamic verification still owed (requires manual run)

The following cannot be verified from within a subagent context and need
a human to run them in an interactive top-level Claude Code session on
this repo, ideally before Phase 3 kicks off. The probe plugin has been
removed; if re-verification is needed, reinstate it first.

Verification commands (to run in an interactive session with the probe
reinstalled):

```bash
# 1. Reinstall the probe
claude plugins marketplace add ./plugin-probe
claude plugins install fos-probe@fos-probe-dev

# 2. Start a new session in a project directory.
# Observe ~/.fos-probe-log.txt — there should be a SessionStart entry
# with stdin populated with the payload JSON.
claude
# (in the session, do some work then exit with Ctrl+C or /exit)

# 3. Inspect the log
cat ~/.fos-probe-log.txt

# 4. Clean up
claude plugins uninstall fos-probe@fos-probe-dev
claude plugins marketplace remove fos-probe-dev
rm -rf plugin-probe/ ~/.fos-probe-log.txt
```

Expected observations (based on the docs, not observed directly):

- `stdin` contains a JSON object with `session_id`, `hook_event_name:
  "SessionStart"` (or `"Stop"`), `cwd`, `transcript_path`,
  `permission_mode`.
- `env_values` includes `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PROJECT_DIR`,
  possibly `CLAUDE_ENV_FILE` on SessionStart.
- `argv` is `['node', '/path/to/stop.js']` — no payload there.

If reality differs from these predictions, the Plan-2 spec's Stop-hook
implementation may need small tweaks (field renames at worst), but the
overall architecture is unaffected.

---

## Decision: proceed to Phase 1

The findings confirm the Plan-2 architecture is feasible. One significant
rewrite (§6.1: commands-as-markdown) is needed in the spec before Phase 3
touches `packages/plugin/commands/`. That rewrite does not affect Phase 1
(`@fos/core` path additions) or Phase 2 (spec's planner/writer), so we can
proceed with Phase 1 while the user decides how to amend the command
sections of the spec.

Recommendation: **proceed to Phase 1, escalate §6.1 to the human before
Phase 3.**
