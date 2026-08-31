import { createRoot } from 'react-dom/client';
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
  reset: () => void;
};

declare global {
  interface Window {
    __transcriptPointerRegression: PointerRegressionState;
  }
}

const cues: CaptionCue[] = [
  { id: 'punctuation', startMs: 1_000, endMs: 2_000, text: 'I, ...' },
  { id: 'rendered', startMs: 2_000, endMs: 3_000, text: 'Second rendered text' },
];

const state: PointerRegressionState = {
  selections: [],
  playbackActions: [],
  reset() {
    this.selections.length = 0;
    this.playbackActions.length = 0;
    window.getSelection()?.removeAllRanges();
  },
};
window.__transcriptPointerRegression = state;

createRoot(document.getElementById('root')!).render(
  <main style={{ width: 500, padding: 24 }}>
    <TranscriptPanel
      cues={cues}
      currentCueIds={[]}
      autoFollowPlayback={false}
      onSelection={(selection) => state.selections.push(selection)}
      onPlaybackAction={(action, cue) => state.playbackActions.push({ action, cueId: cue.id })}
    />
  </main>,
);
