import type { CaptionCue, CaptionTrack, RenderedCaptionProgress } from './types';

export type ProgressAlignmentFailure = {
  reason: 'empty-progress' | 'stale-progress' | 'text-mismatch';
  currentText: string;
  renderedText: string;
};

export type LearningTranscriptExperience = {
  fullTranscript: CaptionCue[];
  visibleCues: CaptionCue[];
  currentSourceCueIds: string[];
  currentCueIds: string[];
  sourceCueIndexByVisibleId: Record<string, number>;
  alignmentFailure?: ProgressAlignmentFailure;
};

type CaptionToken = {
  raw: string;
  normalized: string;
};

function captionTokens(text: string): CaptionToken[] {
  return (text.match(/\S+/g) ?? [])
    .map((raw) => ({
      raw,
      normalized: raw.toLocaleLowerCase().replace(/[^\p{L}\p{N}']+/gu, ''),
    }))
    .filter((token) => token.normalized.length > 0);
}

function findTokenSequence(source: string[], rendered: string[]): number {
  if (rendered.length === 0 || rendered.length > source.length) return -1;
  for (let start = 0; start <= source.length - rendered.length; start += 1) {
    if (rendered.every((token, offset) => token === source[start + offset])) return start;
  }
  return -1;
}

function sourceCueIndices(cues: CaptionCue[]): Record<string, number> {
  return Object.fromEntries(cues.map((cue, index) => [cue.id, index]));
}

function currentNeighborhood(
  cues: CaptionCue[],
  currentCueIds: string[],
  playbackMs: number | null,
): CaptionCue[] {
  if (cues.length <= 3) return cues;
  const currentIdSet = new Set(currentCueIds);
  const currentIndices = cues.flatMap((cue, index) => currentIdSet.has(cue.id) ? [index] : []);
  if (currentIndices.length > 0) {
    const firstCurrent = currentIndices[0];
    const lastCurrent = currentIndices.at(-1)!;
    return cues.slice(Math.max(0, firstCurrent - 1), Math.min(cues.length, lastCurrent + 2));
  }
  if (playbackMs === null) return cues.slice(0, 3);

  const nextIndex = cues.findIndex((cue) => cue.startMs > playbackMs);
  if (nextIndex < 0) return cues.slice(-3);
  const start = Math.max(0, nextIndex - 1);
  const boundedStart = Math.min(start, cues.length - 3);
  return cues.slice(boundedStart, boundedStart + 3);
}

function baseExperience(
  cues: CaptionCue[],
  currentCueIds: string[],
  playbackMs: number | null,
  alignmentFailure?: ProgressAlignmentFailure,
): LearningTranscriptExperience {
  const visibleCues = currentNeighborhood(cues, currentCueIds, playbackMs);
  const sourceIndices = sourceCueIndices(cues);
  return {
    fullTranscript: cues,
    visibleCues,
    currentSourceCueIds: currentCueIds,
    currentCueIds,
    sourceCueIndexByVisibleId: Object.fromEntries(
      visibleCues.map((cue) => [cue.id, sourceIndices[cue.id]]),
    ),
    ...(alignmentFailure ? { alignmentFailure } : {}),
  };
}

function alignRenderedProgress(
  currentSourceCues: CaptionCue[],
  renderedCues: CaptionCue[],
): Map<string, string> | null {
  const sourceTokensByCue = currentSourceCues.map((cue) => captionTokens(cue.text));
  const sourceTokens = sourceTokensByCue.flatMap((tokens) => tokens.map((token) => token.normalized));
  const renderedTokens = captionTokens(renderedCues.map((cue) => cue.text).join(' '));
  const renderedStart = findTokenSequence(sourceTokens, renderedTokens.map((token) => token.normalized));
  if (renderedStart < 0) return null;
  const renderedEnd = renderedStart + renderedTokens.length;

  const refinements = new Map<string, string>();
  let sourceStart = 0;
  for (const [index, cue] of currentSourceCues.entries()) {
    const sourceEnd = sourceStart + sourceTokensByCue[index].length;
    const overlapStart = Math.max(sourceStart, renderedStart);
    const overlapEnd = Math.min(sourceEnd, renderedEnd);
    if (overlapStart >= overlapEnd) return null;
    const renderedOffset = overlapStart - renderedStart;
    const text = renderedTokens
      .slice(renderedOffset, renderedOffset + overlapEnd - overlapStart)
      .map((token) => token.raw)
      .join(' ');
    refinements.set(cue.id, text);
    sourceStart = sourceEnd;
  }
  return refinements;
}

export function projectLearningTranscriptExperience({
  track,
  playbackMs,
  renderedProgress,
}: {
  track: CaptionTrack | null;
  playbackMs: number | null;
  renderedProgress: RenderedCaptionProgress | null;
}): LearningTranscriptExperience {
  if (!track) return baseExperience([], [], playbackMs);

  if (track.source === 'visible-dom') {
    return baseExperience(track.cues, track.activeGroup?.cueIds ?? [], playbackMs);
  }
  if (playbackMs === null) return baseExperience(track.cues, [], playbackMs);

  const currentSourceCues = track.cues.filter(
    (cue) => cue.startMs <= playbackMs && playbackMs < cue.endMs,
  );
  const currentSourceCueIds = currentSourceCues.map((cue) => cue.id);
  if (!renderedProgress?.activeGroup || currentSourceCues.length === 0) {
    return baseExperience(track.cues, currentSourceCueIds, playbackMs);
  }

  const renderedById = new Map(renderedProgress.cues.map((cue) => [cue.id, cue]));
  const renderedCues = renderedProgress.activeGroup.cueIds
    .map((id) => renderedById.get(id))
    .filter((cue): cue is CaptionCue => cue !== undefined);
  const currentText = currentSourceCues.map((cue) => cue.text).join(' ');
  const renderedText = renderedCues.map((cue) => cue.text).join(' ');
  if (renderedCues.length === 0) {
    return baseExperience(track.cues, currentSourceCueIds, playbackMs, {
      reason: 'empty-progress',
      currentText,
      renderedText,
    });
  }

  const capturedWithinCurrent = currentSourceCues.some(
    (cue) => cue.startMs <= renderedProgress.capturedAtMs && renderedProgress.capturedAtMs < cue.endMs,
  );
  if (!capturedWithinCurrent) {
    return baseExperience(track.cues, currentSourceCueIds, playbackMs, {
      reason: 'stale-progress',
      currentText,
      renderedText,
    });
  }

  const refinements = alignRenderedProgress(currentSourceCues, renderedCues);
  if (!refinements) {
    return baseExperience(track.cues, currentSourceCueIds, playbackMs, {
      reason: 'text-mismatch',
      currentText,
      renderedText,
    });
  }

  const projectedTranscript = track.cues.map((cue) => {
    const text = refinements.get(cue.id);
    return text === undefined ? cue : { ...cue, text };
  });
  const visibleCues = currentNeighborhood(projectedTranscript, currentSourceCueIds, playbackMs);
  const sourceIndices = sourceCueIndices(track.cues);
  return {
    fullTranscript: track.cues,
    visibleCues,
    currentSourceCueIds,
    currentCueIds: currentSourceCueIds,
    sourceCueIndexByVisibleId: Object.fromEntries(
      visibleCues.map((cue) => [cue.id, sourceIndices[cue.id]]),
    ),
  };
}
