import { describe, expect, it } from 'vitest';
import type { InlineConfig, Rollup } from 'vite';

describe('production dependency bundle', () => {
  it('loads Ant Design without crashing during dayjs initialization', async () => {
    Object.defineProperty(globalThis, 'Uint8Array', {
      configurable: true,
      value: new TextEncoder().encode('').constructor,
    });
    const { build } = await import('vite');
    const { default: viteConfig } = await import('../vite.config');
    const resolvedConfig = typeof viteConfig === 'function'
      ? await viteConfig({ command: 'build', mode: 'production', isSsrBuild: false, isPreview: false })
      : await viteConfig;
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      build: {
        write: false,
        minify: true,
        commonjsOptions: resolvedConfig.build?.commonjsOptions,
        rollupOptions: {
          input: decodeURIComponent(new URL('./fixtures/antd-runtime-entry.ts', import.meta.url).pathname)
            .replace(/^\/([A-Za-z]:\/)/, '$1'),
          output: { format: 'cjs', inlineDynamicImports: true },
        },
      },
    } satisfies InlineConfig);

    const buildOutput = result as Rollup.RollupOutput | Rollup.RollupOutput[];
    const output = Array.isArray(buildOutput) ? buildOutput[0].output : buildOutput.output;
    const chunk = output.find((item): item is Rollup.OutputChunk => item.type === 'chunk');
    expect(chunk).toBeDefined();

    const bundledModule = { exports: {} };
    new Function('module', 'exports', chunk!.code)(bundledModule, bundledModule.exports);

    expect((globalThis as typeof globalThis & { __ANT_DESIGN_RUNTIME_SMOKE__?: boolean })
      .__ANT_DESIGN_RUNTIME_SMOKE__).toBe(true);
  }, 30_000);
});
