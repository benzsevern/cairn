import { describe, it, expect } from 'vitest';
import {
  comprehensionDir,
  sessionFilePath,
  conceptFilePath,
  manifestPath,
  overridePromptPath,
  consentPath,
  analysisLockPath,
  pendingQueuePath,
  logsDir,
  logFilePath,
  ackedAtPath,
  installAckPath,
} from '../src/paths.js';

describe('paths', () => {
  const root = '/tmp/proj';

  it('computes .comprehension/ root', () => {
    expect(comprehensionDir(root)).toMatch(/\.comprehension$/);
  });

  it('session file includes date prefix and id', () => {
    const p = sessionFilePath(root, 'abc123', '2026-04-20');
    expect(p).toMatch(/sessions[\\/]2026-04-20-abc123\.md$/);
  });

  it('concept file uses slug.md', () => {
    expect(conceptFilePath(root, 'fuzzy-matching')).toMatch(/concepts[\\/]fuzzy-matching\.md$/);
  });

  it('manifest sits at comprehension root', () => {
    expect(manifestPath(root)).toMatch(/\.comprehension[\\/]manifest\.json$/);
  });

  it('override prompt lives under .fos/', () => {
    expect(overridePromptPath(root)).toMatch(/\.fos[\\/]refiner-prompt\.md$/);
  });
});

describe('plugin paths', () => {
  const root = '/tmp/proj';

  it('consent.json lives under .comprehension/.fos/', () => {
    expect(consentPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]consent\.json$/);
  });

  it('analysis.lock lives under .comprehension/.fos/', () => {
    expect(analysisLockPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]analysis\.lock$/);
  });

  it('pending.json lives under .comprehension/.fos/', () => {
    expect(pendingQueuePath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]pending\.json$/);
  });

  it('logs dir and per-session log files under .comprehension/.fos/logs/', () => {
    expect(logsDir(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]logs$/);
    expect(logFilePath(root, 'sess-abc')).toMatch(/\.comprehension[\\/]\.fos[\\/]logs[\\/]sess-abc\.log$/);
  });

  it('acked_at marker lives under .comprehension/.fos/', () => {
    expect(ackedAtPath(root)).toMatch(/\.comprehension[\\/]\.fos[\\/]acked_at$/);
  });

  it('install ack marker lives under user home ~/.claude/', () => {
    const p = installAckPath();
    expect(p).toMatch(/[\\/]\.claude[\\/]fos-install-ack$/);
  });
});
