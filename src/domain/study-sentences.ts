import { splitCaptionText } from './caption-sentences';
import type { StudySentence } from './learning-transcript-session';
import type { CaptionCue } from './types';

type PendingStudySentence = {
  firstSourceCueId: string;
  sourceCueIds: string[];
  startMs: number;
  endMs: number;
  text: string;
};

function appendText(current: string, next: string): string {
  return current === '' ? next : `${current} ${next}`;
}

function comparableText(text: string): string {
  return text.toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

function textAlignmentScore(renderedText: string, sentenceText: string): number {
  const rendered = comparableText(renderedText);
  const sentence = comparableText(sentenceText);
  if (rendered === '' || sentence === '') return 0;
  if (rendered === sentence) return 1_000_000;
  if (sentence.includes(rendered)) return 100_000 + rendered.length;
  if (rendered.includes(sentence)) return 90_000 + sentence.length;
  const sentenceTokens = new Set(sentence.split(' '));
  return rendered.split(' ').filter((token) => sentenceTokens.has(token)).length;
}

export function projectStudySentences(sourceCues: CaptionCue[]): StudySentence[] {
  const sentences: StudySentence[] = [];
  const sentenceCountsByFirstCue = new Map<string, number>();
  let pending: PendingStudySentence | null = null;

  function emitPending(): void {
    if (!pending) return;
    const ordinal = sentenceCountsByFirstCue.get(pending.firstSourceCueId) ?? 0;
    sentenceCountsByFirstCue.set(pending.firstSourceCueId, ordinal + 1);
    sentences.push({
      id: `study:${pending.firstSourceCueId}:${ordinal}`,
      sourceCueIds: [...pending.sourceCueIds],
      startMs: Math.max(0, pending.startMs),
      endMs: Math.max(pending.startMs + 1, pending.endMs),
      text: pending.text,
    });
    pending = null;
  }

  for (const cue of [...sourceCues].sort((left, right) => left.startMs - right.startMs)) {
    const segments = splitCaptionText(cue.text);
    for (const segment of segments) {
      if (!pending) {
        pending = {
          firstSourceCueId: cue.id,
          sourceCueIds: [cue.id],
          startMs: cue.startMs,
          endMs: cue.endMs,
          text: segment.text,
        };
      } else {
        if (!pending.sourceCueIds.includes(cue.id)) pending.sourceCueIds.push(cue.id);
        pending.endMs = cue.endMs;
        pending.text = appendText(pending.text, segment.text);
      }
      if (segment.complete) emitPending();
    }
  }
  emitPending();
  return sentences;
}

export type ContinuousViewingStudyRows = {
  rows: CaptionCue[];
  studySentenceIndexByProjectedId: Record<string, number>;
  rowIdsByProjectedId: Record<string, string[]>;
};

export function projectContinuousViewingStudyRows({
  projectedCues,
  sourceCues,
  sourceCueIndexByProjectedId,
  studySentences,
}: {
  projectedCues: CaptionCue[];
  sourceCues: CaptionCue[];
  sourceCueIndexByProjectedId: Record<string, number>;
  studySentences: StudySentence[];
}): ContinuousViewingStudyRows {
  const studySentenceIndexesBySourceCueId = new Map<string, number[]>();
  for (const [index, sentence] of studySentences.entries()) {
    for (const sourceCueId of sentence.sourceCueIds) {
      const indexes = studySentenceIndexesBySourceCueId.get(sourceCueId) ?? [];
      indexes.push(index);
      studySentenceIndexesBySourceCueId.set(sourceCueId, indexes);
    }
  }

  const rows: CaptionCue[] = [];
  const studySentenceIndexByProjectedId: Record<string, number> = {};
  const rowIdsByProjectedId: Record<string, string[]> = {};
  const emittedStudySentenceIds = new Set<string>();
  const representedRowIdByStudySentenceId = new Map<string, string>();
  for (const projectedCue of projectedCues) {
    const sourceCue = sourceCues[sourceCueIndexByProjectedId[projectedCue.id]];
    const candidateIndexes = sourceCue
      ? studySentenceIndexesBySourceCueId.get(sourceCue.id) ?? []
      : [];
    const isUnrefinedSourceCue = sourceCue
      && projectedCue.id === sourceCue.id
      && projectedCue.text === sourceCue.text
      && projectedCue.startMs === sourceCue.startMs
      && projectedCue.endMs === sourceCue.endMs;
    if (isUnrefinedSourceCue) {
      const rowIds: string[] = [];
      for (const sentenceIndex of candidateIndexes) {
        const sentence = studySentences[sentenceIndex];
        const representedRowId = representedRowIdByStudySentenceId.get(sentence.id);
        rowIds.push(representedRowId ?? sentence.id);
        studySentenceIndexByProjectedId[sentence.id] = sentenceIndex;
        if (emittedStudySentenceIds.has(sentence.id)) continue;
        if (sourceCue.id !== sentence.sourceCueIds.at(-1)) continue;
        emittedStudySentenceIds.add(sentence.id);
        representedRowIdByStudySentenceId.set(sentence.id, sentence.id);
        rows.push(sentence);
      }
      rowIdsByProjectedId[projectedCue.id] = rowIds;
      continue;
    }

    const sentenceIndex = candidateIndexes.reduce<number | undefined>((bestIndex, index) => {
      const sentence = studySentences[index];
      if (bestIndex === undefined) return index;
      const best = studySentences[bestIndex];
      const alignmentScore = textAlignmentScore(projectedCue.text, sentence.text);
      const bestAlignmentScore = textAlignmentScore(projectedCue.text, best.text);
      if (alignmentScore !== bestAlignmentScore) {
        return alignmentScore > bestAlignmentScore ? index : bestIndex;
      }
      const overlap = Math.max(
        0,
        Math.min(projectedCue.endMs, sentence.endMs) - Math.max(projectedCue.startMs, sentence.startMs),
      );
      const bestOverlap = Math.max(
        0,
        Math.min(projectedCue.endMs, best.endMs) - Math.max(projectedCue.startMs, best.startMs),
      );
      return overlap > bestOverlap ? index : bestIndex;
    }, undefined);
    if (sentenceIndex === undefined) {
      rows.push(projectedCue);
      rowIdsByProjectedId[projectedCue.id] = [projectedCue.id];
      continue;
    }

    const sentence = studySentences[sentenceIndex];
    const representedRowId = representedRowIdByStudySentenceId.get(sentence.id);
    const rowId = representedRowId ?? sentence.id;
    rowIdsByProjectedId[projectedCue.id] = [rowId];
    studySentenceIndexByProjectedId[projectedCue.id] = sentenceIndex;
    studySentenceIndexByProjectedId[rowId] = sentenceIndex;
    if (representedRowId) {
      const representedRowIndex = rows.findIndex((row) => row.id === representedRowId);
      if (representedRowIndex >= 0) {
        rows[representedRowIndex] = { ...projectedCue, id: representedRowId };
      }
      continue;
    }
    emittedStudySentenceIds.add(sentence.id);
    representedRowIdByStudySentenceId.set(sentence.id, rowId);
    rows.push({ ...projectedCue, id: rowId });
  }

  return { rows, studySentenceIndexByProjectedId, rowIdsByProjectedId };
}
