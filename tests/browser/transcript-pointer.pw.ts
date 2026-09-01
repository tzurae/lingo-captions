import { expect, test, type Locator, type Page } from '@playwright/test';

const fixturePath = '/tests/browser/transcript-pointer.html';
const fixtureUrl = 'http://127.0.0.1:4174/tests/browser/transcript-pointer.html';

async function boundaryPoint(cue: Locator, offset: number): Promise<{ x: number; y: number }> {
  return cue.evaluate((element, characterOffset) => {
    const text = element.firstChild;
    if (!(text instanceof Text)) throw new Error('Caption text node is missing');
    if (characterOffset < 0 || characterOffset > text.length) throw new Error('Character offset is outside caption text');

    const range = document.createRange();
    if (characterOffset === text.length) {
      range.setStart(text, Math.max(0, characterOffset - 1));
      range.setEnd(text, characterOffset);
      const rect = range.getBoundingClientRect();
      return { x: rect.right, y: rect.top + rect.height / 2 };
    }
    range.setStart(text, characterOffset);
    range.setEnd(text, Math.min(text.length, characterOffset + 1));
    const rect = range.getBoundingClientRect();
    return { x: rect.left, y: rect.top + rect.height / 2 };
  }, offset);
}

async function dragSelection(
  page: Page,
  fromCue: Locator,
  fromOffset: number,
  toCue: Locator,
  toOffset: number,
): Promise<void> {
  const from = await boundaryPoint(fromCue, fromOffset);
  const to = await boundaryPoint(toCue, toOffset);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.mouse.up();
}

async function selectedText(page: Page): Promise<string | undefined> {
  return page.evaluate(() => window.__transcriptPointerRegression.selections.at(-1)?.selectedText);
}

async function playbackActionCount(page: Page): Promise<number> {
  return page.evaluate(() => window.__transcriptPointerRegression.playbackActions.length);
}

test.beforeEach(async ({ page }) => {
  await page.goto(fixturePath);
  await expect(page.locator('.caption-cue')).toHaveCount(2);
  await page.evaluate(() => window.__transcriptPointerRegression.reset());
});

test('300 plain caption pointer-ups never invoke playback', async ({ page }) => {
  const cue = page.locator('.caption-cue').first();
  const box = await cue.boundingBox();
  if (!box) throw new Error('Caption bounding box is missing');

  for (let index = 0; index < 300; index += 1) {
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  }

  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('a short one-character drag opens selection without playback', async ({ page }) => {
  const cue = page.locator('.caption-cue').first();
  await dragSelection(page, cue, 0, cue, 1);

  await expect.poll(() => selectedText(page)).toBe('I');
  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('a reverse drag opens selection without playback', async ({ page }) => {
  const cue = page.locator('.caption-cue').nth(1);
  await dragSelection(page, cue, 6, cue, 0);

  await expect.poll(() => selectedText(page)).toBe('Second');
  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('a punctuation-only drag opens selection without playback', async ({ page }) => {
  const cue = page.locator('.caption-cue').first();
  await dragSelection(page, cue, 1, cue, 2);

  await expect.poll(() => selectedText(page)).toBe(',');
  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('a drag spanning rendered rows excludes playback controls from selected text', async ({ page }) => {
  const firstCue = page.locator('.caption-cue').first();
  const secondCue = page.locator('.caption-cue').nth(1);
  await dragSelection(page, firstCue, 0, secondCue, 6);

  await expect.poll(() => selectedText(page)).toBe('I, ... Second');
  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('row actions become visible on hover in Google Chrome', async ({ page }) => {
  const row = page.locator('.caption-row').first();
  const actions = row.locator('.caption-row-actions');
  await expect(actions).toHaveCSS('opacity', '0');
  await expect(actions).toHaveCSS('pointer-events', 'none');

  await row.hover();

  await expect(actions).toHaveCSS('opacity', '1');
  await expect(actions).toHaveCSS('pointer-events', 'auto');
});

test('keyboard focus reveals row actions while caption Enter remains inert', async ({ page }) => {
  const row = page.locator('.caption-row').first();
  const actions = row.locator('.caption-row-actions');
  const timestamp = row.locator('.caption-timestamp');
  const caption = row.locator('.caption-cue');

  await page.keyboard.press('Tab');
  await expect(timestamp).toBeFocused();
  await expect(actions).toHaveCSS('opacity', '1');
  await page.keyboard.press('Tab');
  await expect(caption).toBeFocused();
  await page.keyboard.press('Enter');

  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('keyboard Study Sentence opens a learning selection without playback', async ({ page }) => {
  const study = page.getByRole('button', { name: 'Study Sentence: I, ...' });
  await study.focus();
  await page.keyboard.press('Enter');

  await expect.poll(() => selectedText(page)).toBe('I, ...');
  await expect.poll(() => playbackActionCount(page)).toBe(0);
});

test('entering history browsing preserves the learner scroll position', async ({ page }) => {
  await page.goto(`${fixturePath}?count=120`);
  await expect(page.locator('.caption-row')).toHaveCount(120);
  await page.evaluate(() => window.__transcriptPointerRegression.setAutoFollowPlayback(true));
  await expect(page.locator('.transcript-list')).toHaveClass(/transcript-focus-window/);
  const before = await page.locator('.transcript-list').evaluate((list) => {
    list.scrollTop = 1_000;
    return list.scrollTop;
  });

  await page.evaluate(() => window.__transcriptPointerRegression.setAutoFollowPlayback(false));
  await expect(page.locator('.transcript-list')).not.toHaveClass(/transcript-focus-window/);
  const after = await page.locator('.transcript-list').evaluate((list) => list.scrollTop);

  expect(after).toBe(before);
});

test('touch contexts keep row actions visible without hover', async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true,
    isMobile: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await page.goto(fixtureUrl);
  const actions = page.locator('.caption-row-actions').first();

  await expect.poll(() => page.evaluate(() => matchMedia('(hover: none)').matches)).toBe(true);
  await expect(actions).toHaveCSS('opacity', '1');
  await expect(actions).toHaveCSS('pointer-events', 'auto');

  await context.close();
});

test('a one-hour Learning Transcript stays within the non-virtualized render budget', async ({ page }) => {
  await page.goto(`${fixturePath}?count=1200`);
  await expect(page.locator('.caption-row')).toHaveCount(1_200);
  await expect.poll(() => page.evaluate(
    () => window.__transcriptPointerRegression.renderDurationMs,
  )).not.toBeNull();
  const measuredDurationMs = await page.evaluate(
    () => window.__transcriptPointerRegression.renderDurationMs!,
  );

  console.log(`1,200-row Learning Transcript render: ${measuredDurationMs.toFixed(1)}ms`);
  expect(measuredDurationMs).toBeLessThan(1_500);
});
