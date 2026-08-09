import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { build } from 'vite';
import manifest from '../public/manifest.json' with { type: 'json' };

await build({
  configFile: false,
  plugins: [react(), crx({ manifest })],
  build: {
    commonjsOptions: {
      include: [/node_modules/, /vendor[\\/]antd-5\.27\.6/, /vendor[\\/]dayjs-compat/],
    },
  },
});
