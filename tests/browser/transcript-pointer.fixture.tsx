import { createRoot } from 'react-dom/client';
import { useLayoutEffect, useState } from 'react';
import { projectContinuousViewingStudyRows, projectStudySentences } from '../../src/domain/study-sentences';
import type { CaptionCue } from '../../src/domain/types';
import {
  TranscriptPanel,
  type TranscriptPlaybackAction,
  type TranscriptSelection,
} from '../../src/sidepanel/components/TranscriptPanel';
import '../../src/sidepanel/styles.css';

type PointerRegressionState = {
  selections: TranscriptSelection[];
  playbackActions: Array<{ action: TranscriptPlaybackAction; cueId: string }>;
  renderDurationMs: number | null;
  setAutoFollowPlayback: (value: boolean) => void;
  reset: () => void;
};

declare global {
  interface Window {
    __transcriptPointerRegression: PointerRegressionState;
  }
}

const requestedCueCount = Number(new URLSearchParams(window.location.search).get('count') ?? 0);
const cues: CaptionCue[] = Number.isInteger(requestedCueCount) && requestedCueCount > 0
  ? Array.from({ length: Math.min(requestedCueCount, 10_000) }, (_, index) => ({
    id: `long-${index}`,
    startMs: index * 3_000,
    endMs: (index + 1) * 3_000,
    text: `Long-video Study Sentence ${index + 1}.`,
  }))
  : [
    { id: 'punctuation', startMs: 1_000, endMs: 2_000, text: 'I, ...' },
    { id: 'rendered', startMs: 2_000, endMs: 3_000, text: 'Second rendered text' },
  ];
const studySentences = projectStudySentences(cues);
const continuousRows = projectContinuousViewingStudyRows({
  projectedCues: cues,
  sourceCues: cues,
  sourceCueIndexByProjectedId: Object.fromEntries(cues.map((cue, index) => [cue.id, index])),
  studySentences,
});

const state: PointerRegressionState = {
  selections: [],
  playbackActions: [],
  renderDurationMs: null,
  setAutoFollowPlayback: () => undefined,
  reset() {
    this.selections.length = 0;
    this.playbackActions.length = 0;
    window.getSelection()?.removeAllRanges();
  },
};
window.__transcriptPointerRegression = state;

function Fixture() {
  const [autoFollowPlayback, setAutoFollowPlayback] = useState(false);
  state.setAutoFollowPlayback = setAutoFollowPlayback;
  useLayoutEffect(() => {
    state.renderDurationMs = performance.now() - renderStartedAtMs;
  }, []);
  return <main style={{ width: 500, padding: 24 }}>
    <TranscriptPanel
      cues={continuousRows.rows}
      studySentenceIndexByProjectedId={continuousRows.studySentenceIndexByProjectedId}
      studySentences={studySentences}
      currentCueIds={continuousRows.rows.length > 2 ? [continuousRows.rows.at(-1)!.id] : []}
      autoFollowPlayback={autoFollowPlayback}
      onSelection={(selection) => state.selections.push(selection)}
      onPlaybackAction={(action, cue) => state.playbackActions.push({ action, cueId: cue.id })}
    />
  </main>;
}

const renderStartedAtMs = performance.now();
createRoot(document.getElementById('root')!).render(<Fixture />);
