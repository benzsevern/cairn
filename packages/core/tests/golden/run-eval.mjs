#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { existsSync, unlinkSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const flags = process.argv.slice(2);

if (flags.includes('--snapshot')) {
  process.env['FOS_EVAL_MODE'] = 'snapshot';
  await runVitestOnce();
  process.exit(0);
}

if (flags.includes('--snapshot-delta')) {
  process.env['FOS_EVAL_MODE'] = 'snapshot-delta';
}
if (flags.includes('--real')) {
  process.env['FOS_EVAL_REAL'] = '1';
}
if (flags.includes('--api')) {
  process.env['FOS_EVAL_PROVIDER'] = 'api';
  process.env['FOS_EVAL_REAL'] = '1';
}

let tmpBaseline = null;

if (flags.includes('--against')) {
  const idx = flags.indexOf('--against');
  const ref = flags[idx + 1];
  if (!ref) {
    console.error('--against requires a git ref');
    process.exit(2);
  }
  tmpBaseline = join(here, 'baseline.against.tmp.json');
  const p = spawn('git', ['show', `${ref}:packages/core/tests/golden/baseline.json`], {
    stdio: ['ignore', 'pipe', 'inherit'],
    shell: true,
  });
  let out = '';
  p.stdout.on('data', (d) => { out += d; });
  const code = await new Promise((r) => p.on('close', r));
  if (code !== 0 || out.length === 0) {
    console.error(`git show failed for ref ${ref}`);
    process.exit(2);
  }
  await writeFile(tmpBaseline, out, 'utf8');
  process.env['FOS_EVAL_BASELINE_PATH'] = tmpBaseline;
}

try {
  await runVitestOnce();
} finally {
  if (tmpBaseline && existsSync(tmpBaseline)) {
    try { unlinkSync(tmpBaseline); } catch {}
  }
}

async function runVitestOnce() {
  return new Promise((resolve, reject) => {
    const v = spawn('pnpm', ['exec', 'vitest', 'run', 'tests/golden'], {
      stdio: 'inherit',
      shell: true,
    });
    v.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`vitest exit ${code}`))));
  });
}
