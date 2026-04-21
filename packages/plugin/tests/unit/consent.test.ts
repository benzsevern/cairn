import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  hasInstallAck,
  writeInstallAck,
  hasProjectConsent,
  writeProjectConsent,
  readProjectConsent,
} from '../../src/consent.js';

describe('consent', () => {
  let tmp: string;
  beforeEach(async () => { tmp = await mkdtemp(join(tmpdir(), 'fos-plugin-consent-')); });
  afterEach(async () => { await rm(tmp, { recursive: true, force: true }); });

  it('hasInstallAck returns false when ack file missing', async () => {
    expect(await hasInstallAck({ homeOverride: tmp })).toBe(false);
  });

  it('writeInstallAck creates the marker and hasInstallAck returns true', async () => {
    await writeInstallAck({ homeOverride: tmp });
    expect(await hasInstallAck({ homeOverride: tmp })).toBe(true);
  });

  it('hasProjectConsent returns false when consent.json missing', async () => {
    expect(await hasProjectConsent(tmp)).toBe(false);
  });

  it('writeProjectConsent creates .fos/ + consent.json and readProjectConsent round-trips', async () => {
    await writeProjectConsent(tmp, { opted_in_at: '2026-04-21T10:00:00Z' });
    expect(await hasProjectConsent(tmp)).toBe(true);
    const c = await readProjectConsent(tmp);
    expect(c).toEqual({
      opted_in_at: '2026-04-21T10:00:00Z',
      acknowledged_install: true,
      scope: 'this-project',
    });
  });
});
