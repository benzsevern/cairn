#!/usr/bin/env node
// One-off sweep: redact JSON-encoded Windows home paths that scrub-transcript.mjs
// missed (its regex was tuned for single-backslash form, but JSON strings carry
// double-backslashes). Run on any staged transcript.jsonl after scrubbing.

import { readFileSync, writeFileSync } from 'node:fs';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('usage: sweep-json-paths <file.jsonl> [<file.jsonl>...]');
  process.exit(2);
}

// Matches two literal backslashes (as bytes). Regex \\\\ = two actual backslashes.
const JSON_HOME = /[A-Z]:\\\\Users\\\\[A-Za-z0-9._-]+/g;
// Also the unix-style form just in case.
const UNIX_HOME = /\/Users\/[A-Za-z0-9._-]+/g;

for (const file of files) {
  const before = readFileSync(file, 'utf8');
  const after = before.replace(JSON_HOME, '<HOME>').replace(UNIX_HOME, '<HOME>');
  writeFileSync(file, after);
  console.log(`${file}: ${before.length - after.length} chars removed`);
}
