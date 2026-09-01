import type { CaptionCue } from './types';

export type ReplayRange = { startMs: number; endMs: number };
export type StudySentence = {
  id: string;
  sourceCueIds: string[];
  startMs: number;
  endMs: number;
  text: string;
};

export type StudyContext = {
  id: string;
  studySentenceIndex: number;
  studySentence: StudySentence;
  selectedText: string;
  contextBefore: string[];
  contextAfter: string[];
  replayRange: ReplayRange;
};

export type LearningTranscriptSession = {
  mode: 'continuous-viewing' | 'focused-study';
  studyContext: StudyContext | null;
  knownStudySentenceIds: string[];
  newStudySentenceCount: number;
  accumulatedStudySentences: StudySentence[];
  playbackAnchorStudySentenceId: string | null;
};

export type PlaybackIntent =
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'play-from-here'; timeMs: number }
  | null;

export type LearningTranscriptEvent =
  | {
    type: 'SELECT_TEXT';
    studyContext: StudyContext;
    studySentences: StudySentence[];
  }
  | { type: 'LEARNING_ACTION'; studyId: string }
  | { type: 'RESUME'; currentStudySentenceId?: string }
  | { type: 'RETURN_TO_CURRENT'; currentStudySentenceId?: string }
  | { type: 'BROWSE_EARLIER_LEARNING_TRANSCRIPT'; studySentences: StudySentence[] }
  | { type: 'PLAY_FROM_HERE'; studySentenceId: string; timeMs: number }
  | { type: 'LEARNING_TRANSCRIPT_UPDATED'; studySentences: StudySentence[] }
  | { type: 'RESET' };

export type LearningTranscriptTransition = {
  session: LearningTranscriptSession;
  playbackIntent: PlaybackIntent;
  focusStudySentenceId?: string;
};

export const initialLearningTranscriptSession: LearningTranscriptSession = {
  mode: 'continuous-viewing',
  studyContext: null,
  knownStudySentenceIds: [],
  newStudySentenceCount: 0,
  accumulatedStudySentences: [],
  playbackAnchorStudySentenceId: null,
};

function copyStudySentence(sentence: StudySentence): StudySentence {
  return { ...sentence, sourceCueIds: [...sentence.sourceCueIds] };
}

function copyStudyContext(context: StudyContext): StudyContext {
  return {
    ...context,
    studySentence: copyStudySentence(context.studySentence),
    contextBefore: [...context.contextBefore],
    contextAfter: [...context.contextAfter],
    replayRange: { ...context.replayRange },
  };
}

function mergeStudySentences(
  current: StudySentence[],
  incoming: StudySentence[],
  frozenStudySentenceId?: string,
): StudySentence[] {
  const incomingById = new Map(incoming.map((sentence) => [sentence.id, sentence]));
  const currentIds = new Set(current.map((sentence) => sentence.id));
  return [
    ...current.map((sentence) => (
      sentence.id === frozenStudySentenceId
        ? copyStudySentence(sentence)
        : copyStudySentence(incomingById.get(sentence.id) ?? sentence)
    )),
    ...incoming
      .filter((sentence) => !currentIds.has(sentence.id))
      .map(copyStudySentence),
  ];
}

export function transitionLearningTranscriptSession(
  session: LearningTranscriptSession,
  event: LearningTranscriptEvent,
): LearningTranscriptTransition {
  if (event.type === 'RESET') {
    return {
      session: {
        ...initialLearningTranscriptSession,
        knownStudySentenceIds: [],
        accumulatedStudySentences: [],
      },
      playbackIntent: null,
    };
  }
  if (event.type === 'SELECT_TEXT') {
    const accumulatedStudySentences = mergeStudySentences(
      session.accumulatedStudySentences,
      event.studySentences,
    ).map((sentence) => (
      sentence.id === event.studyContext.studySentence.id
        ? copyStudySentence(event.studyContext.studySentence)
        : sentence
    ));
    return {
      session: {
        mode: 'focused-study',
        studyContext: copyStudyContext(event.studyContext),
        knownStudySentenceIds: accumulatedStudySentences.map((sentence) => sentence.id),
        newStudySentenceCount: 0,
        accumulatedStudySentences,
        playbackAnchorStudySentenceId: session.playbackAnchorStudySentenceId,
      },
      playbackIntent: { type: 'pause' },
    };
  }
  if (event.type === 'BROWSE_EARLIER_LEARNING_TRANSCRIPT') {
    if (session.mode === 'focused-study') return { session, playbackIntent: null };
    const accumulatedStudySentences = mergeStudySentences(
      session.accumulatedStudySentences,
      event.studySentences,
    );
    return {
      session: {
        mode: 'focused-study',
        studyContext: null,
        knownStudySentenceIds: accumulatedStudySentences.map((sentence) => sentence.id),
        newStudySentenceCount: 0,
        accumulatedStudySentences,
        playbackAnchorStudySentenceId: session.playbackAnchorStudySentenceId,
      },
      playbackIntent: null,
    };
  }
  if (event.type === 'LEARNING_TRANSCRIPT_UPDATED') {
    const accumulatedStudySentences = mergeStudySentences(
      session.accumulatedStudySentences,
      event.studySentences,
      session.studyContext?.studySentence.id,
    );
    const knownStudySentenceIds = new Set(session.knownStudySentenceIds);
    const newStudySentenceCount = session.mode === 'focused-study'
      ? accumulatedStudySentences.filter((sentence) => !knownStudySentenceIds.has(sentence.id)).length
      : 0;
    return {
      session: {
        ...session,
        accumulatedStudySentences,
        newStudySentenceCount,
      },
      playbackIntent: null,
    };
  }
  if (event.type === 'PLAY_FROM_HERE') {
    return {
      session: {
        ...session,
        mode: 'continuous-viewing',
        studyContext: null,
        knownStudySentenceIds: [],
        newStudySentenceCount: 0,
        playbackAnchorStudySentenceId: event.studySentenceId,
      },
      playbackIntent: { type: 'play-from-here', timeMs: Math.max(0, event.timeMs) },
      focusStudySentenceId: event.studySentenceId,
    };
  }
  if (event.type === 'RESUME' || event.type === 'RETURN_TO_CURRENT') {
    return {
      session: {
        ...session,
        mode: 'continuous-viewing',
        studyContext: null,
        knownStudySentenceIds: [],
        newStudySentenceCount: 0,
      },
      playbackIntent: event.type === 'RESUME' ? { type: 'resume' } : { type: 'pause' },
      ...(event.currentStudySentenceId
        ? { focusStudySentenceId: event.currentStudySentenceId }
        : {}),
    };
  }
  if (session.studyContext?.id !== event.studyId) {
    return { session, playbackIntent: null };
  }
  return { session, playbackIntent: { type: 'pause' } };
}

export function projectSessionTranscript(
  session: LearningTranscriptSession,
  liveTranscript: StudySentence[],
): StudySentence[] {
  const projection = mergeStudySentences(
    session.accumulatedStudySentences,
    liveTranscript,
    session.studyContext?.studySentence.id,
  );
  return projection.sort((left, right) => left.startMs - right.startMs);
}

export function projectContinuousSessionTranscript(
  session: LearningTranscriptSession,
  liveRows: CaptionCue[],
): CaptionCue[] {
  const liveRowIds = new Set(liveRows.map((row) => row.id));
  return [
    ...liveRows,
    ...session.accumulatedStudySentences
      .filter((sentence) => !liveRowIds.has(sentence.id)),
  ].sort((left, right) => left.startMs - right.startMs);
}
