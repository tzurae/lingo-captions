import { describe, expect, it } from 'vitest';
import type { CaptionTrack } from './types';
import { projectLearningTranscriptExperience } from './learning-transcript-experience';

const completeTrack: CaptionTrack = {
  language: 'en',
  isEnglish: true,
  cues: [
    { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First sentence.' },
    { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Current sentence.' },
    { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Future sentence.' },
  ],
};

describe('Learning Transcript Experience', () => {
  it('projects the Current Reading Segment from Caption Track timing without rendered progress', () => {
    const experience = projectLearningTranscriptExperience({
      track: completeTrack,
      playbackMs: 1_500,
      renderedProgress: null,
    });

    expect(experience.currentCueIds).toEqual(['cue-2']);
    expect(experience.visibleCues.find((cue) => cue.id === 'cue-2')?.text).toBe('Current sentence.');
  });

  it('returns every overlap and no current segment during silence', () => {
    const overlappingTrack: CaptionTrack = {
      ...completeTrack,
      cues: [
        { id: 'overlap-1', startMs: 0, endMs: 2_000, text: 'First speaker.' },
        { id: 'overlap-2', startMs: 1_000, endMs: 3_000, text: 'Second speaker.' },
      ],
    };

    const currentAt = (playbackMs: number) => projectLearningTranscriptExperience({
      track: overlappingTrack,
      playbackMs,
      renderedProgress: null,
    }).currentCueIds;

    expect(currentAt(1_000)).toEqual(['overlap-1', 'overlap-2']);
    expect(currentAt(2_000)).toEqual(['overlap-2']);
    expect(currentAt(3_000)).toEqual([]);
  });

  it('refines a Current Reading Segment with aligned rendered progress', () => {
    const experience = projectLearningTranscriptExperience({
      track: completeTrack,
      playbackMs: 1_500,
      renderedProgress: {
        capturedAtMs: 1_500,
        cues: [{ id: 'rendered-1', startMs: 1_400, endMs: 1_900, text: 'Current' }],
        activeGroup: { cueIds: ['rendered-1'], startMs: 1_400 },
      },
    });

    expect(experience.currentSourceCueIds).toEqual(['cue-2']);
    expect(experience.currentCueIds).toEqual(['cue-2']);
    expect(experience.visibleCues.find((cue) => cue.id === 'cue-2')?.text).toBe('Current');
    expect(experience.continuousViewingProjection.map((cue) => cue.text)).toEqual([
      'First sentence.',
      'Current',
      'Future sentence.',
    ]);
  });

  it('keeps the complete Current Reading Segment when rendered progress cannot align', () => {
    const experience = projectLearningTranscriptExperience({
      track: completeTrack,
      playbackMs: 1_500,
      renderedProgress: {
        capturedAtMs: 1_500,
        cues: [{ id: 'rendered-1', startMs: 1_400, endMs: 1_900, text: 'Unrelated words' }],
        activeGroup: { cueIds: ['rendered-1'], startMs: 1_400 },
      },
    });

    expect(experience.currentSourceCueIds).toEqual(['cue-2']);
    expect(experience.currentCueIds).toEqual(['cue-2']);
    expect(experience.visibleCues.find((cue) => cue.id === 'cue-2')?.text).toBe('Current sentence.');
  });

  it('finds the correct current cue at 180 Caption Track midpoints', () => {
    const cues = Array.from({ length: 180 }, (_, index) => ({
      id: `midpoint-${index}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      text: `Sentence ${index + 1}.`,
    }));
    const track: CaptionTrack = { ...completeTrack, cues };

    for (const [index, cue] of cues.entries()) {
      const experience = projectLearningTranscriptExperience({
        track,
        playbackMs: cue.startMs + 500,
        renderedProgress: null,
      });
      expect(experience.currentCueIds).toEqual([`midpoint-${index}`]);
    }
  });

  it('keeps current identity stable across 20 progressive and interrupted sequences', () => {
    const progressSamples = [
      'Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo',
      'Foxtrot', 'Golf', 'Hotel', 'India', 'Juliett',
      'Kilo', 'Lima', 'Mike', 'November', 'Oscar',
      'Papa', 'Quebec', 'Romeo', 'Sierra', 'Tango',
    ];

    for (const [index, progressText] of progressSamples.entries()) {
      const cueId = `progress-${index}`;
      const track: CaptionTrack = {
        ...completeTrack,
        cues: [{ id: cueId, startMs: 0, endMs: 2_000, text: `${progressText} complete.` }],
      };
      const refined = projectLearningTranscriptExperience({
        track,
        playbackMs: 1_000,
        renderedProgress: {
          capturedAtMs: 1_000,
          cues: [{ id: `rendered-${index}`, startMs: 900, endMs: 1_500, text: progressText }],
          activeGroup: { cueIds: [`rendered-${index}`], startMs: 900 },
        },
      });
      const interrupted = projectLearningTranscriptExperience({
        track,
        playbackMs: 1_000,
        renderedProgress: {
          capturedAtMs: 1_000,
          cues: [{ id: `mismatch-${index}`, startMs: 900, endMs: 1_500, text: 'Unrelated' }],
          activeGroup: { cueIds: [`mismatch-${index}`], startMs: 900 },
        },
      });

      expect(refined.currentSourceCueIds).toEqual([cueId]);
      expect(refined.currentCueIds).toEqual([cueId]);
      expect(refined.visibleCues[0]).toEqual(expect.objectContaining({ id: cueId, text: progressText }));
      expect(interrupted.currentSourceCueIds).toEqual([cueId]);
      expect(interrupted.currentCueIds).toEqual([cueId]);
      expect(interrupted.visibleCues[0]).toEqual(expect.objectContaining({ id: cueId, text: `${progressText} complete.` }));
    }
  });

  it('does not align rendered text inside a different word', () => {
    const track: CaptionTrack = {
      ...completeTrack,
      cues: [{ id: 'cue-word-boundary', startMs: 0, endMs: 2_000, text: 'The cat.' }],
    };
    const experience = projectLearningTranscriptExperience({
      track,
      playbackMs: 1_000,
      renderedProgress: {
        capturedAtMs: 1_000,
        cues: [{ id: 'rendered-word-boundary', startMs: 900, endMs: 1_500, text: 'he' }],
        activeGroup: { cueIds: ['rendered-word-boundary'], startMs: 900 },
      },
    });

    expect(experience.visibleCues[0].text).toBe('The cat.');
  });

  it('keeps the full transcript immutable while projecting differently segmented rendered progress', () => {
    const track: CaptionTrack = {
      ...completeTrack,
      cues: [
        { id: 'source-1', startMs: 0, endMs: 2_000, text: 'I think' },
        { id: 'source-2', startMs: 0, endMs: 2_000, text: 'we should start' },
      ],
    };
    const experience = projectLearningTranscriptExperience({
      track,
      playbackMs: 1_000,
      renderedProgress: {
        capturedAtMs: 1_000,
        cues: [{ id: 'rendered-combined', startMs: 900, endMs: 1_500, text: 'I think we should' }],
        activeGroup: { cueIds: ['rendered-combined'], startMs: 900 },
      },
    });

    expect(experience.fullTranscript).toEqual(track.cues);
    expect(experience.visibleCues.map((cue) => cue.text)).toEqual(['I think we should']);
    expect(experience.currentSourceCueIds).toEqual(['source-1', 'source-2']);
    expect(experience.currentCueIds).toEqual(['current:source-1|source-2']);
    expect(experience.sourceCueIndexByProjectedId).toEqual({ 'current:source-1|source-2': 0 });
  });

  it('maps every full Continuous Viewing row back to its Source Cue', () => {
    const track: CaptionTrack = {
      ...completeTrack,
      cues: [
        { id: 'source-1', startMs: 0, endMs: 2_000, text: 'I think' },
        { id: 'source-2', startMs: 0, endMs: 2_000, text: 'we should start' },
        { id: 'source-3', startMs: 2_000, endMs: 3_000, text: 'Third.' },
        { id: 'source-4', startMs: 3_000, endMs: 4_000, text: 'Fourth.' },
        { id: 'source-5', startMs: 4_000, endMs: 5_000, text: 'Fifth.' },
      ],
    };
    const experience = projectLearningTranscriptExperience({
      track,
      playbackMs: 1_000,
      renderedProgress: {
        capturedAtMs: 1_000,
        cues: [{ id: 'rendered-combined', startMs: 900, endMs: 1_500, text: 'I think we should' }],
        activeGroup: { cueIds: ['rendered-combined'], startMs: 900 },
      },
    });

    expect(experience.sourceCueIndexByProjectedId).toEqual({
      'current:source-1|source-2': 0,
      'source-3': 2,
      'source-4': 3,
      'source-5': 4,
    });
  });

  it('rejects repeated rendered text captured outside the current Source Cue interval', () => {
    const track: CaptionTrack = {
      ...completeTrack,
      cues: [{ id: 'later-repeat', startMs: 10_000, endMs: 12_000, text: 'Repeat this.' }],
    };
    const experience = projectLearningTranscriptExperience({
      track,
      playbackMs: 11_000,
      renderedProgress: {
        capturedAtMs: 1_000,
        cues: [{ id: 'stale-repeat', startMs: 900, endMs: 1_500, text: 'Repeat this.' }],
        activeGroup: { cueIds: ['stale-repeat'], startMs: 900 },
      },
    });

    expect(experience.currentCueIds).toEqual(['later-repeat']);
    expect(experience.visibleCues).toEqual(track.cues);
    expect(experience.alignmentFailure?.reason).toBe('stale-progress');
  });

  it('projects one previous, every current, and one next cue for Continuous Viewing', () => {
    const cues = Array.from({ length: 7 }, (_, index) => ({
      id: `neighborhood-${index}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      text: `Neighborhood ${index + 1}.`,
    }));
    const experience = projectLearningTranscriptExperience({
      track: { ...completeTrack, cues },
      playbackMs: 3_500,
      renderedProgress: null,
    });

    expect(experience.visibleCues.map((cue) => cue.id)).toEqual([
      'neighborhood-2',
      'neighborhood-3',
      'neighborhood-4',
    ]);
    expect(experience.fullTranscript).toEqual(cues);
  });

  it('keeps the neighborhood around a mid-video silence', () => {
    const cues = Array.from({ length: 5 }, (_, index) => ({
      id: `gap-${index}`,
      startMs: index * 2_000,
      endMs: index * 2_000 + 1_000,
      text: `Gap cue ${index + 1}.`,
    }));
    const experience = projectLearningTranscriptExperience({
      track: { ...completeTrack, cues },
      playbackMs: 3_500,
      renderedProgress: null,
    });

    expect(experience.currentCueIds).toEqual([]);
    expect(experience.visibleCues.map((cue) => cue.id)).toEqual(['gap-1', 'gap-2', 'gap-3']);
  });

});
