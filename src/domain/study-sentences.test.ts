import { describe, expect, it } from 'vitest';
import { projectContinuousViewingStudyRows, projectStudySentences } from './study-sentences';

describe('Study Sentence projection', () => {
  it('shapes Source Cue fragments and multi-sentence cues into stable Study Sentences', () => {
    const sentences = projectStudySentences([
      { id: 'source-1', startMs: 0, endMs: 1_000, text: 'Take it' },
      { id: 'source-2', startMs: 1_000, endMs: 3_000, text: 'for granted. Next sentence!' },
    ]);

    expect(sentences.map((sentence) => sentence.text)).toEqual([
      'Take it for granted.',
      'Next sentence!',
    ]);
    expect(sentences[0]).toEqual(expect.objectContaining({
      id: 'study:source-1:0',
      startMs: 0,
      endMs: 3_000,
      sourceCueIds: ['source-1', 'source-2'],
    }));
    expect(sentences[1]).toEqual(expect.objectContaining({
      id: 'study:source-2:0',
      startMs: 1_000,
      endMs: 3_000,
      sourceCueIds: ['source-2'],
    }));
  });
  it('renders every Study Sentence when one Source Cue contains several sentences', () => {
    const sourceCues = [
      { id: 'source-1', startMs: 0, endMs: 2_000, text: 'First sentence. Second sentence!' },
    ];
    const studySentences = projectStudySentences(sourceCues);

    const projection = projectContinuousViewingStudyRows({
      projectedCues: sourceCues,
      sourceCues,
      sourceCueIndexByProjectedId: { 'source-1': 0 },
      studySentences,
    });

    expect(projection.rows.map((row) => row.id)).toEqual([
      'study:source-1:0',
      'study:source-1:1',
    ]);
    expect(projection.studySentenceIndexByProjectedId).toEqual({
      'study:source-1:0': 0,
      'study:source-1:1': 1,
    });
    expect(projection.rowIdsByProjectedId).toEqual({
      'source-1': ['study:source-1:0', 'study:source-1:1'],
    });
  });

  it('preserves exact rendered progress text while targeting its shaped Study Sentence', () => {
    const sourceCues = [
      { id: 'source-1', startMs: 0, endMs: 2_000, text: 'National League guy, Almost complete.' },
    ];
    const studySentences = projectStudySentences(sourceCues);

    const projection = projectContinuousViewingStudyRows({
      projectedCues: [
        { id: 'rendered-1', startMs: 500, endMs: 1_000, text: 'National League guy,.....Almost' },
      ],
      sourceCues,
      sourceCueIndexByProjectedId: { 'rendered-1': 0 },
      studySentences,
    });

    expect(projection.rows).toEqual([
      expect.objectContaining({ id: 'study:source-1:0', text: 'National League guy,.....Almost' }),
    ]);
    expect(projection.studySentenceIndexByProjectedId).toEqual(expect.objectContaining({ 'rendered-1': 0 }));
  });
  it('uses rendered text to choose among Study Sentences sharing one Source Cue range', () => {
    const sourceCues = [
      { id: 'source-1', startMs: 0, endMs: 2_000, text: 'First sentence. Second sentence!' },
    ];
    const studySentences = projectStudySentences(sourceCues);

    const projection = projectContinuousViewingStudyRows({
      projectedCues: [
        { id: 'rendered-second', startMs: 0, endMs: 2_000, text: 'Second sentence' },
      ],
      sourceCues,
      sourceCueIndexByProjectedId: { 'rendered-second': 0 },
      studySentences,
    });

    expect(projection.studySentenceIndexByProjectedId).toEqual(expect.objectContaining({ 'rendered-second': 1 }));
  });

  it('does not reveal a full Study Sentence after its partial rendered row', () => {
    const sourceCues = [
      { id: 'source-1', startMs: 0, endMs: 2_000, text: 'Take it' },
      { id: 'source-2', startMs: 0, endMs: 2_000, text: 'for granted.' },
    ];
    const studySentences = projectStudySentences(sourceCues);

    const projection = projectContinuousViewingStudyRows({
      projectedCues: [
        { id: 'rendered-partial', startMs: 0, endMs: 1_000, text: 'Take' },
        sourceCues[1],
      ],
      sourceCues,
      sourceCueIndexByProjectedId: { 'rendered-partial': 0, 'source-2': 1 },
      studySentences,
    });

    expect(projection.rows.map((row) => row.text)).toEqual(['Take']);
    expect(projection.rowIdsByProjectedId['source-2']).toEqual(['study:source-1:0']);
  });

  it('updates a deferred semantic row when a later Source Cue has rendered progress', () => {
    const sourceCues = [
      { id: 'source-1', startMs: 0, endMs: 2_000, text: 'Take it' },
      { id: 'source-2', startMs: 0, endMs: 2_000, text: 'for granted.' },
    ];
    const studySentences = projectStudySentences(sourceCues);

    const projection = projectContinuousViewingStudyRows({
      projectedCues: [
        sourceCues[0],
        { id: 'rendered-later', startMs: 0, endMs: 1_000, text: 'for granted' },
      ],
      sourceCues,
      sourceCueIndexByProjectedId: { 'source-1': 0, 'rendered-later': 1 },
      studySentences,
    });

    expect(projection.rows).toEqual([
      expect.objectContaining({ id: 'study:source-1:0', text: 'for granted' }),
    ]);
  });
});