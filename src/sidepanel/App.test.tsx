import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CaptionCue, ContentMessage, PublicSettings } from '../domain/types';
import { defaultPromptTemplates } from '../llm/prompt-templates';
import { App } from './App';
import * as messageClient from './message-client';

vi.mock('./message-client', () => ({
  getSettings: vi.fn(),
  runQuery: vi.fn(),
  saveHistory: vi.fn(),
  toggleFavorite: vi.fn(),
}));

vi.mock('./components/TranscriptPanel', () => ({
  TranscriptPanel: ({ cues, onSelection, onReplay, currentCueIds = [], autoFollowPlayback }: {
    cues: CaptionCue[];
    onSelection: (selection: { selectedText: string; cueIndex: number; sentence: string; anchor: { x: number; y: number } }) => void;
    onReplay: (cue: CaptionCue) => void;
    currentCueIds: string[];
    autoFollowPlayback: boolean;
  }) => <>
    <div data-testid="transcript-cues">{cues.map((cue) => cue.text).join(' ')}</div>
    <button type="button" onClick={() => onSelection({ selectedText: 'selected phrase', cueIndex: 0, sentence: 'A selected phrase.', anchor: { x: 10, y: 20 } })}>Select transcript text</button>
    <button type="button" onClick={() => onSelection({ selectedText: 'middle phrase', cueIndex: 1, sentence: 'Stale sentence.', anchor: { x: 10, y: 20 } })}>Select middle transcript text</button>
    <button type="button" onClick={() => cues[0] && onReplay(cues[0])}>Replay first cue</button>
    <button type="button" onClick={() => cues[1] && onReplay(cues[1])}>Replay second cue</button>
    <output data-testid="current-cues">{currentCueIds.join(',') || 'none'}</output>
    <output data-testid="auto-follow">{String(autoFollowPlayback)}</output>
  </>,
}));

let onMessage: ((message: ContentMessage, sender?: chrome.runtime.MessageSender) => void) | undefined;
let registeredListeners: Array<(message: ContentMessage, sender?: chrome.runtime.MessageSender) => void>;
let onStorageChanged: ((changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => void) | undefined;
let previousUrl: string;

const publicSettings: PublicSettings = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  outputLanguage: '繁體中文',
  detailLevel: 'normal',
  contextLines: 1,
  fontSize: 16,
  textColor: '#111111',
  activeCueColor: '#eeeeee',
  autoFollowPlayback: true,
  prompts: defaultPromptTemplates,
  hasApiKey: true,
  apiKeyLastFour: '1234',
};

