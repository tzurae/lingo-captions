import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createRenderedCaptionProgressMonitor } from './rendered-caption-progress-monitor';

describe('rendered caption progress monitor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('emits only active progressive text, preserves its identity, and clears on blank', () => {
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Hello';
    document.body.append(segment);
    const onProgressChanged = vi.fn();
    const monitor = createRenderedCaptionProgressMonitor({
      document,
      getCurrentTimeMs: () => currentTimeMs,
      onProgressChanged,
    });

    expect(monitor.captureNow()).toBe(true);
    expect(onProgressChanged).toHaveBeenLastCalledWith({
      capturedAtMs: 1_000,
      cues: [{ id: 'progress-0', startMs: 1_000, endMs: 1_001, text: 'Hello' }],
      activeGroup: { cueIds: ['progress-0'], startMs: 1_000 },
    });

    currentTimeMs = 1_500;
    segment.textContent = 'Hello world';
    expect(monitor.captureNow()).toBe(true);
    expect(onProgressChanged).toHaveBeenLastCalledWith({
      capturedAtMs: 1_500,
      cues: [{ id: 'progress-0', startMs: 1_000, endMs: 1_501, text: 'Hello world' }],
      activeGroup: { cueIds: ['progress-0'], startMs: 1_000 },
    });

    segment.textContent = '';
    expect(monitor.captureNow()).toBe(true);
    expect(onProgressChanged).toHaveBeenLastCalledWith({ capturedAtMs: 1_500, cues: [] });
  });

  it('emits the exact rolling snapshot without accumulating historical words', () => {
    let currentTimeMs = 1_000;
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'one two three';
    document.body.append(segment);
    const onProgressChanged = vi.fn();
    const monitor = createRenderedCaptionProgressMonitor({
      document,
      getCurrentTimeMs: () => currentTimeMs,
      onProgressChanged,
    });

    monitor.captureNow();
    currentTimeMs = 2_000;
    segment.textContent = 'three four';
    monitor.captureNow();

    expect(onProgressChanged).toHaveBeenLastCalledWith({
      capturedAtMs: 2_000,
      cues: [{ id: 'progress-1', startMs: 2_000, endMs: 2_001, text: 'three four' }],
      activeGroup: { cueIds: ['progress-1'], startMs: 2_000 },
    });
  });
});
