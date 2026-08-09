import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createVisibleCaptionFallback } from './visible-caption-fallback';

describe('visible caption fallback', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('captures visible YouTube caption segments and ignores consecutive duplicates', () => {
    vi.useFakeTimers();
    document.body.innerHTML = `
      <div class="ytp-caption-window-container">
        <span class="ytp-caption-segment">  Hello </span>
        <span class="ytp-caption-segment">world  </span>
      </div>`;
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => 12_345, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    expect(fallback.captureNow()).toBe(true);
    expect(fallback.captureNow()).toBe(false);
    vi.advanceTimersByTime(350);
    expect(onSnapshotChanged).toHaveBeenCalledTimes(1);
    expect(latestSnapshot()).toEqual({
      cues: [{ id: 'visible-0', startMs: 12_345, endMs: 16_345, text: 'Hello world' }],
      activeGroup: { cueIds: ['visible-0'], startMs: 12_345 },
    });
    vi.useRealTimers();
  });

  it('captures a caption added after the observer starts', async () => {
    vi.useFakeTimers();
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => 2_000, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.start();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Caption appeared';
    document.body.append(segment);

    await vi.advanceTimersByTimeAsync(350);
    expect(latestSnapshot()).toEqual({
      cues: [{ id: 'visible-0', startMs: 2_000, endMs: 6_000, text: 'Caption appeared' }],
      activeGroup: { cueIds: ['visible-0'], startMs: 2_000 },
    });
    fallback.stop();
    vi.useRealTimers();
  });

  it('replaces one active cue while YouTube progressively adds words', () => {
    vi.useFakeTimers();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => 1_000, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = "We've got some";
    fallback.captureNow();
    segment.textContent = "We've got some beautiful";
    fallback.captureNow();
    segment.textContent = "We've got some beautiful looking overnight oats.";
    fallback.captureNow();

    expect(onSnapshotChanged).not.toHaveBeenCalled();
    vi.advanceTimersByTime(350);
    expect(latestSnapshot()!.cues).toEqual([expect.objectContaining({
      id: 'visible-0', text: "We've got some beautiful looking overnight oats.",
    })]);
    vi.useRealTimers();
  });

  it('merges a left-shifted rolling caption by word overlap without repeating text', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = "We've got some beautiful looking overnight oats. Sliced up banana. And we're going to";
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 2_000;
    segment.textContent = "overnight oats. Sliced up banana. And we're going to top it";
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', text: "We've got some beautiful looking overnight oats." }),
      expect.objectContaining({ id: 'visible-1', text: 'Sliced up banana.' }),
      expect.objectContaining({ id: 'visible-2', text: "And we're going to top it" }),
    ]);
    vi.useRealTimers();
  });

  it('merges a one-word rolling overlap without repeating the shared word', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = 'one two three';
    fallback.captureNow();
    currentTimeMs = 2_000;
    segment.textContent = 'three four';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', text: 'one two three four' }),
    ]);
    vi.useRealTimers();
  });

  it('starts a new cue for unrelated text after a 1500 ms gap', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = 'First complete caption.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 2_500;
    segment.textContent = 'A completely unrelated sentence.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', text: 'First complete caption.' }),
      expect.objectContaining({ id: 'visible-1', text: 'A completely unrelated sentence.' }),
    ]);
    vi.useRealTimers();
  });

  it('creates one cue for each completed sentence', () => {
    vi.useFakeTimers();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = "We've got oats. Sliced banana! Really?";
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => 1_000, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', text: "We've got oats." }),
      expect.objectContaining({ id: 'visible-1', text: 'Sliced banana!' }),
      expect.objectContaining({ id: 'visible-2', text: 'Really?' }),
    ]);
    vi.useRealTimers();
  });

  it('updates an unfinished sentence in place while its caption grows', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = "We've got";
    fallback.captureNow();
    currentTimeMs = 1_500;
    segment.textContent = "We've got oats";
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', startMs: 1_000, text: "We've got oats" }),
    ]);
    vi.useRealTimers();
  });

  it('does not duplicate completed text after captions shift left', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = "We've got oats. Sliced banana! And we're";
    fallback.captureNow();
    currentTimeMs = 2_000;
    segment.textContent = "oats. Sliced banana! And we're ready";
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', text: "We've got oats." }),
      expect.objectContaining({ id: 'visible-1', text: 'Sliced banana!' }),
      expect.objectContaining({ id: 'visible-2', text: "And we're ready" }),
    ]);
    vi.useRealTimers();
  });

  it('starts a new cue when an unfinished caption has been active for 12000 ms', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = 'This sentence keeps';
    fallback.captureNow();
    currentTimeMs = 13_000;
    segment.textContent = 'This sentence keeps growing';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.cues).toEqual([
      expect.objectContaining({ id: 'visible-0', startMs: 1_000, endMs: 13_000, text: 'This sentence keeps' }),
      expect.objectContaining({ id: 'visible-1', startMs: 13_000, text: 'growing' }),
    ]);
    vi.useRealTimers();
  });

  it('emits every sentence in one visible block as one non-zero active group', () => {
    vi.useFakeTimers();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'The rice patties are absolutely incredible. Stunning. They have a backdrop of incredible mountains, which is just so unique.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => 10_000, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);

    const snapshot = latestSnapshot()!;
    expect(snapshot.cues.map((cue: { text: string }) => cue.text)).toEqual([
      'The rice patties are absolutely incredible.',
      'Stunning.',
      'They have a backdrop of incredible mountains, which is just so unique.',
    ]);
    expect(snapshot.cues.every((cue: { startMs: number; endMs: number }) => cue.endMs > cue.startMs)).toBe(true);
    expect(snapshot.activeGroup).toEqual({ cueIds: ['visible-0', 'visible-1', 'visible-2'], startMs: 10_000 });
    vi.useRealTimers();
  });

  it('preserves a progressive block start and starts unrelated text at the new time', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    segment.textContent = 'We have';
    fallback.captureNow();
    currentTimeMs = 2_000;
    segment.textContent = 'We have beautiful rice patties.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    expect(latestSnapshot()!.activeGroup.startMs).toBe(1_000);

    currentTimeMs = 5_000;
    segment.textContent = 'A completely unrelated sentence.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    expect(latestSnapshot()!.activeGroup.startMs).toBe(5_000);
    vi.useRealTimers();
  });

  it('clears a blank block and gives repeated later text a new group start', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Repeated sentence.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);
    expect(latestSnapshot()!.activeGroup.startMs).toBe(1_000);

    currentTimeMs = 2_000;
    segment.textContent = '';
    expect(fallback.captureNow()).toBe(true);
    vi.advanceTimersByTime(350);
    expect(latestSnapshot()!.activeGroup).toBeUndefined();

    currentTimeMs = 6_000;
    segment.textContent = 'Repeated sentence.';
    expect(fallback.captureNow()).toBe(true);
    vi.advanceTimersByTime(350);
    const snapshot = latestSnapshot()!;
    expect(snapshot.cues).toContainEqual(expect.objectContaining({
      id: 'visible-1',
      startMs: 6_000,
      text: 'Repeated sentence.',
    }));
    const freshCue = snapshot.cues.find((cue: { id: string }) => cue.id === 'visible-1')!;
    expect(freshCue.endMs).toBeGreaterThan(freshCue.startMs);
    expect(snapshot.activeGroup).toEqual({ cueIds: ['visible-1'], startMs: 6_000 });
    vi.useRealTimers();
  });

  it('prefers an exact visible cue over a newer containing historical cue', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Go. Go now.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 1_500;
    segment.textContent = 'Go.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    expect(latestSnapshot()!.activeGroup).toEqual({ cueIds: ['visible-0'], startMs: 1_000 });
    vi.useRealTimers();
  });

  it('reuses the reconciled cue when a blank is followed by new text', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'First.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 2_000;
    segment.textContent = '';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 6_000;
    segment.textContent = 'Different.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    const snapshot = latestSnapshot()!;
    const differentCues = snapshot.cues.filter((cue: { text: string }) => cue.text === 'Different.');
    expect(snapshot.cues).toHaveLength(2);
    expect(differentCues).toEqual([expect.objectContaining({ id: 'visible-1', startMs: 6_000 })]);
    expect(snapshot.activeGroup).toEqual({ cueIds: ['visible-1'], startMs: 6_000 });
    vi.useRealTimers();
  });

  it('creates a fully fresh active group for mixed repeated and new text after a blank', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Alpha. Beta.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 2_000;
    segment.textContent = '';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 6_000;
    segment.textContent = 'Beta. Gamma.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    const snapshot = latestSnapshot()!;
    const activeGroup = snapshot.activeGroup!;
    const activeCues = activeGroup.cueIds.map((id: string) => (
      snapshot.cues.find((cue: { id: string }) => cue.id === id)!
    ));
    expect(activeGroup.startMs).toBe(6_000);
    expect(activeGroup.cueIds).toHaveLength(2);
    expect(Number(activeGroup.cueIds[1].replace('visible-', ''))).toBe(
      Number(activeGroup.cueIds[0].replace('visible-', '')) + 1,
    );
    expect(activeCues.map((cue: { text: string }) => cue.text)).toEqual(expect.arrayContaining(['Beta.', 'Gamma.']));
    expect(snapshot.cues.filter((cue: { text: string }) => cue.text === 'Gamma.')).toHaveLength(1);
    expect(activeCues.every((cue: { startMs: number; endMs: number }) => (
      cue.startMs === 6_000 && cue.endMs > cue.startMs
    ))).toBe(true);
    vi.useRealTimers();
  });

  it('creates exactly two fresh active cues for two identical sentences after a blank', () => {
    vi.useFakeTimers();
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Repeat. Repeat.';
    document.body.append(segment);
    const onSnapshotChanged = vi.fn();
    const fallback = createVisibleCaptionFallback({ document, getCurrentTimeMs: () => currentTimeMs, onSnapshotChanged });
    const latestSnapshot = () => onSnapshotChanged.mock.calls.at(-1)?.[0];

    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 2_000;
    segment.textContent = '';
    fallback.captureNow();
    vi.advanceTimersByTime(350);
    currentTimeMs = 6_000;
    segment.textContent = 'Repeat. Repeat.';
    fallback.captureNow();
    vi.advanceTimersByTime(350);

    const snapshot = latestSnapshot()!;
    const activeGroup = snapshot.activeGroup!;
    const freshCues = snapshot.cues.filter((cue: { startMs: number }) => cue.startMs === 6_000);
    expect(snapshot.cues.map((cue: { id: string; startMs: number; text: string }) => ({
      id: cue.id,
      startMs: cue.startMs,
      text: cue.text,
    }))).toEqual([
      { id: 'visible-0', startMs: 1_000, text: 'Repeat.' },
      { id: 'visible-1', startMs: 1_000, text: 'Repeat.' },
      { id: 'visible-2', startMs: 6_000, text: 'Repeat.' },
      { id: 'visible-3', startMs: 6_000, text: 'Repeat.' },
    ]);
    expect(freshCues).toHaveLength(2);
    expect(activeGroup).toEqual({ cueIds: ['visible-2', 'visible-3'], startMs: 6_000 });
    expect(new Set(activeGroup.cueIds).size).toBe(2);
    expect(Number(activeGroup.cueIds[1].replace('visible-', ''))).toBe(
      Number(activeGroup.cueIds[0].replace('visible-', '')) + 1,
    );
    expect(freshCues.map((cue: { id: string }) => cue.id)).toEqual(activeGroup.cueIds);
    expect(freshCues.every((cue: { startMs: number; endMs: number }) => (
      cue.startMs === activeGroup.startMs && cue.endMs > cue.startMs
    ))).toBe(true);
    vi.useRealTimers();
  });
});
