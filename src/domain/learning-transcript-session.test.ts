import { describe, expect, it } from 'vitest';
import {
  initialLearningTranscriptSession,
  projectSessionTranscript,
  transitionLearningTranscriptSession,
  type StudyContext,
} from './learning-transcript-session';

const studyContext: StudyContext = {
  id: 'study-1',
  studySentenceIndex: 1,
  studySentence: { id: 'study:cue-2:0', sourceCueIds: ['cue-2'], startMs: 1_000, endMs: 2_000, text: 'Take it for granted.' },
  selectedText: 'take it for granted',
  contextBefore: ['First context.'],
  contextAfter: ['Last context.'],
  replayRange: { startMs: 1_000, endMs: 2_000 },
};
const baseStudySentences = [
  { id: 'study:cue-1:0', sourceCueIds: ['cue-1'], startMs: 0, endMs: 1_000, text: 'First context.' },
  studyContext.studySentence,
  { id: 'study:cue-3:0', sourceCueIds: ['cue-3'], startMs: 2_000, endMs: 3_000, text: 'Last context.' },
];

describe('Learning Transcript Session', () => {
  it('enters Focused Study with an immutable study context and pause intent', () => {
    const transition = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    });

    expect(transition.playbackIntent).toEqual({ type: 'pause' });
    expect(transition.session).toEqual({
      mode: 'focused-study',
      studyContext,
      knownStudySentenceIds: ['study:cue-1:0', 'study:cue-2:0', 'study:cue-3:0'],
      newStudySentenceCount: 0,
      accumulatedStudySentences: baseStudySentences,
      playbackAnchorStudySentenceId: null,
    });
    expect(transition.session.studyContext).not.toBe(studyContext);
    expect(transition.session.studyContext?.studySentence).not.toBe(studyContext.studySentence);
  });

  it('keeps the same study identity when a learning action starts', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    const transition = transitionLearningTranscriptSession(focused, {
      type: 'LEARNING_ACTION',
      studyId: 'study-1',
    });

    expect(transition.playbackIntent).toEqual({ type: 'pause' });
    expect(transition.session).toBe(focused);
    expect(transition.session.studyContext?.id).toBe('study-1');
  });

  it('resumes Continuous Viewing with play and current-focus intents', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    const transition = transitionLearningTranscriptSession(focused, {
      type: 'RESUME',
      currentStudySentenceId: 'study:cue-3:0',
    });

    expect(transition.session).toEqual({
      ...initialLearningTranscriptSession,
      accumulatedStudySentences: baseStudySentences,
    });
    expect(transition.playbackIntent).toEqual({ type: 'resume' });
    expect(transition.focusStudySentenceId).toBe('study:cue-3:0');
  });

  it('returns to current Continuous Viewing without changing paused playback', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    const transition = transitionLearningTranscriptSession(focused, {
      type: 'RETURN_TO_CURRENT',
      currentStudySentenceId: 'study:cue-3:0',
    });

    expect(transition.session).toEqual({
      ...initialLearningTranscriptSession,
      accumulatedStudySentences: baseStudySentences,
    });
    expect(transition.playbackIntent).toEqual({ type: 'pause' });
    expect(transition.focusStudySentenceId).toBe('study:cue-3:0');
  });

  it('keeps the study context fixed while twenty new segments accumulate', () => {
    let session = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    for (let index = 1; index <= 20; index += 1) {
      session = transitionLearningTranscriptSession(session, {
        type: 'LEARNING_TRANSCRIPT_UPDATED',
        studySentences: [
          ...baseStudySentences,
          ...Array.from({ length: index }, (_, sentenceIndex) => ({
            id: `study:new-${sentenceIndex + 1}:0`,
            sourceCueIds: [`new-${sentenceIndex + 1}`],
            startMs: 3_000 + sentenceIndex * 1_000,
            endMs: 4_000 + sentenceIndex * 1_000,
            text: `New sentence ${sentenceIndex + 1}.`,
          })),
        ],
      }).session;
    }

    expect(session.studyContext).toEqual(studyContext);
    expect(session.newStudySentenceCount).toBe(20);
    expect(session.knownStudySentenceIds).toEqual([
      'study:cue-1:0',
      'study:cue-2:0',
      'study:cue-3:0',
    ]);
  });

  it('ignores a learning action from a replaced study identity', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    const stale = transitionLearningTranscriptSession(focused, {
      type: 'LEARNING_ACTION',
      studyId: 'replaced-study',
    });

    expect(stale.session).toBe(focused);
    expect(stale.playbackIntent).toBeNull();
  });

  it('enters history browsing without deleting transcript identity or forcing playback', () => {
    const transition = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'BROWSE_EARLIER_LEARNING_TRANSCRIPT',
      studySentences: baseStudySentences,
    });

    expect(transition.session).toEqual({
      mode: 'focused-study',
      studyContext: null,
      knownStudySentenceIds: ['study:cue-1:0', 'study:cue-2:0', 'study:cue-3:0'],
      newStudySentenceCount: 0,
      accumulatedStudySentences: baseStudySentences,
      playbackAnchorStudySentenceId: null,
    });
    expect(transition.playbackIntent).toBeNull();
  });

  it('plays from a historical cue while returning focus to Continuous Viewing', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;

    const transition = transitionLearningTranscriptSession(focused, {
      type: 'PLAY_FROM_HERE',
      studySentenceId: 'study:cue-2:0',
      timeMs: 1_000,
    });

    expect(transition.session).toEqual({
      ...initialLearningTranscriptSession,
      accumulatedStudySentences: baseStudySentences,
      playbackAnchorStudySentenceId: 'study:cue-2:0',
    });
    expect(transition.playbackIntent).toEqual({ type: 'play-from-here', timeMs: 1_000 });
    expect(transition.focusStudySentenceId).toBe('study:cue-2:0');
  });

  it('retains every accumulated Study Sentence across shrinking updates and Play from Here', () => {
    const browsing = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'BROWSE_EARLIER_LEARNING_TRANSCRIPT',
      studySentences: baseStudySentences,
    }).session;
    const newSentence = {
      id: 'study:cue-4:0',
      sourceCueIds: ['cue-4'],
      startMs: 3_000,
      endMs: 4_000,
      text: 'New sentence.',
    };
    const updated = transitionLearningTranscriptSession(browsing, {
      type: 'LEARNING_TRANSCRIPT_UPDATED',
      studySentences: [baseStudySentences[2], newSentence],
    }).session;

    expect(updated.accumulatedStudySentences.map((sentence) => sentence.id)).toEqual([
      'study:cue-1:0',
      'study:cue-2:0',
      'study:cue-3:0',
      'study:cue-4:0',
    ]);

    const playing = transitionLearningTranscriptSession(updated, {
      type: 'PLAY_FROM_HERE',
      studySentenceId: 'study:cue-1:0',
      timeMs: 0,
    }).session;
    expect(playing.accumulatedStudySentences).toEqual(updated.accumulatedStudySentences);
  });

  it('projects the full live transcript while pinning the Study Sentence snapshot', () => {
    const focused = transitionLearningTranscriptSession(initialLearningTranscriptSession, {
      type: 'SELECT_TEXT',
      studyContext,
      studySentences: baseStudySentences,
    }).session;
    const liveTranscript = [
      { id: 'study:cue-1:0', sourceCueIds: ['cue-1'], startMs: 0, endMs: 1_000, text: 'First context.' },
      { id: 'study:cue-2:0', sourceCueIds: ['cue-2'], startMs: 1_000, endMs: 2_000, text: 'Take it' },
      { id: 'study:cue-3:0', sourceCueIds: ['cue-3'], startMs: 2_000, endMs: 3_000, text: 'Last context.' },
      { id: 'study:cue-4:0', sourceCueIds: ['cue-4'], startMs: 3_000, endMs: 4_000, text: 'New segment.' },
    ];

    const projection = projectSessionTranscript(focused, liveTranscript);

    expect(projection.map((cue) => cue.id)).toEqual([
      'study:cue-1:0',
      'study:cue-2:0',
      'study:cue-3:0',
      'study:cue-4:0',
    ]);
    expect(projection[1]).toEqual(studyContext.studySentence);
    expect(projection[1]).not.toBe(studyContext.studySentence);
  });
});
