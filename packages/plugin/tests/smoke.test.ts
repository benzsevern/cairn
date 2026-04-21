import { describe, it, expect } from 'vitest';
import { VERSION, consentPath, installAckPath } from '../src/plugin-paths.js';

describe('@fos/plugin smoke', () => {
  it('re-exports @fos/core VERSION', () => {
    expect(VERSION).toBe('0.0.1');
  });
  it('re-exports plugin path helpers from core', () => {
    expect(consentPath('/tmp/x')).toMatch(/consent\.json$/);
    expect(installAckPath()).toMatch(/fos-install-ack$/);
  });
});
