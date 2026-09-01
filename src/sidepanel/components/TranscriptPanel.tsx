import type { CaptionCue } from '../../domain/types';
import type { StudySentence } from '../../domain/learning-transcript-session';
import { useLayoutEffect, useMemo, useRef } from 'react';

export type TranscriptSelection = { selectedText: string; studySentenceIndex: number; sentence: string; anchor: { x: number; y: number } };

export type TranscriptPlaybackAction = 'jump' | 'replay' | 'play-from-here';

type Props = {
  cues: CaptionCue[];
  studySentences: StudySentence[];
  studySentenceIndexByProjectedId: Record<string, number>;
  currentCueIds: string[];
  autoFollowPlayback: boolean;
  studySentenceId?: string;
  focusRequest?: { cueId: string; version: number };
  fontSize?: number;
  textColor?: string;
  onSelection: (selection: TranscriptSelection) => void;
  onPlaybackAction: (action: TranscriptPlaybackAction, studySentence: StudySentence) => void;
  onBrowseEarlierTranscript?: () => void;
};

type CueEntry = {
  cue: CaptionCue;
  studySentenceIndex: number;
  state: 'past' | 'current' | 'future';
};

export function TranscriptPanel({
  cues,
  studySentences,
  studySentenceIndexByProjectedId,
  currentCueIds,
  autoFollowPlayback,
  fontSize,
  studySentenceId,
  focusRequest,
  textColor,
  onSelection,
  onPlaybackAction,
  onBrowseEarlierTranscript,
}: Props) {
  const orderedCues = useMemo(() => [...cues].sort((a, b) => a.startMs - b.startMs), [cues]);
  const studySentenceSources = useMemo(() => [...studySentences], [studySentences]);
  const currentIdSet = new Set(currentCueIds);
  const currentIndices = orderedCues.flatMap((cue, index) => currentIdSet.has(cue.id) ? [index] : []);
  const activeFirst = currentIndices.at(0) ?? -1;
  const activeLast = currentIndices.at(-1) ?? -1;
  const lastFocusedRangeRef = useRef<{ firstId: string; lastId: string } | null>(null);
  const previousScrollTopRef = useRef(0);
  const transcriptRef = useRef<HTMLElement | null>(null);
  const programmaticScrollRef = useRef(false);
  function centerCue(cueId: string): void {
    const cue = Array.from(
      transcriptRef.current?.querySelectorAll<HTMLElement>('[data-cue-id]') ?? [],
    ).find((element) => element.dataset.cueId === cueId);
    if (!cue?.scrollIntoView) return;
    programmaticScrollRef.current = true;
    cue.scrollIntoView({ block: 'center' });
    window.requestAnimationFrame(() => {
      programmaticScrollRef.current = false;
    });
  }
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
  useLayoutEffect(() => {
    if (autoFollowPlayback && currentCueIds.length > 0) centerCue(currentCueIds[0]);
  }, [autoFollowPlayback, currentCueIds.join('\u0000')]);
  useLayoutEffect(() => {
    if (focusRequest) centerCue(focusRequest.cueId);
  }, [focusRequest?.cueId, focusRequest?.version]);
  const remembered = lastFocusedRangeRef.current;
  const rememberedFirst = remembered
    ? orderedCues.findIndex((cue) => cue.id === remembered.firstId)
    : -1;
  const rememberedLast = remembered
    ? orderedCues.findIndex((cue) => cue.id === remembered.lastId)
    : -1;
  const focusFirst = activeFirst >= 0 ? activeFirst : rememberedFirst;
  const focusLast = activeLast >= 0 ? activeLast : rememberedLast;
  const visibleEntries: CueEntry[] = orderedCues.map((cue, visibleIndex) => {
    const state = currentIdSet.has(cue.id)
      ? 'current'
      : activeFirst < 0 && visibleIndex >= focusFirst && visibleIndex <= focusLast
        ? 'current'
        : focusFirst >= 0 && visibleIndex <= focusLast ? 'past' : 'future';
    return {
      cue,
      studySentenceIndex: studySentenceIndexByProjectedId[cue.id] ?? -1,
      state,
    };
  });

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
    const target = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-study-sentence-index]') : null;
    if (!browserSelection || browserSelection.isCollapsed || !target || browserSelection.rangeCount === 0) {
      return false;
    }
    const range = browserSelection.getRangeAt(0);
    if (!range.intersectsNode(target)) return false;
    const text = selectedTranscriptText(range);
    if (text === '') return false;
    const studySentenceIndex = Number(target.dataset.studySentenceIndex);
    const studySentence = studySentenceSources[studySentenceIndex];
    if (!studySentence) return false;
    const rect = range.getBoundingClientRect();
    onSelection({
      selectedText: text,
      studySentenceIndex,
      sentence: studySentence.text,
      anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
    });
    return true;
  }

  function reportScroll(event: React.UIEvent<HTMLElement>): void {
    const nextScrollTop = event.currentTarget.scrollTop;
    const previousScrollTop = previousScrollTopRef.current;
    previousScrollTopRef.current = nextScrollTop;
    if (programmaticScrollRef.current) return;
    if (nextScrollTop < previousScrollTop) onBrowseEarlierTranscript?.();
  }

  if (orderedCues.length === 0) return null;

  const renderCue = ({ cue, studySentenceIndex, state }: CueEntry) => {
    const sourceStudySentence = studySentenceSources[studySentenceIndex];
    const timestamp = formatTimestamp((sourceStudySentence ?? cue).startMs);
    const beginStudySentence = (target: HTMLElement) => {
      if (!sourceStudySentence) return;
      const caption = target.closest('.caption-row')?.querySelector<HTMLElement>('.caption-cue');
      const rect = (caption ?? target).getBoundingClientRect();
      onSelection({
        selectedText: sourceStudySentence.text,
        studySentenceIndex,
        sentence: sourceStudySentence.text,
        anchor: { x: rect.left + rect.width / 2, y: rect.bottom },
      });
    };
    return (
      <div key={cue.id} className="caption-row">
        {sourceStudySentence
          ? <button
            type="button"
            className="caption-timestamp"
            aria-label={`Play from ${timestamp}`}
            onClick={() => onPlaybackAction('play-from-here', sourceStudySentence)}
          >
            {timestamp}
          </button>
          : <span className="caption-timestamp" aria-hidden="true">{timestamp}</span>}
        <p
          data-study-sentence-index={studySentenceIndex >= 0 ? studySentenceIndex : undefined}
          data-cue-state={autoFollowPlayback ? state : undefined}
          data-study-sentence={cue.id === studySentenceId ? 'true' : undefined}
          data-cue-id={cue.id}
          aria-current={currentIdSet.has(cue.id) ? 'true' : undefined}
          className="caption-cue"
          tabIndex={0}
          onClick={(event) => event.currentTarget.focus()}
          onPointerUp={reportSelection}
        >
          {cue.text}
        </p>
        {sourceStudySentence && <div
          className="caption-row-actions"
          aria-label={`Actions for ${sourceStudySentence.text}`}
        >
          <button type="button" data-focused-study-action="preserve" aria-label={`Jump to Here: ${sourceStudySentence.text}`} onClick={() => onPlaybackAction('jump', sourceStudySentence)}>Jump to Here</button>
          <button type="button" data-focused-study-action="preserve" aria-label={`Replay: ${sourceStudySentence.text}`} onClick={() => onPlaybackAction('replay', sourceStudySentence)}>Replay</button>
          <button type="button" aria-label={`Play from Here: ${sourceStudySentence.text}`} onClick={() => onPlaybackAction('play-from-here', sourceStudySentence)}>Play from Here</button>
          <button
            type="button"
            aria-label={`Study Sentence: ${sourceStudySentence.text}`}
            onClick={(event) => beginStudySentence(event.currentTarget)}
          >
            Study Sentence
          </button>
        </div>}
      </div>
    );
  };

  const transcriptStyle = {
    ...(fontSize === undefined ? {} : { fontSize: `${fontSize}px` }),
    ...(textColor === undefined ? {} : { color: textColor }),
  };

  return (
    <section
      aria-label="Transcript"
      ref={transcriptRef}
      className={`transcript-list${autoFollowPlayback ? ' transcript-focus-window' : ''}`}
      style={transcriptStyle}
      onKeyUp={reportSelection}
      onScroll={reportScroll}
    >
      {visibleEntries.map(renderCue)}
    </section>
  );
}
