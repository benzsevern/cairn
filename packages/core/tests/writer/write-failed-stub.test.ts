import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeFailedStub } from '../../src/writer/write-failed-stub.js';
import { failedStubPath } from '../../src/paths.js';

describe('writeFailedStub', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-fail-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('writes a JSON stub with attempt history and last raw', async () => {
    const path = await writeFailedStub(tmp, 'sess-x', '2026-04-20', {
      attempts: [{ attempt: 1, kind: 'parse', detail: 'bad json' }],
      lastRaw: 'garbage',
      reason: 'RefinerFailure',
    });
    expect(path).toBe(failedStubPath(tmp, 'sess-x', '2026-04-20'));
    const content = JSON.parse(await readFile(path, 'utf8'));
    expect(content.attempts[0].kind).toBe('parse');
    expect(content.last_raw).toBe('garbage');
    expect(content.reason).toBe('RefinerFailure');
  });
});
