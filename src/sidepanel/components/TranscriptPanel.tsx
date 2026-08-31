import type { CaptionCue } from '../../domain/types';
import { useLayoutEffect, useMemo, useRef } from 'react';

export type TranscriptSelection = { selectedText: string; cueIndex: number; sentence: string; anchor: { x: number; y: number } };

export type TranscriptPlaybackAction = 'jump' | 'replay' | 'play-from-here';

type Props = {
  cues: CaptionCue[];
  sourceCues?: CaptionCue[];
  sourceCueIndexByVisibleId?: Record<string, number>;
  currentCueIds: string[];
  autoFollowPlayback: boolean;
  fontSize?: number;
  textColor?: string;
  onSelection: (selection: TranscriptSelection) => void;
  onPlaybackAction: (action: TranscriptPlaybackAction, cue: CaptionCue) => void;
};

type CueEntry = {
  cue: CaptionCue;
  visibleIndex: number;
  sourceCueIndex: number;
  region: 'past' | 'current' | 'future';
  state: 'past' | 'current' | 'future';
};

export function TranscriptPanel({
  cues,
  sourceCues = cues,
  sourceCueIndexByVisibleId,
  currentCueIds,
  autoFollowPlayback,
  fontSize,
  textColor,
  onSelection,
  onPlaybackAction,
}: Props) {
  const orderedCues = useMemo(() => [...cues].sort((a, b) => a.startMs - b.startMs), [cues]);
  const orderedSourceCues = useMemo(
    () => [...sourceCues].sort((a, b) => a.startMs - b.startMs),
    [sourceCues],
  );
  const currentIdSet = new Set(currentCueIds);
  const currentIndices = orderedCues.flatMap((cue, index) => currentIdSet.has(cue.id) ? [index] : []);
  const activeFirst = currentIndices.at(0) ?? -1;
  const activeLast = currentIndices.at(-1) ?? -1;
  const lastFocusedRangeRef = useRef<{ firstId: string; lastId: string } | null>(null);
  useLayoutEffect(() => {
    if (activeFirst >= 0 && activeLast >= activeFirst) {
      lastFocusedRangeRef.current = {
        firstId: orderedCues[activeFirst].id,
        lastId: orderedCues[activeLast].id,
      };
      return;
    }
    const remembered = lastFocusedRangeRef.current;
    if (!remembered || orderedCues.length === 0
      || !orderedCues.some((cue) => cue.id === remembered.firstId)
      || !orderedCues.some((cue) => cue.id === remembered.lastId)) {
      lastFocusedRangeRef.current = null;
    }
  }, [activeFirst, activeLast, orderedCues]);
  const remembered = lastFocusedRangeRef.current;
  const rememberedFirst = remembered
    ? orderedCues.findIndex((cue) => cue.id === remembered.firstId)
    : -1;
  const rememberedLast = remembered
    ? orderedCues.findIndex((cue) => cue.id === remembered.lastId)
    : -1;
  const focusFirst = activeFirst >= 0 ? activeFirst : rememberedFirst;
  const focusLast = activeLast >= 0 ? activeLast : rememberedLast;
  const allEntries: CueEntry[] = orderedCues.map((cue, visibleIndex) => {
    const region = focusFirst < 0 || visibleIndex > focusLast
      ? 'future'
      : visibleIndex < focusFirst ? 'past' : 'current';
    const state = currentIdSet.has(cue.id)
      ? 'current'
      : activeFirst < 0 && visibleIndex >= focusFirst && visibleIndex <= focusLast
        ? 'current'
        : focusFirst >= 0 && visibleIndex <= focusLast ? 'past' : 'future';
    return {
      cue,
      visibleIndex,
      sourceCueIndex: sourceCueIndexByVisibleId?.[cue.id] ?? visibleIndex,
      region,
      state,
    };
  });
  const visibleEntries = allEntries;

  function formatTimestamp(timeMs: number): string {
    const totalSeconds = Math.max(0, Math.floor(timeMs / 1_000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function selectedTranscriptText(range: Range): string {
    const contents = range.cloneContents();
    contents.querySelectorAll('.caption-row-actions').forEach((actions) => actions.remove());
    const cueTexts = Array.from(contents.querySelectorAll('.caption-cue'))
      .map((cue) => cue.textContent?.trim() ?? '')
      .filter(Boolean);
    return (cueTexts.length > 0 ? cueTexts.join(' ') : contents.textContent ?? '').trim();
  }

  function reportSelection(event: React.KeyboardEvent<HTMLElement> | React.PointerEvent<HTMLElement>): boolean {
    const browserSelection = window.getSelection();
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-cue-index]') : null;
    if (!browserSelection || browserSelection.isCollapsed || !target || browserSelection.rangeCount === 0) {
      return false;
    }
    const range = browserSelection.getRangeAt(0);
    if (!range.intersectsNode(target)) return false;
    const text = selectedTranscriptText(range);
    if (text === '') return false;
    const sourceCueIndex = Number(target.dataset.cueIndex);
    const sourceCue = orderedSourceCues[sourceCueIndex];
    if (!sourceCue) return false;
    const rect = range.getBoundingClientRect();
    onSelection({
      selectedText: text,
      cueIndex: sourceCueIndex,
      sentence: sourceCue.text,
      anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
    });
    return true;
  }

  if (orderedCues.length === 0) {
    return <p role="status">No English captions are available.</p>;
  }

  const renderCue = ({ cue, sourceCueIndex, state }: CueEntry) => {
    const sourceCue = orderedSourceCues[sourceCueIndex] ?? cue;
    const timestamp = formatTimestamp(sourceCue.startMs);
    return (
      <div key={cue.id} className="caption-row">
        <button
          type="button"
          className="caption-timestamp"
          aria-label={`Play from ${timestamp}`}
          onClick={() => onPlaybackAction('play-from-here', sourceCue)}
        >
          {timestamp}
        </button>
        <p
          data-cue-index={sourceCueIndex}
          data-cue-state={autoFollowPlayback ? state : undefined}
          aria-current={currentIdSet.has(cue.id) ? 'true' : undefined}
          className="caption-cue"
          tabIndex={0}
          onClick={(event) => event.currentTarget.focus()}
          onPointerUp={reportSelection}
        >
          {cue.text}
        </p>
        <div className="caption-row-actions" aria-label={`Actions for ${sourceCue.text}`}>
          <button type="button" data-focused-study-action="preserve" aria-label={`Jump to Here: ${sourceCue.text}`} onClick={() => onPlaybackAction('jump', sourceCue)}>Jump to Here</button>
          <button type="button" data-focused-study-action="preserve" aria-label={`Replay: ${sourceCue.text}`} onClick={() => onPlaybackAction('replay', sourceCue)}>Replay</button>
          <button type="button" aria-label={`Play from Here: ${sourceCue.text}`} onClick={() => onPlaybackAction('play-from-here', sourceCue)}>Play from Here</button>
        </div>
      </div>
    );
  };

  const transcriptStyle = {
    ...(fontSize === undefined ? {} : { fontSize: `${fontSize}px` }),
    ...(textColor === undefined ? {} : { color: textColor }),
  };

  if (autoFollowPlayback) {
    const pastEntries = visibleEntries.filter((entry) => entry.region === 'past');
    const currentEntries = visibleEntries.filter((entry) => entry.region === 'current');
    const futureEntries = visibleEntries.filter((entry) => entry.region === 'future');

    return (
      <section
        aria-label="Transcript"
        className="transcript-list transcript-focus-window"
        style={transcriptStyle}
        onKeyUp={reportSelection}
      >
        <div className="focus-region focus-past">{pastEntries.map(renderCue)}</div>
        <div className="focus-region focus-current">{currentEntries.map(renderCue)}</div>
        <div className="focus-region focus-future">{futureEntries.map(renderCue)}</div>
      </section>
    );
  }

  return (
    <section
      aria-label="Transcript"
      className="transcript-list"
      style={transcriptStyle}
      onKeyUp={reportSelection}
    >
      {visibleEntries.map(renderCue)}
    </section>
  );
}
