import { describe, it, expect } from 'vitest';
import {
  comprehensionDir,
  sessionFilePath,
  conceptFilePath,
  manifestPath,
  overridePromptPath,
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
