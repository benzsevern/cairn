import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { discoverProjectRoot, findClaudeCodeProjectHash } from '../../src/discover-project.js';

async function real(p: string): Promise<string> { return realpath(p); }

describe('discoverProjectRoot', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await real(await mkdtemp(join(tmpdir(), 'fos-disc-'))); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('finds .git/ parent', async () => {
    await mkdir(join(tmp, '.git'), { recursive: true });
    const nested = join(tmp, 'a', 'b', 'c');
    await mkdir(nested, { recursive: true });
    const result = await discoverProjectRoot(nested);
    expect(resolve(result)).toBe(resolve(tmp));
  });

  it('finds .comprehension/ parent', async () => {
    await mkdir(join(tmp, '.comprehension'), { recursive: true });
    const nested = join(tmp, 'x', 'y');
    await mkdir(nested, { recursive: true });
    const result = await discoverProjectRoot(nested);
    expect(resolve(result)).toBe(resolve(tmp));
  });

  it('falls back to cwd when neither exists', async () => {
    const nested = join(tmp, 'orphan');
    await mkdir(nested, { recursive: true });
    const result = await discoverProjectRoot(nested);
    expect(resolve(result)).toBe(resolve(nested));
  });

  it('warnOnFallthrough: true writes a warning to stderr but still returns the fallback', async () => {
    const nested = join(tmp, 'orphan-warn');
    await mkdir(nested, { recursive: true });
    const chunks: Buffer[] = [];
    const { Writable } = await import('node:stream');
    const stderr = new Writable({
      write(chunk, _enc, cb) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); cb(); },
    });
    const result = await discoverProjectRoot(nested, { warnOnFallthrough: true, stderr });
    expect(resolve(result)).toBe(resolve(nested));
    const text = Buffer.concat(chunks).toString('utf8');
    expect(text).toMatch(/no \.git\/ or \.comprehension\/ ancestor/);
  });

  it('warnOnFallthrough default (false) does not write to stderr', async () => {
    const nested = join(tmp, 'orphan-silent');
    await mkdir(nested, { recursive: true });
    const chunks: Buffer[] = [];
    const { Writable } = await import('node:stream');
    const stderr = new Writable({
      write(chunk, _enc, cb) { chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk); cb(); },
    });
    // Cast to allow passing stderr without opting in.
    await discoverProjectRoot(nested, { stderr });
    expect(Buffer.concat(chunks).toString('utf8')).toBe('');
  });
});

describe('findClaudeCodeProjectHash', () => {
  let tmp: string;
  let claudeDir: string;
  let projectRoot: string;
  beforeEach(async () => {
    tmp = await real(await mkdtemp(join(tmpdir(), 'fos-hash-')));
    claudeDir = join(tmp, '.claude', 'projects');
    projectRoot = join(tmp, 'my-project');
    await mkdir(claudeDir, { recursive: true });
    await mkdir(projectRoot, { recursive: true });
  });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('returns the hash directory whose first JSONL event cwd matches projectRoot', async () => {
    const otherHash = join(claudeDir, 'hash-other');
    const matchHash = join(claudeDir, 'hash-match');
    await mkdir(otherHash, { recursive: true });
    await mkdir(matchHash, { recursive: true });
    await writeFile(join(otherHash, 'a.jsonl'), JSON.stringify({ cwd: join(tmp, 'somewhere-else') }) + '\n', 'utf8');
    await writeFile(join(matchHash, 'b.jsonl'), JSON.stringify({ cwd: projectRoot }) + '\n', 'utf8');
    const found = await findClaudeCodeProjectHash(projectRoot, { claudeProjectsDir: claudeDir });
    expect(found).toBe('hash-match');
  });

  it('returns null when no match', async () => {
    const h = join(claudeDir, 'hash-nope');
    await mkdir(h, { recursive: true });
    await writeFile(join(h, 'a.jsonl'), JSON.stringify({ cwd: join(tmp, 'elsewhere') }) + '\n', 'utf8');
    const found = await findClaudeCodeProjectHash(projectRoot, { claudeProjectsDir: claudeDir });
    expect(found).toBeNull();
  });
});
