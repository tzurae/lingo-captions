import { resolve } from 'node:path';
import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import manifest from '../public/manifest.json' with { type: 'json' };

const root = resolve(import.meta.dirname, '..');

await build({
  root,
  configFile: false,
  plugins: [react(), crx({ manifest })],
  build: {
    commonjsOptions: {
      include: [/node_modules/, /vendor[\\/]antd-5\.27\.6/, /vendor[\\/]dayjs-compat/],
    },
  },
});
