import { resolve } from 'node:path';
import { startVitest } from 'vitest/node';

const root = resolve(import.meta.dirname, '..');

await startVitest(
  'test',
  process.argv.slice(2),
  { root, run: true, environment: 'jsdom', setupFiles: [resolve(root, 'tests/test-setup.ts')] },
  { root, configFile: false },
);
