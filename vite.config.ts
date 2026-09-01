import { crx } from '@crxjs/vite-plugin';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import manifest from './public/manifest.json';

export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'test' ? [] : [crx({ manifest })])],
  resolve: {
    alias: mode === 'test'
      ? [{ find: 'antd', replacement: '/tests/browser/antd-stub.tsx' }]
      : [],
  },
  build: {
    commonjsOptions: {
      include: [/node_modules/, /vendor[\\/]antd-5\.27\.6/, /vendor[\\/]dayjs-compat/],
    },
  },
}));
