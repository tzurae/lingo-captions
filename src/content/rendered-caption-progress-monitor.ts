import type { CaptionCue, RenderedCaptionProgress } from '../domain/types';
import { readRenderedCaptionText } from './rendered-caption-text';

type RenderedCaptionProgressMonitorOptions = {
  document: Document;
  getCurrentTimeMs: () => number;
  onProgressChanged: (progress: RenderedCaptionProgress) => void;
};

export type RenderedCaptionProgressMonitor = {
  start(): boolean;
  stop(): void;
  captureNow(): boolean;
};

function comparableText(text: string): string {
  return text.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function continuesProgress(previous: string, next: string): boolean {
  const comparablePrevious = comparableText(previous);
  const comparableNext = comparableText(next);
  return comparablePrevious.length > 0
    && comparableNext.length > 0
    && (comparableNext.includes(comparablePrevious) || comparablePrevious.includes(comparableNext));
}

export function createRenderedCaptionProgressMonitor(
  options: RenderedCaptionProgressMonitorOptions,
): RenderedCaptionProgressMonitor {
  let lastText = '';
  let groupStartMs: number | undefined;
  let cues: CaptionCue[] = [];
  let nextCueId = 0;
  let observer: MutationObserver | null = null;

  function captureNow(): boolean {
    const text = readRenderedCaptionText(options.document);
    if (text === lastText) return false;
    const captureTimeMs = Math.max(0, Math.round(options.getCurrentTimeMs()));
    if (!text) {
      lastText = '';
      groupStartMs = undefined;
      cues = [];
      options.onProgressChanged({ capturedAtMs: captureTimeMs, cues: [] });
      return true;
    }
    if (groupStartMs === undefined || !continuesProgress(lastText, text)) {
      groupStartMs = captureTimeMs;
      cues = [];
    }
    const existing = cues[0];
    cues = [existing
      ? { ...existing, text, endMs: Math.max(existing.endMs, captureTimeMs + 1) }
      : { id: `progress-${nextCueId++}`, startMs: groupStartMs!, endMs: captureTimeMs + 1, text }];
    lastText = text;
    options.onProgressChanged({
      capturedAtMs: captureTimeMs,
      cues: cues.map((cue) => ({ ...cue })),
      activeGroup: { cueIds: cues.map((cue) => cue.id), startMs: groupStartMs },
    });
    return true;
  }

  return {
    start() {
      if (observer) return false;
      observer = new MutationObserver(() => captureNow());
      const root = options.document.querySelector('.ytp-caption-window-container')
        ?? options.document.querySelector('#movie_player')
        ?? options.document.body;
      observer.observe(root, { childList: true, characterData: true, subtree: true });
      return captureNow();
    },
    stop() {
      observer?.disconnect();
      observer = null;
    },
    captureNow,
  };
}
