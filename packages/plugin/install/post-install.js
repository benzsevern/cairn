#!/usr/bin/env node
const { writeFileSync, mkdirSync } = require('node:fs');
const { join } = require('node:path');
const { homedir } = require('node:os');
const { createInterface } = require('node:readline/promises');

const CONSENT_TEXT = `
[@fos/plugin v0.0.1]

This plugin analyzes your Claude Code session transcripts in the
background and builds a comprehension graph in each opted-in project's
.comprehension/ directory.

How analysis runs:
 - Invokes your existing \`claude -p\` command (no new API key).
 - Reads transcripts under ~/.claude/projects/.
 - Writes .comprehension/ to each opted-in project.

Data flow: unchanged from your normal Claude Code usage. The plugin
does NOT contact any third-party provider.
`;

async function main() {
  process.stdout.write(CONSENT_TEXT + '\n');
  if (process.stdin.isTTY) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    await rl.question('Press Enter to acknowledge (installation continues either way) ');
    rl.close();
  }
  const ackDir = join(homedir(), '.claude');
  mkdirSync(ackDir, { recursive: true });
  writeFileSync(join(ackDir, 'fos-install-ack'), '', 'utf8');
  process.stdout.write(
    '\nThe plugin is installed but dormant. Run `/comprehend init` inside a project to opt it in for analysis.\n',
  );
}

main().catch((err) => {
  process.stderr.write(String(err) + '\n');
  process.exit(1);
});