describe('App history actions', () => {
  beforeEach(() => {
    previousUrl = window.location.href;
    vi.clearAllMocks();
    onMessage = undefined;
    onStorageChanged = undefined;
    registeredListeners = [];
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener) => { onMessage = listener; registeredListeners.push(listener); }),
            removeListener: vi.fn(),
          },
        },
        storage: {
          onChanged: {
            addListener: vi.fn((listener) => { onStorageChanged = listener; }),
            removeListener: vi.fn(),
          },
        },
      },
    });
    vi.mocked(messageClient.getSettings).mockResolvedValue(publicSettings);
    vi.mocked(messageClient.runQuery).mockResolvedValue({
      result: { answer: 'Answer', model: 'gpt-5.2', createdAt: 10 },
      history: {
        id: 'auto-saved-history-1', createdAt: 10, videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
        request: { intent: 'translate_sentence', selectedText: 'selected phrase', sentence: 'A selected phrase.', contextBefore: [], contextAfter: [], outputLanguage: 'Traditional Chinese', detailLevel: 'normal' },
        result: { answer: 'Answer', model: 'gpt-5.2', createdAt: 10 }, isFavorite: false,
      },
      historySaved: true,
    });
    vi.mocked(messageClient.saveHistory).mockResolvedValue(undefined);
    vi.mocked(messageClient.toggleFavorite).mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.history.replaceState({}, '', previousUrl);
  });

  it('reloads global settings after a local storage change and removes the listener on unmount', async () => {
    const refreshedSettings: PublicSettings = {
      ...publicSettings,
      outputLanguage: '日文',
      fontSize: 22,
      autoFollowPlayback: false,
    };
    vi.mocked(messageClient.getSettings)
      .mockResolvedValueOnce(publicSettings)
      .mockResolvedValueOnce(refreshedSettings);

    const { unmount } = render(<App />);
    await waitFor(() => expect(messageClient.getSettings).toHaveBeenCalledTimes(1));

    await act(async () => onStorageChanged?.({}, 'sync'));
    expect(messageClient.getSettings).toHaveBeenCalledTimes(1);

    await act(async () => onStorageChanged?.({ outputLanguage: { oldValue: '繁體中文', newValue: '日文' } }, 'local'));
    await waitFor(() => expect(messageClient.getSettings).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('main')).toHaveStyle({ '--font-size': '22px' });
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');

    unmount();
    expect(chrome.storage.onChanged.removeListener).toHaveBeenCalledWith(onStorageChanged);
  });

  it('does not present default API-key state when settings fail to load and retries on focus', async () => {
    const user = userEvent.setup();
    const recoveredSettings = { ...publicSettings, fontSize: 22, apiKeyLastFour: '9876' };
    vi.mocked(messageClient.getSettings)
      .mockRejectedValueOnce(new Error('The extension service worker is restarting.'))
      .mockResolvedValueOnce(recoveredSettings);

    render(<App />);
    await waitFor(() => expect(messageClient.getSettings).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole('tab', { name: '設定' }));

    expect(screen.getByRole('alert')).toHaveTextContent('設定讀取失敗');
    expect(screen.queryByText('尚未儲存')).not.toBeInTheDocument();

    fireEvent.focus(window);

    await waitFor(() => expect(messageClient.getSettings).toHaveBeenCalledTimes(2));
    expect(await screen.findByText('已儲存（結尾 ••••9876）')).toBeInTheDocument();
    expect(screen.getByRole('main')).toHaveStyle({ '--font-size': '22px' });
  });

  it('reloads an invalidated side-panel context only once', async () => {
    const reloadPage = vi.fn();
    vi.mocked(messageClient.getSettings).mockRejectedValue(new Error('Extension context invalidated.'));

    render(<App reloadPage={reloadPage} />);

    await waitFor(() => expect(reloadPage).toHaveBeenCalledOnce());
    fireEvent.focus(window);
    await waitFor(() => expect(messageClient.getSettings).toHaveBeenCalledTimes(2));
    expect(reloadPage).toHaveBeenCalledOnce();
  });

  it('does not start a query before authoritative settings are loaded', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.getSettings).mockReturnValue(new Promise(() => undefined));

    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(messageClient.runQuery).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('設定尚未載入完成');
  });

  it('does not save a completed query again and favorites its auto-saved record', async () => {
    const user = userEvent.setup();
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());
    await act(async () => onMessage?.({ type: 'CAPTIONS_UPDATED', videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1', track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] } }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));
    await screen.findByText('Answer');

    expect(messageClient.saveHistory).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Query saved' })).toBeDisabled();

    await user.click(screen.getByRole('button', { name: 'Add favorite' }));
    expect(messageClient.toggleFavorite).toHaveBeenCalledWith('auto-saved-history-1', true);
    expect(screen.getByRole('button', { name: 'Remove favorite' })).toBeInTheDocument();
  });

  it('requests the active tab state when the tabs API is available', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-2',
      videoTitle: 'Video two',
      videoUrl: 'https://youtube.test/watch?v=video-2',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [] },
    });
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);

    await waitFor(() => expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true }));
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' });
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('true');
  });

  it('seeks to the exact start of a replayed cue in the active tab', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 1_000, endMs: 2_000, text: 'A replayable sentence.' }] },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'SEEK_TO_TIME', timeMs: 1_000 });
  });

  it('seeks to the exact zero start of a replayed cue', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'An initial sentence.' }] },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'SEEK_TO_TIME', timeMs: 0 });
  });

  it('keeps every visible-DOM group cue current after playback updates', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    const visibleCues = [
      { id: 'visible-0', startMs: 10_000, endMs: 14_000, text: 'First visible sentence.' },
      { id: 'visible-1', startMs: 10_000, endMs: 14_000, text: 'Second visible sentence.' },
      { id: 'visible-2', startMs: 10_000, endMs: 14_000, text: 'Third visible sentence.' },
    ];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: visibleCues,
        activeGroup: { cueIds: ['visible-0', 'visible-1', 'visible-2'], startMs: 10_000 },
      },
    }));
    await act(async () => listener({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      currentTimeMs: 20_000,
    }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('visible-0,visible-1,visible-2');
  });

  it('uses group start for active visible cues and cue start for inactive visible cues', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: [
          { id: 'visible-old', startMs: 2_000, endMs: 6_000, text: 'Historical sentence.' },
          { id: 'visible-1', startMs: 10_100, endMs: 14_000, text: 'Second visible sentence.' },
          { id: 'visible-2', startMs: 10_200, endMs: 14_000, text: 'Third visible sentence.' },
        ],
        activeGroup: { cueIds: ['visible-1', 'visible-2'], startMs: 10_000 },
      },
    }));

    await user.click(screen.getByRole('button', { name: 'Replay second cue' }));
    expect(sendMessage).toHaveBeenLastCalledWith(42, {
      type: 'SEEK_TO_TIME',
      timeMs: 10_000,
    });

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));
    expect(sendMessage).toHaveBeenLastCalledWith(42, {
      type: 'SEEK_TO_TIME',
      timeMs: 2_000,
    });
  });

  it('sanitizes visible groups and clears them when the selected video changes', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    const visibleCues = [
      { id: 'visible-0', startMs: 10_000, endMs: 14_000, text: 'First visible sentence.' },
      { id: 'visible-1', startMs: 10_000, endMs: 14_000, text: 'Second visible sentence.' },
      { id: 'visible-2', startMs: 10_000, endMs: 14_000, text: 'Third visible sentence.' },
    ];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: visibleCues,
        activeGroup: {
          cueIds: ['missing', 'visible-1', 'visible-1', 'visible-2'],
          startMs: 10_000,
        },
      },
    }));
    expect(screen.getByTestId('current-cues')).toHaveTextContent('visible-1,visible-2');

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: visibleCues,
        activeGroup: { cueIds: ['visible-0', 'visible-2'], startMs: 10_000 },
      },
    }));
    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: visibleCues,
        activeGroup: { cueIds: ['visible-0', 'visible-1'], startMs: 10_000 },
      },
    }));
    expect(screen.getByTestId('current-cues')).toHaveTextContent('visible-0,visible-1');

    await act(async () => listener({
      type: 'VIDEO_CHANGED',
      videoId: 'video-2',
      videoTitle: 'Video two',
      videoUrl: 'https://youtube.test/watch?v=video-2',
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
  });

  it('clears a visible group when captions become unavailable', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'visible-dom',
        cues: [
          { id: 'visible-0', startMs: 10_000, endMs: 14_000, text: 'First visible sentence.' },
          { id: 'visible-1', startMs: 10_000, endMs: 14_000, text: 'Second visible sentence.' },
        ],
        activeGroup: { cueIds: ['visible-0', 'visible-1'], startMs: 10_000 },
      },
    }));
    expect(screen.getByTestId('current-cues')).not.toHaveTextContent('none');

    await act(async () => listener({
      type: 'NO_CAPTIONS',
      videoId: 'video-1',
      reason: 'not-found',
    }));
    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
  });

  it('keeps the floating assistant open and shows loading while a query is pending', async () => {
    const user = userEvent.setup();
    let resolveQuery: (value: Awaited<ReturnType<typeof messageClient.runQuery>>) => void = () => undefined;
    vi.mocked(messageClient.runQuery).mockReturnValueOnce(new Promise((resolve) => { resolveQuery = resolve; }));
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
    }));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));

    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();
    expect(screen.getByText('正在取得回答…').closest('[role="status"]')).toBeInTheDocument();
    expect(screen.getByText('Requested model: gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('Effort: low')).toBeInTheDocument();
    expect(messageClient.runQuery).toHaveBeenCalledWith(expect.objectContaining({ selectedText: 'selected phrase', sentence: 'A selected phrase.' }), expect.any(Object));
    await act(async () => resolveQuery({ result: { answer: 'Answer', model: 'gpt-5.2', createdAt: 10 }, historySaved: false }));
    expect(await screen.findByText('Answer')).toBeInTheDocument();
  });

  it('does not let an older query overwrite a newer transcript selection', async () => {
    const user = userEvent.setup();
    let resolveOldQuery: (value: Awaited<ReturnType<typeof messageClient.runQuery>>) => void = () => undefined;
    vi.mocked(messageClient.runQuery)
      .mockReturnValueOnce(new Promise((resolve) => { resolveOldQuery = resolve; }))
      .mockResolvedValueOnce({ result: { answer: 'New answer', model: 'gpt-5.2', createdAt: 20 }, historySaved: false });
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' },
          { id: 'cue-2', startMs: 1000, endMs: 2000, text: 'A middle phrase.' },
        ],
      },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));
    await user.click(screen.getByRole('button', { name: 'Select middle transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(await screen.findByText('New answer')).toBeInTheDocument();
    await act(async () => resolveOldQuery({ result: { answer: 'Old answer', model: 'gpt-5.2', createdAt: 10 }, historySaved: false }));
    expect(screen.getByText('New answer')).toBeInTheDocument();
    expect(screen.queryByText('Old answer')).not.toBeInTheDocument();
  });

  it('ignores a pending response after the floating assistant is closed', async () => {
    const user = userEvent.setup();
    let resolveQuery: (value: Awaited<ReturnType<typeof messageClient.runQuery>>) => void = () => undefined;
    vi.mocked(messageClient.runQuery).mockReturnValueOnce(new Promise((resolve) => { resolveQuery = resolve; }));
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));
    await user.click(screen.getByRole('button', { name: 'Close selection menu' }));
    await act(async () => resolveQuery({ result: { answer: 'Late answer', model: 'gpt-5.2', createdAt: 10 }, historySaved: false }));

    expect(screen.queryByRole('dialog', { name: 'English learning assistant' })).not.toBeInTheDocument();
    expect(screen.queryByText('Late answer')).not.toBeInTheDocument();
  });

  it('refreshes captions from the active tab without starting a query or saving history', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    let resolveRefresh: (message: ContentMessage) => void = () => undefined;
    const refreshResponse = new Promise<ContentMessage>((resolve) => { resolveRefresh = resolve; });
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockReturnValueOnce(refreshResponse);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));

    await user.click(screen.getByRole('button', { name: '重新抓取字幕' }));
    expect(screen.getByText('正在重新抓取字幕…')).toBeInTheDocument();
    expect(messageClient.runQuery).not.toHaveBeenCalled();
    expect(messageClient.saveHistory).not.toHaveBeenCalled();

    await act(async () => resolveRefresh({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-refresh',
      videoTitle: 'Refreshed video',
      videoUrl: 'https://youtube.test/watch?v=video-refresh',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-refresh', startMs: 0, endMs: 1000, text: 'Refreshed transcript.' }] },
    }));

    await waitFor(() => expect(screen.getByTestId('transcript-cues')).toHaveTextContent('Refreshed transcript.'));
    expect(screen.queryByText('正在重新抓取字幕…')).not.toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it('shows a clear error when refreshing the active tab fails', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('The active tab is unavailable.'));
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await user.click(screen.getByRole('button', { name: '重新抓取字幕' }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('重新抓取字幕失敗：The active tab is unavailable.'));
    expect(screen.queryByText('正在重新抓取字幕…')).not.toBeInTheDocument();
    expect(messageClient.runQuery).not.toHaveBeenCalled();
  });

  it('shows and expands an exact caption pipeline diagnostic', async () => {
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());

    await act(async () => onMessage?.({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      diagnostic: {
        stage: 'timedtext-parse',
        status: 'error',
        code: 'CAPTION_PARSE_EMPTY',
        message: '字幕檔下載成功，但解析不到任何字幕內容。',
      },
    }));

    expect(screen.getAllByText('字幕檔下載成功，但解析不到任何字幕內容。')).toHaveLength(2);
    expect(screen.getByText('字幕診斷（1）').closest('details')).toHaveAttribute('open');
  });

  it('does not swallow an initial content-script connection failure', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('無法連線到 YouTube 字幕腳本');
    expect(screen.getByText('請在 YouTube 分頁按 Ctrl+Shift+R，再重新抓取字幕。')).toBeVisible();
  });

  it('ignores cues and playback from a runtime sender in a different tab', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);

    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    const foreignSender = { tab: { id: 43 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'foreign-video',
      videoTitle: 'Foreign video',
      videoUrl: 'https://youtube.test/watch?v=foreign-video',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'foreign-cue', startMs: 0, endMs: 1000, text: 'Foreign cue.' }] },
    }, foreignSender));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'foreign-video', currentTimeMs: 500 }, foreignSender));

    expect(screen.getByRole('alert')).toHaveTextContent('Open an available YouTube tab to load captions.');
    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
  });

  it('does not require the tabs API to render in tests', () => {
    expect(() => render(<App />)).not.toThrow();
  });

  it('uses the latest cues when an existing runtime listener receives playback updates', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' },
          { id: 'cue-2', startMs: 1000, endMs: 2000, text: 'Second cue.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 1500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-2');
  });

  it('refines a timed Current Reading Segment with rendered progress without changing its identity', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First sentence.' },
          { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Current sentence.' },
          { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Future sentence.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 1_500 }));
    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      progress: {
        capturedAtMs: 1_500,
        cues: [{ id: 'rendered-1', startMs: 1_400, endMs: 1_900, text: 'Current' }],
        activeGroup: { cueIds: ['rendered-1'], startMs: 1_400 },
      },
    }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-2');
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('First sentence. Current Future sentence.');

    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      progress: {
        capturedAtMs: 1_500,
        cues: [{ id: 'rendered-2', startMs: 1_500, endMs: 1_900, text: 'Unrelated' }],
        activeGroup: { cueIds: ['rendered-2'], startMs: 1_500 },
      },
    }));
    expect(screen.getByText('CAPTION_PROGRESS_ALIGNMENT_FAILED')).toBeInTheDocument();
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('First sentence. Current sentence. Future sentence.');
  });

  it('selects the latest cue when fallback cue time ranges overlap', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
        source: 'timedtext',
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 4000, text: 'Earlier rolling cue.' },
          { id: 'cue-2', startMs: 2000, endMs: 6000, text: 'Latest rolling cue.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 2500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-2');
  });

  it('rebinds the side panel when the active Chrome tab changes and ignores the old tab', async () => {
    let onActivated: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    const query = vi.fn().mockResolvedValue([{ id: 1 }]);
    const sendMessage = vi.fn((tabId: number) => Promise.resolve(tabId === 1 ? {
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-a', startMs: 0, endMs: 1000, text: 'Caption from A.' }] },
    } : {
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-b',
      videoTitle: 'Video B',
      videoUrl: 'https://youtube.test/watch?v=video-b',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-b', startMs: 0, endMs: 1000, text: 'Caption from B.' }] },
    }));
    Object.assign(globalThis.chrome, {
      tabs: {
        query,
        sendMessage,
        onActivated: {
          addListener: vi.fn((listener) => { onActivated = listener; }),
          removeListener: vi.fn(),
        },
      },
    });

    render(<App />);
    expect(await screen.findByText('Caption from A.')).toBeInTheDocument();
    await act(async () => onActivated?.({ tabId: 2, windowId: 1 }));
    expect(await screen.findByText('Caption from B.')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(2, { type: 'REQUEST_STATE' });

    const listener = registeredListeners[0];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'stale-a',
      videoTitle: 'Stale A',
      videoUrl: 'https://youtube.test/watch?v=stale-a',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'stale-a', startMs: 0, endMs: 1000, text: 'Stale caption from A.' }] },
    }, { tab: { id: 1 } } as chrome.runtime.MessageSender));

    expect(screen.queryByText('Stale caption from A.')).not.toBeInTheDocument();
    expect(screen.getByText('Caption from B.')).toBeInTheDocument();
  });

  it('keeps replay targeted at the newer active tab when a stale state request resolves late', async () => {
    const user = userEvent.setup();
    let onActivated: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    let resolveInitialQuery: (tabs: Array<{ id: number }>) => void = () => undefined;
    let resolveOldState: ((message: ContentMessage) => void) | undefined;
    const initialQuery = new Promise<Array<{ id: number }>>((resolve) => { resolveInitialQuery = resolve; });
    const oldState = new Promise<ContentMessage>((resolve) => { resolveOldState = resolve; });
    const query = vi.fn().mockReturnValue(initialQuery);
    const sendMessage = vi.fn((tabId: number, message: { type: string }) => {
      if (message.type === 'SEEK_TO_TIME') return Promise.resolve(undefined);
      if (tabId === 1) return oldState;
      return Promise.resolve({
        type: 'CAPTIONS_UPDATED',
        videoId: 'video-b',
        videoTitle: 'Video B',
        videoUrl: 'https://youtube.test/watch?v=video-b',
        track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-b', startMs: 1000, endMs: 2000, text: 'Caption from B.' }] },
    });
  });

    Object.assign(globalThis.chrome, {
      tabs: {
        query,
        sendMessage,
        onActivated: {
          addListener: vi.fn((listener) => { onActivated = listener; }),
          removeListener: vi.fn(),
        },
      },
    });

    render(<App />);
    await waitFor(() => expect(onActivated).toBeDefined());
    await act(async () => onActivated?.({ tabId: 2, windowId: 1 }));
    expect(await screen.findByText('Caption from B.')).toBeInTheDocument();

    await act(async () => resolveInitialQuery([{ id: 1 }]));
    await act(async () => resolveOldState?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-a', startMs: 1000, endMs: 2000, text: 'Caption from A.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(2, { type: 'SEEK_TO_TIME', timeMs: 1_000 });
  });

  it('binds an owned panel to its tab without querying or listening for activation', async () => {
    window.history.replaceState({}, '', '/?tabId=42');
    const query = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue({
      type: 'CAPTIONS_UPDATED',
      videoId: 'owner-video',
      videoTitle: 'Owner video',
      videoUrl: 'https://youtube.test/watch?v=owner-video',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'owner-cue', startMs: 0, endMs: 1000, text: 'Caption from owner.' }] },
    });
    const activated = { addListener: vi.fn(), removeListener: vi.fn() };
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage, onActivated: activated } });

    render(<App />);

    expect(await screen.findByText('Caption from owner.')).toBeInTheDocument();
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' });
    expect(query).not.toHaveBeenCalled();
    expect(activated.addListener).not.toHaveBeenCalled();

    const listener = registeredListeners[0];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'foreign-video',
      videoTitle: 'Foreign video',
      videoUrl: 'https://youtube.test/watch?v=foreign-video',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'foreign-cue', startMs: 0, endMs: 1000, text: 'Caption from foreign tab.' }] },
    }, { tab: { id: 43 } } as chrome.runtime.MessageSender));

    expect(screen.queryByText('Caption from foreign tab.')).not.toBeInTheDocument();
    expect(screen.getByText('Caption from owner.')).toBeInTheDocument();
  });

  it('uses the owner tab for refresh and replay, then removes its listeners on cleanup', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/?tabId=42');
    const query = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn((tabId: number, message: { type: string }) => {
      if (message.type === 'SEEK_TO_TIME') return Promise.resolve(undefined);
      return Promise.resolve({
        type: 'CAPTIONS_UPDATED',
        videoId: 'owner-video',
        videoTitle: 'Owner video',
        videoUrl: 'https://youtube.test/watch?v=owner-video',
        track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'owner-cue', startMs: 1000, endMs: 2000, text: 'Caption from owner.' }] },
      });
    });
    const activated = { addListener: vi.fn(), removeListener: vi.fn() };
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage, onActivated: activated } });

    const { unmount } = render(<App />);
    expect(await screen.findByText('Caption from owner.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重新抓取字幕' }));
    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' });
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'SEEK_TO_TIME', timeMs: 1_000 });
    expect(query).not.toHaveBeenCalled();

    unmount();
    expect(globalThis.chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(registeredListeners[0]);
    expect(globalThis.chrome.storage.onChanged.removeListener).toHaveBeenCalledOnce();
    expect(activated.removeListener).not.toHaveBeenCalled();
  });

  it('accepts a new YouTube video from the same active tab', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-a', startMs: 0, endMs: 1000, text: 'Caption from A.' }] },
    }, sender));
    await act(async () => listener({ type: 'VIDEO_CHANGED', videoId: 'video-b', videoTitle: 'Video B', videoUrl: 'https://youtube.test/watch?v=video-b' }, sender));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-b',
      videoTitle: 'Video B',
      videoUrl: 'https://youtube.test/watch?v=video-b',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-b', startMs: 0, endMs: 1000, text: 'Caption from B.' }] },
    }, sender));

    expect(screen.queryByText('Caption from A.')).not.toBeInTheDocument();
    expect(screen.getByText('Caption from B.')).toBeInTheDocument();
  });

  it('isolates rendered progress across 20 same-tab video switches', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-0',
      videoTitle: 'Video 0',
      videoUrl: 'https://youtube.test/watch?v=video-0',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [{ id: 'cue-0', startMs: 0, endMs: 2_000, text: 'Video 0 complete.' }],
      },
    }, sender));

    for (let index = 1; index <= 20; index += 1) {
      const previousIndex = index - 1;
      await act(async () => listener({
        type: 'VIDEO_CHANGED',
        videoId: `video-${index}`,
        videoTitle: `Video ${index}`,
        videoUrl: `https://youtube.test/watch?v=video-${index}`,
      }, sender));
      await act(async () => listener({
        type: 'CAPTIONS_UPDATED',
        videoId: `video-${index}`,
        videoTitle: `Video ${index}`,
        videoUrl: `https://youtube.test/watch?v=video-${index}`,
        track: {
          language: 'en',
          isEnglish: true,
          source: 'timedtext',
          cues: [{ id: `cue-${index}`, startMs: 0, endMs: 2_000, text: `Video ${index} complete.` }],
        },
      }, sender));
      await act(async () => listener({
        type: 'PLAYBACK_UPDATED',
        videoId: `video-${index}`,
        currentTimeMs: 1_000,
      }, sender));
      await act(async () => listener({
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId: `video-${index}`,
        progress: {
          capturedAtMs: 1_000,
          cues: [{ id: `rendered-${index}`, startMs: 900, endMs: 1_500, text: `Video ${index}` }],
          activeGroup: { cueIds: [`rendered-${index}`], startMs: 900 },
        },
      }, sender));
      await act(async () => listener({
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId: `video-${previousIndex}`,
        progress: {
          capturedAtMs: 1_000,
          cues: [{ id: `stale-${previousIndex}`, startMs: 900, endMs: 1_500, text: 'Stale progress' }],
          activeGroup: { cueIds: [`stale-${previousIndex}`], startMs: 900 },
        },
      }, sender));
    }

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-20');
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('Video 20');
    expect(screen.getByTestId('transcript-cues')).not.toHaveTextContent('Stale progress');
  });

  it('ignores playback from a video other than the selected video', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' }] },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-2', currentTimeMs: 500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
  });

  it('does not let rendered progress claim a video before its Caption Track arrives', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'stale-video',
      progress: {
        capturedAtMs: 0,
        cues: [{ id: 'stale-progress', startMs: 0, endMs: 1_000, text: 'Stale progress.' }],
        activeGroup: { cueIds: ['stale-progress'], startMs: 0 },
      },
    }));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First cue.' }],
      },
    }));

    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('First cue.');
  });

  it('ignores stale caption, navigation, and no-caption state from another video', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' }] },
    }));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', videoId: 'video-2', videoTitle: 'Video two', videoUrl: 'https://youtube.test/watch?v=video-2',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'stale-cue', startMs: 0, endMs: 1000, text: 'Stale cue.' }] },
    }));
    await act(async () => listener({ type: 'VIDEO_CHANGED', videoId: 'video-2', videoTitle: 'Video two', videoUrl: 'https://youtube.test/watch?v=video-2' }));
    await act(async () => listener({ type: 'NO_CAPTIONS', videoId: 'video-2', reason: 'not-found' }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-1');
    expect(screen.queryByText('No English captions are available for this video.')).not.toBeInTheDocument();
  });

  it('builds query context from the selected cue', async () => {
    const user = userEvent.setup();
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
        source: 'timedtext',
        cues: [
          { id: 'cue-3', startMs: 2000, endMs: 3000, text: 'Third cue.' },
          { id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' },
          { id: 'cue-2', startMs: 1000, endMs: 2000, text: 'Second cue.' },
        ],
      },
    }));

    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('First cue. Second cue. Third cue.');

    await user.click(screen.getByRole('button', { name: 'Select middle transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    await waitFor(() => expect(messageClient.runQuery).toHaveBeenCalledWith(expect.objectContaining({
      selectedText: 'middle phrase',
      sentence: 'Second cue.',
      contextBefore: ['First cue.'],
      contextAfter: ['Third cue.'],
    }), expect.objectContaining({ subtitlePosition: { startMs: 1000, endMs: 2000 } })));
  });

  it('displays a history warning while keeping an unsaved result non-favoritable', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.runQuery).mockResolvedValueOnce({
      result: { answer: 'Answer despite storage failure', model: 'gpt-5.2', createdAt: 10 },
      historySaved: false,
      historyWarning: 'Answer completed, but it could not be saved to history.',
    });
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://www.youtube.com/watch?v=video-1',
      track: { language: 'en', isEnglish: true, source: 'timedtext', cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(await screen.findByText('Answer despite storage failure')).toBeInTheDocument();
    expect(screen.getByText('Answer completed, but it could not be saved to history.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add favorite' })).toBeDisabled();
  });
});
