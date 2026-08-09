import { describe, expect, it } from 'vitest';
import { buildQueryContext } from './context-builder';
import type { CaptionCue } from './types';

const cues: CaptionCue[] = [
  { id: 'cue-0', startMs: 0, endMs: 1000, text: 'First sentence.' },
  { id: 'cue-1', startMs: 1000, endMs: 2000, text: 'Second sentence.' },
  { id: 'cue-2', startMs: 2000, endMs: 3000, text: 'Third sentence.' },
  { id: 'cue-3', startMs: 3000, endMs: 4000, text: 'Fourth sentence.' },
];

describe('buildQueryContext', () => {
  it('preserves selected text exactly and selects the requested sentence', () => {
    expect(
      buildQueryContext({
        selectedText: '  selected\ntext  ',
        cueIndex: 2,
        cues,
        contextLines: 0,
      }),
    ).toEqual({
      selectedText: '  selected\ntext  ',
      sentence: 'Third sentence.',
      contextBefore: [],
      contextAfter: [],
    });
  });

  it('includes preceding cues oldest to newest and following cues nearest to farthest', () => {
    expect(
      buildQueryContext({
        selectedText: 'third',
        cueIndex: 2,
        cues,
        contextLines: 2,
      }),
    ).toEqual({
      selectedText: 'third',
      sentence: 'Third sentence.',
      contextBefore: ['First sentence.', 'Second sentence.'],
      contextAfter: ['Fourth sentence.'],
    });
  });

  it('clips context cleanly at the start and end of the cue list', () => {
    expect(
      buildQueryContext({
        selectedText: 'first',
        cueIndex: 0,
        cues,
        contextLines: 3,
      }),
    ).toEqual({
      selectedText: 'first',
      sentence: 'First sentence.',
      contextBefore: [],
      contextAfter: ['Second sentence.', 'Third sentence.', 'Fourth sentence.'],
    });

    expect(
      buildQueryContext({
        selectedText: 'fourth',
        cueIndex: 3,
        cues,
        contextLines: 3,
      }),
    ).toEqual({
      selectedText: 'fourth',
      sentence: 'Fourth sentence.',
      contextBefore: ['First sentence.', 'Second sentence.', 'Third sentence.'],
      contextAfter: [],
    });
  });

  it('rejects selected text that is empty after trimming', () => {
    expect(() =>
      buildQueryContext({
        selectedText: ' \n\t',
        cueIndex: 0,
        cues,
        contextLines: 1,
      }),
    ).toThrow('Selected text cannot be empty');
  });

  it('rejects a cue index outside the cue list', () => {
    expect(() =>
      buildQueryContext({
        selectedText: 'selected',
        cueIndex: cues.length,
        cues,
        contextLines: 1,
      }),
    ).toThrow('Caption cue index is out of range');
  });

  it('rejects a fractional cue index', () => {
    expect(() =>
      buildQueryContext({
        selectedText: 'selected',
        cueIndex: 1.5,
        cues,
        contextLines: 1,
      }),
    ).toThrow('Caption cue index is out of range');
  });

  it('rejects a NaN cue index', () => {
    expect(() =>
      buildQueryContext({
        selectedText: 'selected',
        cueIndex: Number.NaN,
        cues,
        contextLines: 1,
      }),
    ).toThrow('Caption cue index is out of range');
  });

  it('rejects an infinite cue index', () => {
    expect(() =>
      buildQueryContext({
        selectedText: 'selected',
        cueIndex: Number.POSITIVE_INFINITY,
        cues,
        contextLines: 1,
      }),
    ).toThrow('Caption cue index is out of range');
  });

  it('rejects negative context lines', () => {
    expect(() =>
      buildQueryContext({
        selectedText: 'selected',
        cueIndex: 0,
        cues,
        contextLines: -1,
      }),
    ).toThrow('Context lines cannot be negative');
  });
});
