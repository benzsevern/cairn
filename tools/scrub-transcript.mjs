#!/usr/bin/env node
// Usage: node tools/scrub-transcript.mjs <input.jsonl> <output.jsonl> [--redact-word foo] [--redact-word bar]
// Redacts common sensitive patterns; flags suspect lines for human review.

import { readFile, writeFile } from 'node:fs/promises';

const SECRET_PATTERNS = [
  { name: 'email', re: /[\w.+-]+@[\w-]+\.[\w.-]+/g, replacement: '<redacted-email>' },
  { name: 'sk-key', re: /\bsk-[A-Za-z0-9_-]{20,}\b/g, replacement: '<redacted-token>' },
  { name: 'ghp-token', re: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: '<redacted-token>' },
  { name: 'unix-home', re: /\/Users\/[A-Za-z0-9._-]+/g, replacement: '<HOME>' },
  { name: 'windows-home', re: /[A-Z]:\\Users\\[A-Za-z0-9._-]+/g, replacement: '<HOME>' },
  { name: 'aws-key', re: /\bAKIA[0-9A-Z]{16}\b/g, replacement: '<redacted-aws-key>' },
];

const SUSPECT_PATTERNS = [
  /password[\s:=]+['"]?[^\s'"]+/gi,
  /secret[\s:=]+['"]?[^\s'"]+/gi,
  /\bAPI[_\- ]?KEY\b/gi,
  /\bTOKEN\b[\s:=]+['"]?[^\s'"]+/gi,
];

async function main() {
  const [, , inPath, outPath, ...rest] = process.argv;
  if (!inPath || !outPath) {
    console.error('usage: scrub-transcript <input.jsonl> <output.jsonl> [--redact-word word]*');
    process.exit(2);
  }
  const redactWords = [];
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === '--redact-word' && rest[i + 1]) {
      redactWords.push(rest[i + 1]);
      i++;
    }
  }

  const raw = await readFile(inPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const suspects = [];
  const out = lines.map((line, lineNum) => {
    let replaced = line;
    for (const p of SECRET_PATTERNS) replaced = replaced.replace(p.re, p.replacement);
    for (const word of redactWords) {
      const re = new RegExp(`\\b${word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
      replaced = replaced.replace(re, '<redacted-word>');
    }
    for (const p of SUSPECT_PATTERNS) {
      const matches = replaced.match(p);
      if (matches) suspects.push({ lineNum: lineNum + 1, matches });
    }
    return replaced;
  });

  await writeFile(outPath, out.join('\n'), 'utf8');

  console.log(`Wrote ${outPath} (${out.length} lines).`);
  if (suspects.length > 0) {
    console.error('\n⚠ Suspect patterns still present — manual review required:');
    for (const s of suspects) {
      console.error(`  line ${s.lineNum}: ${s.matches.slice(0, 3).join(', ')}`);
    }
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
