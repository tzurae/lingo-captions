import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptPanel } from './TranscriptPanel';

const cues = [
  { id: 'two', startMs: 2_000, endMs: 3_000, text: 'Second cue' },
  { id: 'one', startMs: 1_000, endMs: 2_000, text: 'First cue' },
];
const cueStudySentences = cues.map((cue) => ({ ...cue, sourceCueIds: [cue.id] }));
const cueStudySentenceIndexById = Object.fromEntries(
  cueStudySentences.map((sentence, index) => [sentence.id, index]),
);

const focusCues = [
  { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Cue one' },
  { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Cue two' },
  { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Cue three' },
  { id: 'cue-4', startMs: 3_000, endMs: 4_000, text: 'Cue four' },
  { id: 'cue-5', startMs: 4_000, endMs: 5_000, text: 'Cue five' },
  { id: 'cue-6', startMs: 5_000, endMs: 6_000, text: 'Cue six' },
  { id: 'cue-7', startMs: 6_000, endMs: 7_000, text: 'Cue seven' },
];
const focusStudySentences = focusCues.map((cue) => ({ ...cue, sourceCueIds: [cue.id] }));

const focusSourceIndexById = Object.fromEntries(
  focusCues.map((cue, index) => [cue.id, index]),
);

describe('TranscriptPanel', () => {
  it('applies the configured subtitle font size and text color to the transcript', () => {
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    fontSize={22}
    textColor="#123456"
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Transcript' })).toHaveStyle({
      fontSize: '22px',
      color: '#123456',
    });
  });

  it('renders cues in time order and marks the current cue', () => {
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={['two']}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    const transcript = screen.getByRole('region', { name: 'Transcript' });
    expect(transcript).toHaveClass('transcript-list');
    expect(transcript.textContent).toMatch(/First cue.*Second cue/);
    expect(screen.getByText('First cue')).toHaveClass('caption-cue');
    expect(screen.getByText('Second cue')).toHaveAttribute('aria-current', 'true');
  });

  it('reports the selected text and containing cue', () => {
    const onSelection = vi.fn();
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={onSelection}
    onPlaybackAction={onPlaybackAction} />);

    const cue = screen.getByText('First cue');
    vi.spyOn(cue, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 300, bottom: 400 } as DOMRect);
    const range = document.createRange();
    range.selectNodeContents(cue);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerUp(cue);

    expect(onSelection).toHaveBeenCalledWith({
      selectedText: 'First cue',
      studySentenceIndex: 1,
      sentence: 'First cue',
      anchor: { x: 60, y: 110 },
    });
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('uses full source context for a differently segmented rendered cue', () => {
    const onSelection = vi.fn();
    const onPlaybackAction = vi.fn();
    const sourceCue = { id: 'source', sourceCueIds: ['source'], startMs: 1_000, endMs: 2_000, text: 'I think we should start.' };
    const renderedCue = { id: 'rendered', startMs: 1_200, endMs: 1_500, text: 'I think we should' };
    render(<TranscriptPanel cues={[renderedCue]} studySentences={[sourceCue]} studySentenceIndexByProjectedId={{ rendered: 0 }} currentCueIds={['rendered']}
    autoFollowPlayback
    onSelection={onSelection}
    onPlaybackAction={onPlaybackAction} />);

    const cue = screen.getByText('I think we should');
    const range = document.createRange();
    range.selectNodeContents(cue);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerUp(cue);

    expect(onSelection).toHaveBeenCalledWith({
      selectedText: 'I think we should',
      studySentenceIndex: 0,
      sentence: 'I think we should start.',
      anchor: { x: 60, y: 110 },
    });
    selection?.removeAllRanges();
    fireEvent.pointerUp(cue);
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('accepts non-collapsed short and punctuation-only selections', () => {
    const onSelection = vi.fn();
    const onPlaybackAction = vi.fn();
    const cue = { id: 'selection-edge', startMs: 0, endMs: 1_000, text: 'I, ...' };
    render(<TranscriptPanel
      cues={[cue]}
      studySentences={[{ ...cue, sourceCueIds: [cue.id] }]}
      studySentenceIndexByProjectedId={{ 'selection-edge': 0 }}
      currentCueIds={['selection-edge']}
      autoFollowPlayback
      onSelection={onSelection}
      onPlaybackAction={onPlaybackAction}
    />);
    const row = screen.getByText('I, ...');
    const textNode = row.firstChild!;
    const selection = window.getSelection()!;

    const shortRange = document.createRange();
    shortRange.setStart(textNode, 0);
    shortRange.setEnd(textNode, 1);
    Object.defineProperty(shortRange, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 20, bottom: 110 } as DOMRect),
    });
    selection.removeAllRanges();
    selection.addRange(shortRange);
    fireEvent.pointerUp(row);
    expect(onSelection).toHaveBeenCalledOnce();

    const punctuationRange = document.createRange();
    punctuationRange.setStart(textNode, 1);
    punctuationRange.setEnd(textNode, 2);
    Object.defineProperty(punctuationRange, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 40, width: 10, bottom: 110 } as DOMRect),
    });
    selection.removeAllRanges();
    selection.addRange(punctuationRange);
    fireEvent.pointerUp(row);
    expect(onSelection).toHaveBeenNthCalledWith(2, expect.objectContaining({ selectedText: ',' }));

    const collapsedRange = document.createRange();
    collapsedRange.setStart(textNode, 1);
    collapsedRange.collapse(true);
    selection.removeAllRanges();
    selection.addRange(collapsedRange);
    fireEvent.pointerUp(row);

    expect(onSelection).toHaveBeenCalledTimes(2);
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('opens the assistant for a reverse selection spanning rendered rows', () => {
    const onSelection = vi.fn();
    const selection = window.getSelection()!;
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={onSelection}
    onPlaybackAction={vi.fn()} />);
    const firstCue = screen.getByText('First cue');
    const secondCue = screen.getByText('Second cue');
    selection.removeAllRanges();
    selection.setBaseAndExtent(secondCue.firstChild!, 6, firstCue.firstChild!, 0);
    Object.defineProperty(selection.getRangeAt(0), 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 10, width: 100, bottom: 120 } as DOMRect),
    });

    fireEvent.pointerUp(firstCue);

    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({
      selectedText: 'First cue Second',
    }));
  });

  it('never replays from plain transcript pointer interactions', () => {
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={onPlaybackAction} />);

    const cue = screen.getByText('First cue');
    for (let index = 0; index < 300; index += 1) fireEvent.pointerUp(cue);
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('does not hide replay behind Enter on transcript text', () => {
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={onPlaybackAction} />);

    fireEvent.keyDown(screen.getByText('First cue'), { key: 'Enter' });

    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('exposes explicit timestamp, Jump, Replay, and Play from Here controls', async () => {
    const user = userEvent.setup();
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={cues} studySentences={cueStudySentences} studySentenceIndexByProjectedId={cueStudySentenceIndexById} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={onPlaybackAction} />);

    await user.click(screen.getByRole('button', { name: 'Play from 00:01' }));
    await user.click(screen.getByRole('button', { name: 'Jump to Here: First cue' }));
    await user.click(screen.getByRole('button', { name: 'Replay: First cue' }));
    await user.click(screen.getByRole('button', { name: 'Play from Here: First cue' }));

    expect(onPlaybackAction.mock.calls).toEqual([
      ['play-from-here', expect.objectContaining({ id: 'one' })],
      ['jump', expect.objectContaining({ id: 'one' })],
      ['replay', expect.objectContaining({ id: 'one' })],
      ['play-from-here', expect.objectContaining({ id: 'one' })],
    ]);
  });

  it('offers a keyboard learning action for the complete Study Sentence', async () => {
    const user = userEvent.setup();
    const onSelection = vi.fn();
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={[cues[1]]} studySentences={[cueStudySentences[1]]} studySentenceIndexByProjectedId={{ one: 0 }} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={onSelection}
    onPlaybackAction={onPlaybackAction} />);
    const study = screen.getByRole('button', { name: 'Study Sentence: First cue' });
    study.focus();

    await user.keyboard('{Enter}');

    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({
      selectedText: 'First cue',
      studySentenceIndex: 0,
      sentence: 'First cue',
    }));
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('keeps row text inert while exposing playback controls in keyboard focus order', async () => {
    const user = userEvent.setup();
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel cues={[cues[1]]} studySentences={[cueStudySentences[1]]} studySentenceIndexByProjectedId={{ one: 0 }} currentCueIds={[]}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={onPlaybackAction} />);
    const cueText = screen.getByText('First cue');
    const timestamp = screen.getByRole('button', { name: 'Play from 00:01' });
    const jump = screen.getByRole('button', { name: 'Jump to Here: First cue' });
    const replay = screen.getByRole('button', { name: 'Replay: First cue' });
    const playFromHere = screen.getByRole('button', { name: 'Play from Here: First cue' });

    await user.tab();
    expect(timestamp).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(cueText).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onPlaybackAction).toHaveBeenCalledTimes(1);

    await user.tab();
    expect(jump).toHaveFocus();
    await user.keyboard(' ');
    await user.tab();
    expect(replay).toHaveFocus();
    await user.keyboard('{Enter}');
    await user.tab();
    expect(playFromHere).toHaveFocus();
    await user.keyboard(' ');

    expect(onPlaybackAction.mock.calls.map(([action]) => action)).toEqual([
      'play-from-here',
      'jump',
      'replay',
      'play-from-here',
    ]);
  });

  it('renders an unmapped row read-only instead of fabricating a Study Sentence', () => {
    const onSelection = vi.fn();
    const onPlaybackAction = vi.fn();
    render(<TranscriptPanel
      cues={[cues[1]]}
      studySentences={[]}
      studySentenceIndexByProjectedId={{}}
      currentCueIds={[]}
      autoFollowPlayback={false}
      onSelection={onSelection}
      onPlaybackAction={onPlaybackAction}
    />);

    expect(screen.getByText('First cue')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /First cue/ })).not.toBeInTheDocument();
    fireEvent.pointerUp(screen.getByText('First cue'));
    expect(onSelection).not.toHaveBeenCalled();
    expect(onPlaybackAction).not.toHaveBeenCalled();
  });

  it('explains when no English captions are available', () => {
    render(<TranscriptPanel
      cues={[]}
      studySentences={[]}
      studySentenceIndexByProjectedId={{}}
      currentCueIds={[]}
      autoFollowPlayback={false}
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);

    expect(screen.getByText('No English captions are available.')).toBeInTheDocument();
  });

  it('renders the supplied current neighborhood without reslicing it', () => {
    render(<TranscriptPanel cues={focusCues.slice(2, 5)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-4']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Transcript' })).toHaveClass('transcript-focus-window');
    expect(screen.getByText('Cue three')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue four')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue four')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue five')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.getAllByText(/^Cue /)).toHaveLength(3);
  });

  it('renders supplied neighborhoods at transcript boundaries', () => {
    const { rerender } = render(<TranscriptPanel cues={focusCues.slice(0, 2)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-1']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByText('Cue one')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue two')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.queryByText('Cue three')).not.toBeInTheDocument();

    rerender(<TranscriptPanel cues={focusCues.slice(5)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-7']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.queryByText('Cue five')).not.toBeInTheDocument();
    expect(screen.getByText('Cue six')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue seven')).toHaveAttribute('data-cue-state', 'current');
  });

  it('keeps the supplied neighborhood during a caption gap without marking a cue active', () => {
    const neighborhood = focusCues.slice(2, 5);
    const { rerender } = render(<TranscriptPanel cues={neighborhood} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-4']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    rerender(<TranscriptPanel cues={neighborhood} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={[]}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByText('Cue four')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue four')).not.toHaveAttribute('aria-current');
    expect(screen.getAllByText(/^Cue /)).toHaveLength(3);
  });

  it('renders the supplied initial neighborhood before the first playback position', () => {
    render(<TranscriptPanel
      cues={focusCues.slice(0, 3)}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={[]}
      autoFollowPlayback
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);

    expect(screen.getAllByText(/^Cue /)).toHaveLength(3);
    expect(screen.getByRole('region', { name: 'Transcript' }).querySelector('[aria-current="true"]')).toBeNull();
  });

  it('renders the complete transcript when automatic following is disabled', () => {
    render(<TranscriptPanel
      cues={focusCues}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={['cue-4']}
      autoFollowPlayback={false}
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);

    expect(screen.getAllByText(/^Cue /)).toHaveLength(7);
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue seven')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Transcript' })).not.toHaveClass('transcript-focus-window');
  });

  it('reports the full transcript index from a supplied neighborhood', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel cues={focusCues.slice(2, 5)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-4']}
    autoFollowPlayback
    onSelection={onSelection}
    onPlaybackAction={vi.fn()} />);
    const cue = screen.getByText('Cue three');
    const range = document.createRange();
    range.selectNodeContents(cue);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerUp(cue);

    expect(onSelection).toHaveBeenCalledWith({
      selectedText: 'Cue three',
      studySentenceIndex: 2,
      sentence: 'Cue three',
      anchor: { x: 60, y: 110 },
    });
  });

  it('reports a pointer text selection only once when the browser also emits mouseup', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel cues={focusCues.slice(2, 5)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-4']}
    autoFollowPlayback
    onSelection={onSelection}
    onPlaybackAction={vi.fn()} />);
    const cue = screen.getByText('Cue four');
    const range = document.createRange();
    range.selectNodeContents(cue);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);

    fireEvent.pointerUp(cue);
    fireEvent.mouseUp(cue);

    expect(onSelection).toHaveBeenCalledTimes(1);
  });

  it('marks every cue in the supplied current group', () => {
    render(<TranscriptPanel cues={focusCues.slice(1, 6)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-3', 'cue-4', 'cue-5']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Transcript' })
      .querySelectorAll('[aria-current="true"]')).toHaveLength(3);
    expect(screen.queryByText('Cue one')).not.toBeInTheDocument();
    expect(screen.getByText('Cue two')).toBeInTheDocument();
    expect(screen.getByText('Cue six')).toBeInTheDocument();
    expect(screen.queryByText('Cue seven')).not.toBeInTheDocument();
  });

  it('does not fabricate future rows after a group at the transcript end', () => {
    render(<TranscriptPanel cues={focusCues.slice(4)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-6', 'cue-7']}
    autoFollowPlayback
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getAllByText(/^Cue /)).toHaveLength(3);
    expect(screen.getByText('Cue five')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue six')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue seven')).toHaveAttribute('aria-current', 'true');
  });

  it('reports the full transcript index from a multi-row current group', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel cues={focusCues.slice(1, 6)} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-3', 'cue-4', 'cue-5']}
    autoFollowPlayback
    onSelection={onSelection}
    onPlaybackAction={vi.fn()} />);
    const cue = screen.getByText('Cue five');
    const range = document.createRange();
    range.selectNodeContents(cue);
    Object.defineProperty(range, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ left: 20, width: 80, bottom: 110 } as DOMRect),
    });
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    fireEvent.pointerUp(cue);

    expect(onSelection).toHaveBeenCalledWith(expect.objectContaining({
      selectedText: 'Cue five',
      studySentenceIndex: 4,
      sentence: 'Cue five',
    }));
  });

  it.each([true, false])(
    'enters earlier-transcript browsing on upward scroll with automatic following=%s',
    (autoFollowPlayback) => {
      const onBrowseEarlierTranscript = vi.fn();
      render(<TranscriptPanel
        cues={focusCues}
        studySentences={focusStudySentences}
        studySentenceIndexByProjectedId={focusSourceIndexById}
        currentCueIds={['cue-7']}
        autoFollowPlayback={autoFollowPlayback}
        onSelection={vi.fn()}
        onPlaybackAction={vi.fn()}
        onBrowseEarlierTranscript={onBrowseEarlierTranscript}
      />);
      const transcript = screen.getByRole('region', { name: 'Transcript' });
      Object.defineProperty(transcript, 'scrollTop', { configurable: true, writable: true, value: 100 });
      fireEvent.scroll(transcript);
      transcript.scrollTop = 40;
      fireEvent.scroll(transcript);

      expect(onBrowseEarlierTranscript).toHaveBeenCalledOnce();
    },
  );

  it('pins the Study Sentence independently from the moving current segment', () => {
    render(<TranscriptPanel cues={focusCues} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-7']}
    studySentenceId="cue-3"
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(screen.getByText('Cue three')).toHaveAttribute('data-study-sentence', 'true');
    expect(screen.getByText('Cue seven')).toHaveAttribute('aria-current', 'true');
  });

  it('focuses an explicitly requested historical cue once', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });

    render(<TranscriptPanel cues={focusCues} studySentences={focusStudySentences} studySentenceIndexByProjectedId={focusSourceIndexById} currentCueIds={['cue-7']}
    focusRequest={{ cueId: 'cue-3', version: 1 }}
    autoFollowPlayback={false}
    onSelection={vi.fn()}
    onPlaybackAction={vi.fn()} />);

    expect(scrollIntoView).toHaveBeenCalledOnce();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
  });

  it('lets an explicit Play from Here focus override the previous current segment', () => {
    const focusedCueIds: Array<string | undefined> = [];
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value(this: HTMLElement) {
        focusedCueIds.push(this.dataset.cueId);
      },
    });

    render(<TranscriptPanel
      cues={focusCues}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={['cue-7']}
      focusRequest={{ cueId: 'cue-3', version: 1 }}
      autoFollowPlayback
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);

    expect(focusedCueIds).toEqual(['cue-7', 'cue-3']);
  });

  it('keeps the moving current segment centered only while automatic following is active', () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: scrollIntoView,
    });
    const { rerender } = render(<TranscriptPanel
      cues={focusCues}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={['cue-6']}
      autoFollowPlayback
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    rerender(<TranscriptPanel
      cues={focusCues}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={['cue-7']}
      autoFollowPlayback
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);

    rerender(<TranscriptPanel
      cues={focusCues}
      studySentences={focusStudySentences}
      studySentenceIndexByProjectedId={focusSourceIndexById}
      currentCueIds={['cue-5']}
      autoFollowPlayback={false}
      onSelection={vi.fn()}
      onPlaybackAction={vi.fn()}
    />);
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });
});
