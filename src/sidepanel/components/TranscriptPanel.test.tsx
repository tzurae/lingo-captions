import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TranscriptPanel } from './TranscriptPanel';

const cues = [
  { id: 'two', startMs: 2_000, endMs: 3_000, text: 'Second cue' },
  { id: 'one', startMs: 1_000, endMs: 2_000, text: 'First cue' },
];

const focusCues = [
  { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Cue one' },
  { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Cue two' },
  { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Cue three' },
  { id: 'cue-4', startMs: 3_000, endMs: 4_000, text: 'Cue four' },
  { id: 'cue-5', startMs: 4_000, endMs: 5_000, text: 'Cue five' },
  { id: 'cue-6', startMs: 5_000, endMs: 6_000, text: 'Cue six' },
  { id: 'cue-7', startMs: 6_000, endMs: 7_000, text: 'Cue seven' },
];

describe('TranscriptPanel', () => {
  it('applies the configured subtitle font size and text color to the transcript', () => {
    render(<TranscriptPanel
      cues={cues}
      currentCueIds={[]}
      autoFollowPlayback={false}
      fontSize={22}
      textColor="#123456"
      onSelection={vi.fn()}
      onReplay={vi.fn()}
    />);

    expect(screen.getByRole('region', { name: 'Transcript' })).toHaveStyle({
      fontSize: '22px',
      color: '#123456',
    });
  });

  it('renders cues in time order and marks the current cue', () => {
    render(<TranscriptPanel cues={cues} currentCueIds={['two']} autoFollowPlayback={false} onSelection={vi.fn()} onReplay={vi.fn()} />);

    const transcript = screen.getByRole('region', { name: 'Transcript' });
    expect(transcript).toHaveClass('transcript-list');
    expect(transcript.textContent).toMatch(/First cue.*Second cue/);
    expect(screen.getByText('First cue')).toHaveClass('caption-cue');
    expect(screen.getByText('Second cue')).toHaveAttribute('aria-current', 'true');
  });

  it('reports the selected text and containing cue', () => {
    const onSelection = vi.fn();
    const onReplay = vi.fn();
    render(<TranscriptPanel cues={cues} currentCueIds={[]} autoFollowPlayback={false} onSelection={onSelection} onReplay={onReplay} />);

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
      cueIndex: 0,
      sentence: 'First cue',
      anchor: { x: 60, y: 110 },
    });
    expect(onReplay).not.toHaveBeenCalled();
  });

  it('replays a cue when it receives a pointer interaction without selected text', () => {
    const onReplay = vi.fn();
    render(<TranscriptPanel cues={cues} currentCueIds={[]} autoFollowPlayback={false} onSelection={vi.fn()} onReplay={onReplay} />);

    fireEvent.pointerUp(screen.getByText('First cue'));

    expect(onReplay).toHaveBeenCalledWith({ id: 'one', startMs: 1_000, endMs: 2_000, text: 'First cue' });
  });

  it('replays a focused cue when Enter is pressed', () => {
    const onReplay = vi.fn();
    render(<TranscriptPanel cues={cues} currentCueIds={[]} autoFollowPlayback={false} onSelection={vi.fn()} onReplay={onReplay} />);

    fireEvent.keyDown(screen.getByText('First cue'), { key: 'Enter' });

    expect(onReplay).toHaveBeenCalledWith({ id: 'one', startMs: 1_000, endMs: 2_000, text: 'First cue' });
  });

  it('explains when no English captions are available', () => {
    render(<TranscriptPanel cues={[]} currentCueIds={[]} autoFollowPlayback={false} onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.getByText('No English captions are available.')).toBeInTheDocument();
  });

  it('shows two past cues, the current cue, and two future cues in focus mode', () => {
    render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-4']} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.getByRole('region', { name: 'Transcript' })).toHaveClass('transcript-focus-window');
    expect(screen.queryByText('Cue one')).not.toBeInTheDocument();
    expect(screen.getByText('Cue two')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue three')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue four')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue four')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue five')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.getByText('Cue six')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.queryByText('Cue seven')).not.toBeInTheDocument();
  });

  it('keeps focus windows inside transcript boundaries', () => {
    const { rerender } = render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-1']} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.getByText('Cue one')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue two')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.getByText('Cue three')).toHaveAttribute('data-cue-state', 'future');
    expect(screen.queryByText('Cue four')).not.toBeInTheDocument();

    rerender(<TranscriptPanel cues={focusCues} currentCueIds={['cue-7']} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.queryByText('Cue four')).not.toBeInTheDocument();
    expect(screen.getByText('Cue five')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue six')).toHaveAttribute('data-cue-state', 'past');
    expect(screen.getByText('Cue seven')).toHaveAttribute('data-cue-state', 'current');
  });

  it('keeps the last focus window during a caption gap without marking a cue active', () => {
    const { rerender } = render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-4']} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    rerender(<TranscriptPanel cues={focusCues} currentCueIds={[]} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.queryByText('Cue one')).not.toBeInTheDocument();
    expect(screen.getByText('Cue four')).toHaveAttribute('data-cue-state', 'current');
    expect(screen.getByText('Cue four')).not.toHaveAttribute('aria-current');
    expect(screen.queryByText('Cue seven')).not.toBeInTheDocument();
  });

  it('shows the first five cues before the first playback position is received', () => {
    render(<TranscriptPanel cues={focusCues} currentCueIds={[]} autoFollowPlayback onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue five')).toBeInTheDocument();
    expect(screen.queryByText('Cue six')).not.toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Transcript' }).querySelector('[aria-current="true"]')).toBeNull();
  });

  it('renders the complete transcript when automatic following is disabled', () => {
    render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-4']} autoFollowPlayback={false} onSelection={vi.fn()} onReplay={vi.fn()} />);

    expect(screen.getAllByText(/^Cue /)).toHaveLength(7);
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue seven')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Transcript' })).not.toHaveClass('transcript-focus-window');
  });

  it('reports the full transcript index when selecting a cue inside the focus window', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-4']} autoFollowPlayback onSelection={onSelection} onReplay={vi.fn()} />);
    expect(screen.queryByText('Cue one')).not.toBeInTheDocument();

    const cue = screen.getByText('Cue two');
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
      selectedText: 'Cue two',
      cueIndex: 1,
      sentence: 'Cue two',
      anchor: { x: 60, y: 110 },
    });
  });

  it('reports a pointer text selection only once when the browser also emits mouseup', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel cues={focusCues} currentCueIds={['cue-4']} autoFollowPlayback onSelection={onSelection} onReplay={vi.fn()} />);
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

  it('centers and marks every cue in the current group', () => {
    render(
      <TranscriptPanel
        cues={focusCues}
        currentCueIds={['cue-3', 'cue-4', 'cue-5']}
        autoFollowPlayback
        onSelection={vi.fn()}
        onReplay={vi.fn()}
      />,
    );

    expect(screen.getByText('Cue three')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue four')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue five')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('region', { name: 'Transcript' })
      .querySelectorAll('[aria-current="true"]')).toHaveLength(3);
    expect(screen.getByText('Cue one')).toBeInTheDocument();
    expect(screen.getByText('Cue two')).toBeInTheDocument();
    expect(screen.getByText('Cue six')).toBeInTheDocument();
    expect(screen.getByText('Cue seven')).toBeInTheDocument();
  });

  it('does not fabricate future rows after a group at the transcript end', () => {
    render(<TranscriptPanel
      cues={focusCues}
      currentCueIds={['cue-6', 'cue-7']}
      autoFollowPlayback
      onSelection={vi.fn()}
      onReplay={vi.fn()}
    />);

    expect(screen.getAllByText(/^Cue /)).toHaveLength(4);
    expect(screen.getByText('Cue four')).toBeInTheDocument();
    expect(screen.getByText('Cue five')).toBeInTheDocument();
    expect(screen.getByText('Cue six')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByText('Cue seven')).toHaveAttribute('aria-current', 'true');
  });

  it('reports the full transcript index from a multi-row focus slice', () => {
    const onSelection = vi.fn();
    render(<TranscriptPanel
      cues={focusCues}
      currentCueIds={['cue-3', 'cue-4', 'cue-5']}
      autoFollowPlayback
      onSelection={onSelection}
      onReplay={vi.fn()}
    />);
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
      cueIndex: 4,
      sentence: 'Cue five',
    }));
  });
});
