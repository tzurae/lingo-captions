import { startVitest } from 'vitest/node';

const filters = process.argv.slice(2);

await startVitest('test', filters, {
  root: process.cwd(),
  config: false,
  run: true,
  watch: false,
  environment: 'jsdom',
  setupFiles: ['./tests/test-setup.ts'],
});
