import { chromium, expect, test } from '@playwright/test';

const extensionPath = decodeURIComponent(new URL('../../dist', import.meta.url).pathname);

test('the production package loads its worker and Side Panel', async ({}, testInfo) => {
  const context = await chromium.launchPersistentContext(testInfo.outputPath('profile'), {
    channel: 'chromium',
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  try {
    const worker = context.serviceWorkers()[0]
      ?? await context.waitForEvent('serviceworker', { timeout: 15_000 });
    const workerState = await worker.evaluate(async () => {
      await chrome.storage.local.set({ issue6PackageSmoke: 'ok' });
      const stored = await chrome.storage.local.get('issue6PackageSmoke');
      return {
        extensionId: new URL(location.href).host,
        manifest: chrome.runtime.getManifest(),
        stored: stored.issue6PackageSmoke,
        hasSidePanelApi: typeof chrome.sidePanel === 'object',
      };
    });

    expect(workerState.manifest.name).toBe('YouTube English Learning');
    expect(workerState.stored).toBe('ok');
    expect(workerState.hasSidePanelApi).toBe(true);

    const page = await context.newPage();
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') pageErrors.push(message.text());
    });
    await page.goto(`chrome-extension://${workerState.extensionId}/src/sidepanel/index.html`);

    await expect(page.getByRole('tab', { name: '字幕' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '歷史' })).toBeVisible();
    await expect(page.getByRole('tab', { name: '設定' })).toBeVisible();
    expect(pageErrors).toEqual([]);
  } finally {
    await context.close();
  }
});
