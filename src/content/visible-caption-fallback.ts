import type { ActiveCaptionGroup, CaptionCue } from '../domain/types';
import { splitCaptionText, type CaptionSentence } from '../domain/caption-sentences';
import { readRenderedCaptionText } from './rendered-caption-text';

export type VisibleCaptionSnapshot = {
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

type VisibleCaptionFallbackOptions = {
  document: Document;
  getCurrentTimeMs: () => number;
  onSnapshotChanged: (snapshot: VisibleCaptionSnapshot) => void;
};

const emissionDelayMs = 350;
const maximumCueDurationMs = 12_000;

export type VisibleCaptionFallback = {
  start(): void;
  stop(): void;
  captureNow(): boolean;
};

type CueGroup = {
  text: string;
  complete: boolean;
  cues: CaptionCue[];
};

function comparableText(text: string): string {
  return text.toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasTextContinuity(previous: string, next: string): boolean {
  const left = comparableText(previous);
  const right = comparableText(next);
  if (!left || !right) return false;
  if (left.includes(right) || right.includes(left)) return true;
  const leftWords = left.split(' ');
  const rightWords = right.split(' ');
  const maximum = Math.min(leftWords.length, rightWords.length);
  for (let size = maximum; size >= 1; size -= 1) {
    if (leftWords.slice(-size).join(' ') === rightWords.slice(0, size).join(' ')) return true;
  }
  return false;
}

function mergeByWordOverlap(existingText: string, snapshotText: string): string | null {
  if (snapshotText.startsWith(existingText)) return snapshotText;
  if (existingText.includes(snapshotText)) return existingText;

  const existingWords = existingText.split(' ');
  const snapshotWords = snapshotText.split(' ');
  const maximumOverlap = Math.min(existingWords.length, snapshotWords.length);
  for (let length = maximumOverlap; length >= 1; length -= 1) {
    const existingSuffix = existingWords.slice(-length).join(' ');
    const snapshotPrefix = snapshotWords.slice(0, length).join(' ');
    if (existingSuffix === snapshotPrefix) {
      return [...existingWords, ...snapshotWords.slice(length)].join(' ');
    }
  }

  return null;
}

export function createVisibleCaptionFallback(options: VisibleCaptionFallbackOptions): VisibleCaptionFallback {
  const cueGroups: CueGroup[] = [];
  let lastSnapshot = '';
  let mergedTranscript = '';
  let activeBlock: { text: string; startMs: number } | undefined;
  let requiresFreshActiveCues = false;
  let pendingSnapshot: VisibleCaptionSnapshot | undefined;
  let nextCueId = 0;
  let observer: MutationObserver | null = null;
  let emissionTimer: number | null = null;

  function getCues(): CaptionCue[] {
    return cueGroups.flatMap((group) => group.cues);
  }

  function createCue(text: string, startMs: number): CaptionCue {
    const cue = { id: `visible-${nextCueId}`, startMs, endMs: startMs + 4_000, text };
    nextCueId += 1;
    return cue;
  }

  function updateGroup(group: CueGroup, segment: CaptionSentence, captureTimeMs: number): void {
    const latestCue = group.cues.at(-1)!;
    const hasNewText = segment.text !== group.text;
    const shouldForceTimeBoundary = !group.complete
      && hasNewText
      && segment.text.startsWith(group.text)
      && captureTimeMs - latestCue.startMs >= maximumCueDurationMs;

    if (shouldForceTimeBoundary) {
      const newText = segment.text.slice(group.text.length).trim();
      if (newText) {
        latestCue.endMs = captureTimeMs;
        group.cues.push(createCue(newText, captureTimeMs));
      }
    } else if (group.cues.length === 1) {
      latestCue.text = segment.text;
      latestCue.endMs = Math.max(latestCue.endMs, captureTimeMs + 4_000);
    } else {
      const priorText = group.cues.slice(0, -1).map((cue) => cue.text).join(' ');
      latestCue.text = segment.text.startsWith(priorText)
        ? segment.text.slice(priorText.length).trim()
        : segment.text;
      latestCue.endMs = Math.max(latestCue.endMs, captureTimeMs + 4_000);
    }

    group.text = segment.text;
    group.complete = segment.complete;
  }

  function reconcileSegments(
    segments: CaptionSentence[],
    groupStartMs: number,
    captureTimeMs: number,
  ): void {
    for (const [index, segment] of segments.entries()) {
      const existingGroup = cueGroups[index];
      if (existingGroup) {
        updateGroup(existingGroup, segment, captureTimeMs);
        continue;
      }

      const priorCue = getCues().at(-1);
      if (priorCue && groupStartMs > priorCue.startMs) {
        priorCue.endMs = Math.max(priorCue.startMs + 1, groupStartMs);
      }
      cueGroups.push({ text: segment.text, complete: segment.complete, cues: [createCue(segment.text, groupStartMs)] });
    }
  }

  function appendActiveCue(segment: CaptionSentence, groupStartMs: number): string {
    const cue = createCue(segment.text, groupStartMs);
    cueGroups.push({ text: segment.text, complete: segment.complete, cues: [cue] });
    return cue.id;
  }

  function appendActiveCues(segments: CaptionSentence[], groupStartMs: number): string[] {
    return segments.map((segment) => appendActiveCue(segment, groupStartMs));
  }

  function activeCueIdsFor(
    segments: CaptionSentence[],
    groupStartMs: number,
    requiresFreshActiveCues = false,
  ): string[] {
    const used = new Set<string>();
    const ids: string[] = [];
    for (const segment of segments) {
      const cueText = comparableText(segment.text);
      const exactMatch = [...getCues()].reverse().find((cue) => {
        if (used.has(cue.id) || (requiresFreshActiveCues && cue.startMs !== groupStartMs)) return false;
        return comparableText(cue.text) === cueText;
      });
      const match = exactMatch ?? [...getCues()].reverse().find((cue) => {
        if (used.has(cue.id) || cue.startMs !== groupStartMs) return false;
        const candidateText = comparableText(cue.text);
        return candidateText.includes(cueText) || cueText.includes(candidateText);
      });
      if (!match) {
        if (requiresFreshActiveCues) {
          const id = appendActiveCue(segment, groupStartMs);
          used.add(id);
          ids.push(id);
          continue;
        }
        return appendActiveCues(segments, groupStartMs);
      }
      used.add(match.id);
      ids.push(match.id);
    }

    const cueOrder = new Map(getCues().map((cue, index) => [cue.id, index]));
    const orderedIds = ids.sort((left, right) => cueOrder.get(left)! - cueOrder.get(right)!);
    const indices = orderedIds.map((id) => cueOrder.get(id)!);
    const contiguous = indices.every((index, position) => (
      position === 0 || index === indices[position - 1] + 1
    ));
    return contiguous ? orderedIds : appendActiveCues(segments, groupStartMs);
  }

  function scheduleEmission(activeGroup?: ActiveCaptionGroup): void {
    pendingSnapshot = {
      cues: getCues().map((cue) => ({ ...cue })),
      ...(activeGroup ? { activeGroup: { ...activeGroup, cueIds: [...activeGroup.cueIds] } } : {}),
    };
    if (emissionTimer !== null) window.clearTimeout(emissionTimer);
    emissionTimer = window.setTimeout(() => {
      emissionTimer = null;
      const snapshot = pendingSnapshot;
      pendingSnapshot = undefined;
      if (snapshot) options.onSnapshotChanged(snapshot);
    }, emissionDelayMs);
  }

  function captureNow(): boolean {
    const text = readRenderedCaptionText(options.document);
    if (!text) {
      if (!lastSnapshot && !activeBlock) return false;
      lastSnapshot = '';
      activeBlock = undefined;
      requiresFreshActiveCues = true;
      scheduleEmission();
      return true;
    }
    if (text === lastSnapshot) return false;

    const captureTimeMs = Math.max(0, Math.round(options.getCurrentTimeMs()));
    if (!activeBlock || !hasTextContinuity(activeBlock.text, text)) {
      activeBlock = { text, startMs: captureTimeMs };
    } else {
      activeBlock.text = text;
    }

    const nextTranscript = !mergedTranscript
      ? text
      : mergeByWordOverlap(mergedTranscript, text) ?? `${mergedTranscript} ${text}`;
    if (nextTranscript !== mergedTranscript) {
      mergedTranscript = nextTranscript;
      reconcileSegments(splitCaptionText(mergedTranscript), activeBlock.startMs, captureTimeMs);
    }

    const visibleSegments = splitCaptionText(text);
    const cueIds = activeCueIdsFor(visibleSegments, activeBlock.startMs, requiresFreshActiveCues);
    requiresFreshActiveCues = false;
    lastSnapshot = text;
    scheduleEmission({ cueIds, startMs: activeBlock.startMs });
    return true;
  }

  return {
    start() {
      if (observer) return;
      observer = new MutationObserver(() => captureNow());
      observer.observe(options.document.body, { childList: true, characterData: true, subtree: true });
      captureNow();
    },
    stop() {
      observer?.disconnect();
      observer = null;
      if (emissionTimer !== null) {
        window.clearTimeout(emissionTimer);
        emissionTimer = null;
      }
    },
    captureNow,
  };
}
