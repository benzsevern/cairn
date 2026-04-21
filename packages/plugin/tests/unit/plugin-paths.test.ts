import { describe, it, expect } from 'vitest';
import * as plugin from '../../src/plugin-paths.js';

describe('plugin-paths barrel completeness', () => {
  const required = [
    'comprehensionDir', 'sessionsDir', 'conceptsDir', 'fosDir',
    'manifestPath', 'graphJsonPath', 'graphHtmlPath',
    'sessionFilePath', 'conceptFilePath', 'overridePromptPath',
    'failedStubPath', 'consentPath', 'analysisLockPath',
    'pendingQueuePath', 'logsDir', 'logFilePath', 'ackedAtPath', 'installAckPath',
  ] as const;
  for (const name of required) {
    it(`exports ${name}`, () => {
      expect(typeof (plugin as Record<string, unknown>)[name]).toBe('function');
    });
  }
});
