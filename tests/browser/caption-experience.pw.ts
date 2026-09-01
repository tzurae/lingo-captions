import { expect, test, type Page } from '@playwright/test';
import type { CapturedCommand } from './caption-experience.fixture';

let pageErrors: string[] = [];

async function selectCurrentSentence(page: Page): Promise<void> {
  await page.evaluate(() => {
    const cue = Array.from(document.querySelectorAll<HTMLElement>('.caption-cue'))
      .find((candidate) => candidate.textContent?.includes('Current sentence'));
    const text = cue?.firstChild;
    if (!cue || !(text instanceof Text)) throw new Error('Current sentence text is missing');
    const range = document.createRange();
    range.setStart(text, 0);
    range.setEnd(text, 'Current sentence'.length);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    cue.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
}

async function capturedCommands(page: Page): Promise<CapturedCommand[]> {
  return page.evaluate(() => [...window.__captionExperience.commands]);
}

test.beforeEach(async ({ page }) => {
  pageErrors = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') pageErrors.push(message.text());
  });
  await page.goto('/tests/browser/caption-experience.html');
  await expect(page.getByRole('main')).toBeVisible();
  await page.evaluate(() => window.__captionExperience.load());
  await expect(page.locator('[data-caption-state="ready"]')).toBeVisible();
});

test.afterEach(() => {
  expect(pageErrors).toEqual([]);
});

test('Caption Track, rendered progress, playback, and seek share Continuous Viewing state', async ({ page }) => {
  await expect(page.getByRole('tablist', { name: 'Side panel tabs' })).toBeVisible();
  await expect(page.getByRole('tab', { selected: true })).toHaveCount(1);
  await expect(page.getByRole('region', { name: 'Transcript' })).toBeVisible();
  await expect(page.locator('.caption-cue[tabindex="0"]')).toHaveCount(5);
  await expect(page.locator('.caption-row')).toHaveCount(5);
  await expect(page.locator('.caption-cue[aria-current="true"]')).toHaveText('Current sentence continues.');

  await page.evaluate(() => window.__captionExperience.refineRenderedProgress('Current sentence'));
  await expect(page.locator('.caption-cue[aria-current="true"]')).toHaveText('Current sentence');

  await page.evaluate(() => window.__captionExperience.emitPlayback(4_500));
  await expect(page.locator('.caption-cue[aria-current="true"]')).toHaveText('Next sentence.');
  await expect(page.locator('.transcript-list')).toHaveClass(/transcript-focus-window/);
});

test('selection keeps one Focused Study target through pending AI and Resume', async ({ page }) => {
  await page.evaluate(() => window.__captionExperience.clearCommands());
  await selectCurrentSentence(page);

  await expect(page.getByRole('region', { name: 'Focused Study controls' })).toBeVisible();
  await expect.poll(() => capturedCommands(page)).toContainEqual(expect.objectContaining({ type: 'PAUSE_PLAYBACK' }));
  await page.getByRole('button', { name: '翻譯整句' }).click();
  await expect(page.getByRole('status').filter({ hasText: '正在取得回答' })).toBeVisible();

  await page.evaluate(() => {
    window.__captionExperience.emitPlayback(4_500);
    window.__captionExperience.refineRenderedProgress('Next');
  });
  await expect(page.locator('[data-study-sentence="true"]')).toContainText('Current sentence continues.');
  await expect(page.getByRole('dialog', { name: 'English learning assistant' })).toBeVisible();

  await page.evaluate(() => window.__captionExperience.resolveQuery());
  await expect(page.getByText('Integrated answer')).toBeVisible();
  await page.getByRole('button', { name: 'Resume' }).click();
  await expect.poll(() => capturedCommands(page)).toContainEqual(expect.objectContaining({ type: 'RESUME_PLAYBACK' }));
  await expect(page.getByRole('region', { name: 'Focused Study controls' })).toHaveCount(0);
});

test('keyboard completes Study, Jump, Replay, AI, and Return to Current', async ({ page }) => {
  await page.evaluate(() => window.__captionExperience.clearCommands());
  const sentence = 'Current sentence continues.';

  await page.getByRole('button', { name: `Study Sentence: ${sentence}` }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => capturedCommands(page)).toContainEqual(expect.objectContaining({ type: 'PAUSE_PLAYBACK' }));

  await page.getByRole('button', { name: `Jump to Here: ${sentence}` }).focus();
  await page.keyboard.press('Enter');
  await page.getByRole('button', { name: `Replay: ${sentence}` }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => capturedCommands(page)).toEqual(expect.arrayContaining([
    expect.objectContaining({ type: 'JUMP_TO_HERE', timeMs: 2_000 }),
    expect.objectContaining({ type: 'REPLAY_RANGE', startMs: 2_000, endMs: 4_000 }),
  ]));

  await page.getByRole('button', { name: '翻譯整句' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('status').filter({ hasText: '正在取得回答' })).toBeVisible();
  await page.evaluate(() => window.__captionExperience.resolveQuery());
  await expect(page.getByText('Integrated answer')).toBeVisible();

  await page.getByRole('button', { name: 'Return to Current' }).focus();
  await page.keyboard.press('Enter');
  await expect.poll(() => capturedCommands(page)).toContainEqual(expect.objectContaining({ type: 'PAUSE_PLAYBACK' }));
  await expect(page.getByRole('region', { name: 'Focused Study controls' })).toHaveCount(0);
});
