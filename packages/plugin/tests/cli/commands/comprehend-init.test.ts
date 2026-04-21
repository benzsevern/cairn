import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, stat, mkdir, writeFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { runInitSubcommand, type InitDeps } from '../../../src/cli/commands/comprehend-init.js';
import { writeProjectConsent } from '../../../src/consent.js';
import { consentPath } from '../../../src/plugin-paths.js';

function capture(): { stream: Writable; text: () => string } {
  const chunks: Buffer[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      cb();
    },
  });
  return { stream, text: () => Buffer.concat(chunks).toString('utf8') };
}

describe('comprehend-init subcommand', () => {
  let tmp: string;
  let home: string;
  const fixedNow = () => new Date('2026-04-20T12:00:00.000Z');

  beforeEach(async () => {
    tmp = await mkdtemp(join(tmpdir(), 'fos-init-'));
    home = await mkdtemp(join(tmpdir(), 'fos-init-home-'));
  });
  afterEach(async () => {
    await rm(tmp, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  const baseDeps = (): InitDeps => ({
    homeOverride: home,
    claudeProjectsDir: join(home, '.claude', 'projects'),
    now: fixedNow,
    findHashImpl: async () => null,
    discoverSessionsImpl: async () => [],
  });

  it('--show-consent emits JSON probe with install_ack=false, consent_exists=false', async () => {
    const out = capture();
    const err = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, showConsent: true },
      { ...baseDeps(), stdout: out.stream, stderr: err.stream },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json).toMatchObject({
      install_ack: false,
      consent_exists: false,
      backfill_count: 0,
    });
    expect(typeof json['estimated_cost_usd_low']).toBe('number');
    expect(typeof json['estimated_cost_usd_high']).toBe('number');
  });

  it('--show-consent reports install_ack=true + consent_exists=true when both present', async () => {
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'fos-install-ack'), '', 'utf8');
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });

    const out = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, showConsent: true },
      { ...baseDeps(), stdout: out.stream, stderr: capture().stream },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json['install_ack']).toBe(true);
    expect(json['consent_exists']).toBe(true);
  });

  it('--accept without install_ack exits 1 and does not write consent', async () => {
    const err = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, accept: true, skipBackfill: true },
      { ...baseDeps(), stdout: capture().stream, stderr: err.stream },
    );
    expect(code).toBe(1);
    expect(err.text()).toMatch(/Install acknowledgment missing/);
    await expect(stat(consentPath(tmp))).rejects.toThrow();
  });

  it('--accept with ack and no prior consent writes consent.json, skips backfill when flagged', async () => {
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'fos-install-ack'), '', 'utf8');
    const runInitImpl = vi.fn(async () => {});
    const backfillImpl = vi.fn();

    const out = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, accept: true, skipBackfill: true },
      {
        ...baseDeps(),
        runInitImpl,
        backfillImpl: backfillImpl as unknown as InitDeps['backfillImpl'],
        stdout: out.stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);
    expect(runInitImpl).toHaveBeenCalledWith({ projectRoot: expect.any(String) });
    expect(backfillImpl).not.toHaveBeenCalled();
    await expect(stat(consentPath(tmp))).resolves.toBeDefined();
  });

  it('--accept is idempotent when consent already exists', async () => {
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'fos-install-ack'), '', 'utf8');
    await writeProjectConsent(tmp, { opted_in_at: fixedNow().toISOString() });
    const runInitImpl = vi.fn(async () => {});

    const out = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, accept: true },
      { ...baseDeps(), runInitImpl, stdout: out.stream, stderr: capture().stream },
    );
    expect(code).toBe(0);
    expect(runInitImpl).not.toHaveBeenCalled();
    expect(out.text()).toMatch(/already opted in/);
  });

  it('--show-consent includes consent_required_text when install_ack missing', async () => {
    const out = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, showConsent: true },
      { ...baseDeps(), stdout: out.stream, stderr: capture().stream },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json['install_ack']).toBe(false);
    expect(typeof json['consent_required_text']).toBe('string');
    expect(json['consent_required_text']).toContain('docs/user/data-flow.md');
  });

  it('--show-consent returns null consent_required_text when ack present', async () => {
    await mkdir(join(home, '.claude'), { recursive: true });
    await writeFile(join(home, '.claude', 'fos-install-ack'), '', 'utf8');
    const out = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp, showConsent: true },
      { ...baseDeps(), stdout: out.stream, stderr: capture().stream },
    );
    expect(code).toBe(0);
    const json = JSON.parse(out.text().trim()) as Record<string, unknown>;
    expect(json['install_ack']).toBe(true);
    expect(json['consent_required_text']).toBeNull();
  });

  it('--accept --accept-machine-consent touches ack file and writes consent', async () => {
    const runInitImpl = vi.fn(async () => {});
    const code = await runInitSubcommand(
      {
        projectRoot: tmp,
        accept: true,
        acceptMachineConsent: true,
        skipBackfill: true,
      },
      {
        ...baseDeps(),
        runInitImpl,
        stdout: capture().stream,
        stderr: capture().stream,
      },
    );
    expect(code).toBe(0);
    await expect(access(join(home, '.claude', 'fos-install-ack'))).resolves.toBeUndefined();
    await expect(stat(consentPath(tmp))).resolves.toBeDefined();
  });

  it('bare invocation prints usage and exits 2', async () => {
    const err = capture();
    const code = await runInitSubcommand(
      { projectRoot: tmp },
      { ...baseDeps(), stdout: capture().stream, stderr: err.stream },
    );
    expect(code).toBe(2);
    expect(err.text()).toMatch(/Usage:/);
  });
});
