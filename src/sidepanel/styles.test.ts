// @ts-expect-error The app typecheck intentionally excludes Node declarations used by this test fixture.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('selection assistant styles', () => {
  it('keeps oversized assistant content accessible inside its viewport-bounded container', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/sidepanel/styles.css', 'utf8');
    document.head.append(style);

    const assistant = document.createElement('section');
    assistant.className = 'selection-assistant';
    document.body.append(assistant);

    try {
      expect(getComputedStyle(assistant).overflow).toBe('auto');
      expect(getComputedStyle(assistant).overscrollBehavior).toBe('contain');
    } finally {
      assistant.remove();
      style.remove();
    }
  });

  it('centers the focus region and visually separates past, current, and future cues', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/sidepanel/styles.css', 'utf8');
    document.head.append(style);

    const focusWindow = document.createElement('section');
    focusWindow.className = 'transcript-list transcript-focus-window';
    const pastRegion = document.createElement('div');
    pastRegion.className = 'focus-region focus-past';
    const currentRegion = document.createElement('div');
    currentRegion.className = 'focus-region focus-current';
    const futureRegion = document.createElement('div');
    futureRegion.className = 'focus-region focus-future';
    const pastCue = document.createElement('p');
    pastCue.className = 'caption-cue';
    pastCue.dataset.cueState = 'past';
    const currentCue = document.createElement('p');
    currentCue.className = 'caption-cue';
    currentCue.dataset.cueState = 'current';
    const futureCue = document.createElement('p');
    futureCue.className = 'caption-cue';
    futureCue.dataset.cueState = 'future';
    pastRegion.append(pastCue);
    currentRegion.append(currentCue);
    futureRegion.append(futureCue);
    focusWindow.append(pastRegion, currentRegion, futureRegion);
    document.body.append(focusWindow);

    try {
      expect(getComputedStyle(focusWindow).display).toBe('grid');
      expect(getComputedStyle(pastRegion).gridRowStart).toBe('1');
      expect(getComputedStyle(currentRegion).gridRowStart).toBe('2');
      expect(getComputedStyle(futureRegion).gridRowStart).toBe('3');
      expect(getComputedStyle(pastCue).opacity).toBe('0.4');
      expect(getComputedStyle(currentCue).opacity).toBe('1');
      expect(getComputedStyle(futureCue).opacity).toBe('0.65');
    } finally {
      focusWindow.remove();
      style.remove();
    }
  });

  it('lets the focused transcript use only the viewport space left below the toolbar', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/sidepanel/styles.css', 'utf8');
    document.head.append(style);

    const app = document.createElement('main');
    app.className = 'sidepanel-app';
    const tabs = document.createElement('nav');
    const transcriptView = document.createElement('section');
    transcriptView.className = 'tab-content transcript-view';
    const actions = document.createElement('div');
    actions.className = 'transcript-actions';
    const focusWindow = document.createElement('section');
    focusWindow.className = 'transcript-list transcript-focus-window';
    transcriptView.append(actions, focusWindow);
    app.append(tabs, transcriptView);
    document.body.append(app);

    try {
      expect(getComputedStyle(app).display).toBe('grid');
      expect(getComputedStyle(app).gridTemplateRows).toContain('minmax(0, 1fr)');
      expect(getComputedStyle(transcriptView).display).toBe('flex');
      expect(getComputedStyle(transcriptView).overflow).toBe('hidden');
      expect(getComputedStyle(focusWindow).flexGrow).toBe('1');
      expect(getComputedStyle(focusWindow).minHeight).toBe('0');
      expect(getComputedStyle(focusWindow).overflow).toBe('auto');
    } finally {
      app.remove();
      style.remove();
    }
  });

  it('keeps the complete transcript scrollable when automatic following is disabled', () => {
    const style = document.createElement('style');
    style.textContent = readFileSync('src/sidepanel/styles.css', 'utf8');
    document.head.append(style);

    const transcriptView = document.createElement('section');
    transcriptView.className = 'tab-content transcript-view';
    const fullTranscript = document.createElement('section');
    fullTranscript.className = 'transcript-list';
    transcriptView.append(fullTranscript);
    document.body.append(transcriptView);

    try {
      expect(getComputedStyle(fullTranscript).flexGrow).toBe('1');
      expect(getComputedStyle(fullTranscript).minHeight).toBe('0');
      expect(getComputedStyle(fullTranscript).overflow).toBe('auto');
    } finally {
      transcriptView.remove();
      style.remove();
    }
  });
});
