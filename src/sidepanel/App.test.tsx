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
  TranscriptPanel: ({
    cues,
    studySentences = cues,
    studySentenceIndexByProjectedId = {},
    onSelection,
    onPlaybackAction,
    onBrowseEarlierTranscript,
    currentCueIds = [],
    autoFollowPlayback,
    studySentenceId,
    focusRequest,
  }: {
    cues: CaptionCue[];
    studySentences?: CaptionCue[];
    studySentenceIndexByProjectedId?: Record<string, number>;
    onSelection: (selection: { selectedText: string; studySentenceIndex: number; sentence: string; anchor: { x: number; y: number } }) => void;
    onPlaybackAction: (action: 'jump' | 'replay' | 'play-from-here', cue: CaptionCue) => void;
    onBrowseEarlierTranscript?: () => void;
    currentCueIds: string[];
    autoFollowPlayback: boolean;
    studySentenceId?: string;
    focusRequest?: { cueId: string; version: number };
  }) => <>
    <div data-testid="transcript-cues">{cues.map((cue) => cue.text).join(' ')}</div>
    <button type="button" onClick={() => onSelection({ selectedText: 'selected phrase', studySentenceIndex: 0, sentence: 'A selected phrase.', anchor: { x: 10, y: 20 } })}>Select transcript text</button>
    <button type="button" onClick={() => onSelection({ selectedText: 'middle phrase', studySentenceIndex: 1, sentence: 'Stale sentence.', anchor: { x: 10, y: 20 } })}>Select middle transcript text</button>
    <button type="button" data-focused-study-action="preserve" onClick={() => cues[0] && onPlaybackAction('replay', cues[0])}>Replay first cue</button>
    <button type="button" data-focused-study-action="preserve" onClick={() => cues[1] && onPlaybackAction('replay', cues[1])}>Replay second cue</button>
    <button type="button" data-focused-study-action="preserve" onClick={() => cues[0] && onPlaybackAction('jump', cues[0])}>Jump first cue</button>
    <button type="button" onClick={() => cues[0] && onPlaybackAction('play-from-here', cues[0])}>Play from first cue</button>
    <button type="button" onClick={() => cues[0] && onSelection({
      selectedText: cues[0].text,
      studySentenceIndex: 0,
      sentence: cues[0].text,
      anchor: { x: 10, y: 20 },
    })}>Study first cue</button>
    <button type="button" onClick={() => onBrowseEarlierTranscript?.()}>Browse earlier transcript</button>
    <output data-testid="current-cues">{currentCueIds.join(',') || 'none'}</output>
    <output data-testid="auto-follow">{String(autoFollowPlayback)}</output>
    <output data-testid="study-sentence">{studySentenceId ?? 'none'}</output>
    <output data-testid="study-sentences">{studySentences.map((sentence) => sentence.id).join(' ')}</output>
    <output data-testid="study-sentence-map">{JSON.stringify(studySentenceIndexByProjectedId)}</output>
    <output data-testid="focus-request">{focusRequest ? `${focusRequest.cueId}:${focusRequest.version}` : 'none'}</output>
  </>,
}));

type MessageListener = (message: ContentMessage, sender?: chrome.runtime.MessageSender) => void;

let onMessage: MessageListener | undefined;
let registeredListeners: MessageListener[];
let runtimeMessageListener: MessageListener | undefined;
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

const readyLifecycle = { status: 'ready', message: 'Full transcript ready.' } as const;

describe('App history actions', () => {
  beforeEach(() => {
    previousUrl = window.location.href;
    vi.clearAllMocks();
    onMessage = undefined;
    runtimeMessageListener = undefined;
    onStorageChanged = undefined;
    registeredListeners = [];
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          onMessage: {
            addListener: vi.fn((listener: MessageListener) => {
              runtimeMessageListener = listener;
              onMessage = listener;
              registeredListeners.push(listener);
            }),
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
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
    await act(async () => onMessage?.({ type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-1', synchronizationId: 'sync:video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1', track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] } }));

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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-2',
      synchronizationId: 'video-2',
      videoTitle: 'Video two',
      videoUrl: 'https://youtube.test/watch?v=video-2',
      track: { language: 'en', isEnglish: true, cues: [] },
    });
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);

    await waitFor(() => expect(query).toHaveBeenCalledWith({ active: true, lastFocusedWindow: true }));
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' });
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('true');
  });

  it('sends the exact Replay Range for a timed cue in the active tab', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 1_000, endMs: 2_000, text: 'A replayable sentence.' }] },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'video-1', synchronizationId: 'sync:video-1', startMs: 1_000, endMs: 2_000 });
  });

  it('accepts an exact zero start for a Replay Range', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'An initial sentence.' }] },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'video-1', synchronizationId: 'sync:video-1', startMs: 0, endMs: 1_000 });
  });

  it('sends distinct Jump and Play from Here intents and exits Focused Study', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 1_000, endMs: 2_000, text: 'A historical sentence.' }] },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Jump first cue' }));
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'JUMP_TO_HERE', videoId: 'video-1', synchronizationId: 'sync:video-1', timeMs: 1_000 });
    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'video-1', synchronizationId: 'sync:video-1', startMs: 1_000, endMs: 2_000 });
    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Focused Study controls' })).toBeInTheDocument();
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');
    expect(screen.getByTestId('focus-request')).toHaveTextContent('none');

    await user.click(screen.getByRole('button', { name: 'Play from first cue' }));
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'PLAY_FROM_HERE', videoId: 'video-1', synchronizationId: 'sync:video-1', timeMs: 1_000 });
    expect(screen.queryByRole('dialog', { name: 'English learning assistant' })).not.toBeInTheDocument();
  });

  it('enters Focused Study on selection, pauses playback, and shows the full transcript', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const cues = Array.from({ length: 5 }, (_, index) => ({
      id: `cue-${index + 1}`,
      startMs: index * 1_000,
      endMs: (index + 1) * 1_000,
      text: `Study sentence ${index + 1}.`,
    }));

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));

    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
    expect(screen.getByRole('region', { name: 'Focused Study controls' })).toBeInTheDocument();
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Study sentence 1. Study sentence 2. Study sentence 3. Study sentence 4. Study sentence 5.',
    );
    expect(screen.getByTestId('study-sentence')).toHaveTextContent('study:cue-1:0');
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');
  });

  it('keeps the selected Study Sentence and context fixed when a learning action starts', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const initialCues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Original Study Sentence.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Original context after.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Later sentence.' },
    ];

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: initialCues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { ...initialCues[0], text: 'Mutated Study Sentence.' },
          { ...initialCues[1], text: 'Mutated context after.' },
          initialCues[2],
        ],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    sendMessage.mockClear();

    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
    await waitFor(() => expect(messageClient.runQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        sentence: 'Original Study Sentence.',
        contextAfter: ['Original context after.'],
      }),
      expect.objectContaining({
        subtitlePosition: { startMs: 0, endMs: 1_000 },
      }),
    ));
    expect(screen.getByTestId('study-sentence')).toHaveTextContent('study:cue-1:0');
  });

  it('keeps appended frozen Study Sentence actions bound to that snapshot', async () => {
    const user = userEvent.setup();
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Frozen Study Sentence.' },
          { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Live second sentence.' },
        ],
      },
    }));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));

    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Live second sentence.' }],
      },
    }));

    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Frozen Study Sentence. Live second sentence.',
    );
    expect(screen.getByTestId('study-sentences')).toHaveTextContent(
      'study:cue-1:0 study:cue-2:0',
    );
    expect(screen.getByTestId('study-sentence-map')).toHaveTextContent(
      '{"study:cue-1:0":0,"study:cue-2:0":1}',
    );
  });

  it('returns or resumes from Focused Study with distinct playback intents', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const cues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First sentence.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Current sentence.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Last sentence.' },
    ];

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await act(async () => onMessage?.({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      currentTimeMs: 1_500,
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    sendMessage.mockClear();
    await user.click(screen.getByRole('button', { name: 'Return to Current' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
    expect(screen.queryByRole('region', { name: 'Focused Study controls' })).not.toBeInTheDocument();
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('true');
    expect(screen.getByTestId('focus-request')).toHaveTextContent(/^study:cue-2:0:/);

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    sendMessage.mockClear();
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'RESUME_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
    expect(screen.queryByRole('region', { name: 'Focused Study controls' })).not.toBeInTheDocument();
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('true');
  });

  it('returns to the playback-derived live neighborhood during a caption gap', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]), sendMessage },
    });
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { id: 'cue-before-gap', startMs: 0, endMs: 1_000, text: 'Before gap.' },
          { id: 'cue-after-gap', startMs: 2_000, endMs: 3_000, text: 'After gap.' },
        ],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await act(async () => onMessage?.({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      currentTimeMs: 1_500,
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));

    await user.click(screen.getByRole('button', { name: 'Return to Current' }));

    expect(screen.getByTestId('focus-request')).toHaveTextContent(/^study:cue-before-gap:0:/);
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
  });

  it('returns to the stable Study Sentence row while its current text is transient', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]), sendMessage },
    });
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { id: 'source-1', startMs: 0, endMs: 2_000, text: 'I think' },
          { id: 'source-2', startMs: 0, endMs: 2_000, text: 'we should start.' },
        ],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await act(async () => onMessage?.({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      currentTimeMs: 1_000,
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await act(async () => onMessage?.({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      progress: {
        capturedAtMs: 1_000,
        cues: [{ id: 'rendered-combined', startMs: 900, endMs: 1_500, text: 'I think we should' }],
        activeGroup: { cueIds: ['rendered-combined'], startMs: 900 },
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: 'Return to Current' }));

    expect(screen.getByTestId('focus-request')).toHaveTextContent(/^study:source-1:0:/);
  });

  it('does not clear the saved automatic-follow opt-out during mode transitions', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    vi.mocked(messageClient.getSettings).mockResolvedValue({
      ...publicSettings,
      autoFollowPlayback: false,
    });

    render(<App />);
    await waitFor(() => expect(screen.getByTestId('auto-follow')).toHaveTextContent('false'));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Opted out sentence.' }],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: 'Return to Current' }));
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: 'Resume' }));
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');
  });

  it('keeps Study Sentence and Replay Range fixed across twenty playback and progress events', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const cues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Pinned Study Sentence.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Second sentence.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Third sentence.' },
    ];

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));

    await act(async () => {
      for (let index = 0; index < 20; index += 1) {
        if (index % 2 === 0) {
          listener({
            type: 'PLAYBACK_UPDATED',
            videoId: 'video-1',
            synchronizationId: 'sync:video-1',
            currentTimeMs: 1_000 + index * 25,
          }, { tab: { id: 42 } } as chrome.runtime.MessageSender);
        } else {
          listener({
            type: 'CAPTION_PROGRESS_UPDATED',
            videoId: 'video-1',
            synchronizationId: 'sync:video-1',
            progress: {
              capturedAtMs: 1_000 + index * 25,
              cues: [{ id: `progress-${index}`, startMs: 1_000, endMs: 2_000, text: `Progress ${index}` }],
              activeGroup: { cueIds: [`progress-${index}`], startMs: 1_000 },
            },
          }, { tab: { id: 42 } } as chrome.runtime.MessageSender);
        }
      }
    });

    expect(screen.getByTestId('study-sentence')).toHaveTextContent('study:cue-1:0');
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('Pinned Study Sentence.');
    sendMessage.mockClear();
    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'video-1', synchronizationId: 'sync:video-1', startMs: 0,
    endMs: 1_000, });
  });

  it('keeps history stationary while new segments accumulate behind a persistent return control', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const initialCues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Historical one.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Historical two.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Current three.' },
    ];


    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: initialCues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    sendMessage.mockClear();

    await user.click(screen.getByRole('button', { name: 'Browse earlier transcript' }));
    expect(sendMessage).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Return to Current' })).toBeInTheDocument();
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('false');

    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          ...initialCues,
          { id: 'cue-4', startMs: 3_000, endMs: 4_000, text: 'New four.' },
          { id: 'cue-5', startMs: 4_000, endMs: 5_000, text: 'New five.' },
        ],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    expect(screen.getByRole('region', { name: 'Focused Study controls' })).toHaveTextContent('2 new Study Sentences');
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Historical one. Historical two. Current three. New four. New five.',
    );
    expect(screen.getByTestId('focus-request')).toHaveTextContent('none');
    await user.click(screen.getByRole('button', { name: 'Return to Current' }));
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
  });
  it('retains non-selected historical rows after shrinking updates and Play from Here', async () => {
    const user = userEvent.setup();
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, {
      tabs: { query: vi.fn().mockResolvedValue([{ id: 42 }]), sendMessage },
    });
    const initialCues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Retained one.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Retained two.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Current three.' },
    ];
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: initialCues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await user.click(screen.getByRole('button', { name: 'Browse earlier transcript' }));

    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          initialCues[2],
          { id: 'cue-4', startMs: 3_000, endMs: 4_000, text: 'New four.' },
        ],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Retained one. Retained two. Current three. New four.',
    );

    await user.click(screen.getByRole('button', { name: 'Play from first cue' }));
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Retained one. Retained two. Current three. New four.',
    );
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'PLAY_FROM_HERE', videoId: 'video-1', synchronizationId: 'sync:video-1', timeMs: 0 });
    expect(screen.getByTestId('current-cues')).toHaveTextContent('study:cue-1:0');
    expect(screen.getByTestId('focus-request')).toHaveTextContent(/^study:cue-1:0:/);
  });

  it('keeps a failed query attached to the same Focused Study identity', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.runQuery).mockRejectedValueOnce(new Error('Query failed.'));
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Failure Study Sentence.' }],
      },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Query failed.');
    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Focused Study controls' })).toBeInTheDocument();
    expect(screen.getByTestId('study-sentence')).toHaveTextContent('study:cue-1:0');
  });

  it('plays from a historical row without deleting transcript history and resumes following there', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const cues = [
      { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Play here one.' },
      { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Keep history two.' },
      { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Current three.' },
    ];

    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await act(async () => onMessage?.({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      currentTimeMs: 2_500,
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));
    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    sendMessage.mockClear();

    await user.click(screen.getByRole('button', { name: 'Play from first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PLAY_FROM_HERE', videoId: 'video-1', synchronizationId: 'sync:video-1', timeMs: 0 });
    expect(screen.queryByRole('region', { name: 'Focused Study controls' })).not.toBeInTheDocument();
    expect(screen.getByTestId('auto-follow')).toHaveTextContent('true');
    expect(screen.getByTestId('focus-request')).toHaveTextContent(/^study:cue-1:0:/);
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent(
      'Play here one. Keep history two. Current three.',
    );
  });

  it('supports a keyboard-only Study, AI, Replay, and Return flow', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'cue-1', startMs: 0, endMs: 1_000, text: 'Keyboard Study Sentence.' }],
      },
    }, { tab: { id: 42 } } as chrome.runtime.MessageSender));

    screen.getByRole('button', { name: 'Study first cue' }).focus();
    await user.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });

    screen.getByRole('button', { name: '翻譯整句' }).focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Answer')).toBeInTheDocument();

    screen.getByRole('button', { name: 'Replay first cue' }).focus();
    await user.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenLastCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'video-1', synchronizationId: 'sync:video-1', startMs: 0,
    endMs: 1_000, });
    expect(screen.getByRole('region', { name: 'Focused Study controls' })).toBeInTheDocument();

    sendMessage.mockClear();
    screen.getByRole('button', { name: 'Return to Current' }).focus();
    await user.keyboard('{Enter}');
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'PAUSE_PLAYBACK', videoId: 'video-1', synchronizationId: 'sync:video-1' });
    expect(screen.queryByRole('region', { name: 'Focused Study controls' })).not.toBeInTheDocument();
  });

  it('keeps the floating assistant open and shows loading while a query is pending', async () => {
    const user = userEvent.setup();
    let resolveQuery: (value: Awaited<ReturnType<typeof messageClient.runQuery>>) => void = () => undefined;
    vi.mocked(messageClient.runQuery).mockReturnValueOnce(new Promise((resolve) => { resolveQuery = resolve; }));
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-1', synchronizationId: 'sync:video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
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
    expect(screen.getByText('正在載入完整英文字幕…')).toBeInTheDocument();
    expect(messageClient.runQuery).not.toHaveBeenCalled();
    expect(messageClient.saveHistory).not.toHaveBeenCalled();

    await act(async () => resolveRefresh({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-refresh',
      synchronizationId: 'video-refresh',
      videoTitle: 'Refreshed video',
      videoUrl: 'https://youtube.test/watch?v=video-refresh',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-refresh', startMs: 0, endMs: 1000, text: 'Refreshed transcript.' }] },
    }));

    await waitFor(() => expect(screen.getByTestId('transcript-cues')).toHaveTextContent('Refreshed transcript.'));
    expect(screen.queryByText('正在載入完整英文字幕…')).not.toBeInTheDocument();
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

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('重新抓取完整字幕失敗：The active tab is unavailable.'));
    expect(screen.queryByText('正在載入完整英文字幕…')).not.toBeInTheDocument();
    expect(messageClient.runQuery).not.toHaveBeenCalled();
  });

  it('shows and expands an exact caption pipeline diagnostic', async () => {
    render(<App />);
    await waitFor(() => expect(onMessage).toBeDefined());
    await act(async () => onMessage?.({
      type: 'VIDEO_CHANGED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
    }));

    await act(async () => onMessage?.({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      diagnostic: {
        stage: 'timedtext-parse',
        status: 'error',
        code: 'CAPTION_PARSE_EMPTY',
        message: '字幕檔下載成功，但解析不到任何字幕內容。',
      },
    }));

    expect(screen.getAllByText('字幕檔下載成功，但解析不到任何字幕內容。')).toHaveLength(1);
    expect(screen.getByText('字幕診斷（1）').closest('details')).toHaveAttribute('open');
  });

  it('does not swallow an initial content-script connection failure', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockRejectedValue(new Error('Could not establish connection. Receiving end does not exist.'));
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });

    render(<App />);

    expect(await screen.findByRole('alert')).toHaveTextContent('無法連線到 YouTube 字幕腳本');
    expect(screen.getByText('請在 YouTube 分頁按 Ctrl+Shift+R，再重試完整字幕。')).toBeVisible();
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'foreign-video',
      synchronizationId: 'sync:foreign-video',
      videoTitle: 'Foreign video',
      videoUrl: 'https://youtube.test/watch?v=foreign-video',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'foreign-cue', startMs: 0, endMs: 1000, text: 'Foreign cue.' }] },
    }, foreignSender));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'foreign-video', synchronizationId: 'sync:foreign-video', currentTimeMs: 500 }, foreignSender));

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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' },
          { id: 'cue-2', startMs: 1000, endMs: 2000, text: 'Second cue.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', synchronizationId: 'sync:video-1', currentTimeMs: 1500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-2');
  });

  it('refines a timed Current Reading Segment with rendered progress without changing its identity', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [
          { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First sentence.' },
          { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Current sentence.' },
          { id: 'cue-3', startMs: 2_000, endMs: 3_000, text: 'Future sentence.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', synchronizationId: 'sync:video-1', currentTimeMs: 1_500 }));
    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
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
      synchronizationId: 'sync:video-1',
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en-visible',
        isEnglish: true,
                cues: [
          { id: 'cue-1', startMs: 0, endMs: 4000, text: 'Earlier rolling cue.' },
          { id: 'cue-2', startMs: 2000, endMs: 6000, text: 'Latest rolling cue.' },
        ],
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', synchronizationId: 'sync:video-1', currentTimeMs: 2500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-2');
  });

  it('rebinds the side panel when the active Chrome tab changes and ignores the old tab', async () => {
    let onActivated: ((activeInfo: { tabId: number; windowId: number }) => void) | undefined;
    const query = vi.fn().mockResolvedValue([{ id: 1 }]);
    const sendMessage = vi.fn((tabId: number) => Promise.resolve(tabId === 1 ? {
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-a',
      synchronizationId: 'video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-a', startMs: 0, endMs: 1000, text: 'Caption from A.' }] },
    } : {
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-b',
      synchronizationId: 'video-b',
      videoTitle: 'Video B',
      videoUrl: 'https://youtube.test/watch?v=video-b',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-b', startMs: 0, endMs: 1000, text: 'Caption from B.' }] },
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'stale-a',
      synchronizationId: 'sync:stale-a',
      videoTitle: 'Stale A',
      videoUrl: 'https://youtube.test/watch?v=stale-a',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'stale-a', startMs: 0, endMs: 1000, text: 'Stale caption from A.' }] },
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
      if (message.type === 'REPLAY_RANGE') return Promise.resolve(undefined);
      if (tabId === 1) return oldState;
      return Promise.resolve({
        type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
        videoId: 'video-b',
        synchronizationId: 'video-b',
        videoTitle: 'Video B',
        videoUrl: 'https://youtube.test/watch?v=video-b',
        track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-b', startMs: 1000, endMs: 2000, text: 'Caption from B.' }] },
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-a',
      synchronizationId: 'video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-a', startMs: 1000, endMs: 2000, text: 'Caption from A.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(2, { type: 'REPLAY_RANGE', videoId: 'video-b', synchronizationId: 'video-b', startMs: 1_000, endMs: 2_000 });
  });

  it('binds an owned panel to its tab without querying or listening for activation', async () => {
    window.history.replaceState({}, '', '/?tabId=42');
    const query = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn().mockResolvedValue({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'owner-video',
      synchronizationId: 'owner-video',
      videoTitle: 'Owner video',
      videoUrl: 'https://youtube.test/watch?v=owner-video',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'owner-cue', startMs: 0, endMs: 1000, text: 'Caption from owner.' }] },
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'foreign-video',
      synchronizationId: 'sync:foreign-video',
      videoTitle: 'Foreign video',
      videoUrl: 'https://youtube.test/watch?v=foreign-video',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'foreign-cue', startMs: 0, endMs: 1000, text: 'Caption from foreign tab.' }] },
    }, { tab: { id: 43 } } as chrome.runtime.MessageSender));

    expect(screen.queryByText('Caption from foreign tab.')).not.toBeInTheDocument();
    expect(screen.getByText('Caption from owner.')).toBeInTheDocument();
  });

  it('uses the owner tab for refresh and replay, then removes its listeners on cleanup', async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, '', '/?tabId=42');
    const query = vi.fn().mockResolvedValue([]);
    const sendMessage = vi.fn((tabId: number, message: { type: string }) => {
      if (message.type === 'REPLAY_RANGE') return Promise.resolve(undefined);
      return Promise.resolve({
        type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
        videoId: 'owner-video',
        synchronizationId: 'owner-video',
        videoTitle: 'Owner video',
        videoUrl: 'https://youtube.test/watch?v=owner-video',
        track: { language: 'en', isEnglish: true, cues: [{ id: 'owner-cue', startMs: 1000, endMs: 2000, text: 'Caption from owner.' }] },
      });
    });
    const activated = { addListener: vi.fn(), removeListener: vi.fn() };
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage, onActivated: activated } });

    const { unmount } = render(<App />);
    expect(await screen.findByText('Caption from owner.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重新抓取字幕' }));
    await user.click(screen.getByRole('button', { name: 'Replay first cue' }));

    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' });
    expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REPLAY_RANGE', videoId: 'owner-video', synchronizationId: 'owner-video', startMs: 1_000, endMs: 2_000 });
    expect(query).not.toHaveBeenCalled();

    unmount();
    expect(globalThis.chrome.runtime.onMessage.removeListener).toHaveBeenCalledWith(runtimeMessageListener);
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-a',
      synchronizationId: 'sync:video-a',
      videoTitle: 'Video A',
      videoUrl: 'https://youtube.test/watch?v=video-a',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-a', startMs: 0, endMs: 1000, text: 'Caption from A.' }] },
    }, sender));
    await act(async () => listener({ type: 'VIDEO_CHANGED', videoId: 'video-b', synchronizationId: 'sync:video-b', videoTitle: 'Video B', videoUrl: 'https://youtube.test/watch?v=video-b' }, sender));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-b',
      synchronizationId: 'sync:video-b',
      videoTitle: 'Video B',
      videoUrl: 'https://youtube.test/watch?v=video-b',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-b', startMs: 0, endMs: 1000, text: 'Caption from B.' }] },
    }, sender));

    expect(screen.queryByText('Caption from A.')).not.toBeInTheDocument();
    expect(screen.getByText('Caption from B.')).toBeInTheDocument();
  });

  it('rejects stale same-video snapshots and messages after a new synchronization identity', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'VIDEO_CHANGED',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
    }, sender));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'old-cue', startMs: 0, endMs: 1_000, text: 'Old transcript.' }],
      },
    }, sender));
    fireEvent.click(screen.getByRole('button', { name: 'Select transcript text' }));

    await act(async () => listener({
      type: 'VIDEO_CHANGED',
      videoId: 'video-1',
      synchronizationId: 'sync-2',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
    }, sender));
    expect(screen.getByTestId('transcript-cues')).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog', { name: 'English learning assistant' })).not.toBeInTheDocument();
    expect(screen.getByText('正在載入完整英文字幕…')).toBeVisible();

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync-2',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'new-cue', startMs: 0, endMs: 1_000, text: 'New transcript.' }],
      },
    }, sender));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'late-cue', startMs: 0, endMs: 1_000, text: 'Late old transcript.' }],
      },
    }, sender));
    await act(async () => listener({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      diagnostic: {
        stage: 'timedtext-download',
        status: 'error',
        code: 'LATE_OLD_ERROR',
        message: 'Late old error.',
      },
    }, sender));
    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      progress: {
        capturedAtMs: 0,
        cues: [{ id: 'late-progress', startMs: 0, endMs: 500, text: 'Late progress.' }],
        activeGroup: { cueIds: ['late-progress'], startMs: 0 },
      },
    }, sender));
    await act(async () => runtimeMessageListener?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'identityless-cue', startMs: 0, endMs: 1_000, text: 'Identityless transcript.' }],
      },
    } as ContentMessage, sender));

    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('New transcript.');
    expect(screen.getByTestId('transcript-cues')).not.toHaveTextContent(/Old|Late|Identityless/);
    expect(screen.queryByText('Late old error.')).not.toBeInTheDocument();
    expect(screen.getByText(readyLifecycle.message)).toBeVisible();
  });
  it('isolates text, error, selection, and progress across 20 same-tab video switches', async () => {
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-0',
      synchronizationId: 'video-0',
      videoTitle: 'Video 0',
      videoUrl: 'https://youtube.test/watch?v=video-0',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'cue-0', startMs: 0, endMs: 2_000, text: 'Video 0 complete.' }],
      },
    }, sender));
    fireEvent.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await act(async () => listener({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-0',
      synchronizationId: 'video-0',
      diagnostic: {
        stage: 'timedtext-download',
        status: 'error',
        code: 'OLD_ERROR_0',
        message: 'Old error 0',
      },
    }, sender));

    for (let index = 1; index <= 20; index += 1) {
      const previousIndex = index - 1;
      const videoId = `video-${index}`;
      const synchronizationId = videoId;
      await act(async () => listener({
        type: 'VIDEO_CHANGED',
        videoId,
        synchronizationId,
        videoTitle: `Video ${index}`,
        videoUrl: `https://youtube.test/watch?v=${videoId}`,
      }, sender));
      await act(async () => listener({
        type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
        videoId,
        synchronizationId,
        videoTitle: `Video ${index}`,
        videoUrl: `https://youtube.test/watch?v=${videoId}`,
        track: {
          language: 'en',
          isEnglish: true,
                    cues: [{ id: `cue-${index}`, startMs: 0, endMs: 2_000, text: `Video ${index} complete.` }],
        },
      }, sender));
      await act(async () => listener({
        type: 'PLAYBACK_UPDATED',
        videoId,
        synchronizationId,
        currentTimeMs: 1_000,
      }, sender));
      await act(async () => listener({
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId,
        synchronizationId,
        progress: {
          capturedAtMs: 1_000,
          cues: [{ id: `rendered-${index}`, startMs: 900, endMs: 1_500, text: `Video ${index}` }],
          activeGroup: { cueIds: [`rendered-${index}`], startMs: 900 },
        },
      }, sender));
      await act(async () => listener({
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId: `video-${previousIndex}`,
        synchronizationId: `video-${previousIndex}`,
        progress: {
          capturedAtMs: 1_000,
          cues: [{ id: `stale-${previousIndex}`, startMs: 900, endMs: 1_500, text: 'Stale progress' }],
          activeGroup: { cueIds: [`stale-${previousIndex}`], startMs: 900 },
        },
      }, sender));
      await act(async () => listener({
        type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
        videoId: `video-${previousIndex}`,
        synchronizationId: `video-${previousIndex}`,
        videoTitle: `Video ${previousIndex}`,
        videoUrl: `https://youtube.test/watch?v=video-${previousIndex}`,
        track: {
          language: 'en',
          isEnglish: true,
                    cues: [{ id: `stale-text-${previousIndex}`, startMs: 0, endMs: 2_000, text: 'Stale previous text' }],
        },
      }, sender));
      await act(async () => listener({
        type: 'CAPTION_DIAGNOSTIC',
        videoId: `video-${previousIndex}`,
        synchronizationId: `video-${previousIndex}`,
        diagnostic: {
          stage: 'timedtext-download',
          status: 'error',
          code: `STALE_ERROR_${previousIndex}`,
          message: 'Stale previous error',
        },
      }, sender));
      if (index < 20) {
        fireEvent.click(screen.getByRole('button', { name: 'Select transcript text' }));
        await act(async () => listener({
          type: 'CAPTION_DIAGNOSTIC',
          videoId,
          synchronizationId,
          diagnostic: {
            stage: 'timedtext-download',
            status: 'error',
            code: `OLD_ERROR_${index}`,
            message: `Old error ${index}`,
          },
        }, sender));
      }
    }

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-20');
    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('Video 20');
    expect(screen.getByTestId('transcript-cues')).not.toHaveTextContent(/Stale/);
    expect(screen.queryByText(/Old error|Stale previous error/)).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'English learning assistant' })).not.toBeInTheDocument();
  });

  it('ignores playback from a video other than the selected video', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-1', synchronizationId: 'sync:video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' }] },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-2', synchronizationId: 'sync:video-2', currentTimeMs: 500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('none');
  });

  it('uses rendered progress only to refine a current full-track row', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'VIDEO_CHANGED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
    }));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{
          id: 'timedtext-current',
          startMs: 29_000,
          endMs: 33_000,
          text: 'National League guy, Almost complete',
        }],
      },
    }));
    await act(async () => listener({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      currentTimeMs: 29_200,
    }));
    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      progress: {
        capturedAtMs: 29_200,
        cues: [{
          id: 'progress-0',
          startMs: 29_000,
          endMs: 29_201,
          text: 'National League guy, Almost',
        }],
        activeGroup: { cueIds: ['progress-0'], startMs: 29_000 },
      },
    }));

    expect(screen.getByTestId('transcript-cues')).toHaveTextContent('National League guy, Almost');
    expect(screen.getByTestId('transcript-cues')).not.toHaveTextContent('complete');
  });

  it('does not let rendered progress claim a video before its Caption Track arrives', async () => {
    render(<App />);
    await waitFor(() => expect(registeredListeners).toHaveLength(1));
    const listener = registeredListeners[0];

    await act(async () => listener({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'stale-video',
      synchronizationId: 'sync:stale-video',
      progress: {
        capturedAtMs: 0,
        cues: [{ id: 'stale-progress', startMs: 0, endMs: 1_000, text: 'Stale progress.' }],
        activeGroup: { cueIds: ['stale-progress'], startMs: 0 },
      },
    }));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-1', synchronizationId: 'sync:video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'First cue.' }] },
    }));
    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-2', synchronizationId: 'sync:video-2', videoTitle: 'Video two', videoUrl: 'https://youtube.test/watch?v=video-2',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'stale-cue', startMs: 0, endMs: 1000, text: 'Stale cue.' }] },
    }));
    await act(async () => listener({ type: 'VIDEO_CHANGED', videoId: 'video-2', synchronizationId: 'sync:video-2', videoTitle: 'Video two', videoUrl: 'https://youtube.test/watch?v=video-2' }));
    await act(async () => listener({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId: 'video-2',
      synchronizationId: 'sync:video-2',
      lifecycle: {
        status: 'no-english-track',
        message: 'No English track.',
        action: 'enable-english-cc',
      },
    }));
    await act(async () => listener({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', synchronizationId: 'sync:video-1', currentTimeMs: 500 }));

    expect(screen.getByTestId('current-cues')).toHaveTextContent('cue-1');
    expect(screen.queryByText('No English captions are available for this video.')).not.toBeInTheDocument();
  });

  it('builds query context from the selected cue', async () => {
    const user = userEvent.setup();
    render(<App />);
    await act(async () => onMessage?.({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync:video-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
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

  it('presents exactly one Loading, Ready, Retryable Error, or No English Track state', async () => {
    const user = userEvent.setup();
    const query = vi.fn().mockResolvedValue([{ id: 42 }]);
    const sendMessage = vi.fn().mockResolvedValue(undefined);
    Object.assign(globalThis.chrome, { tabs: { query, sendMessage } });
    const { container } = render(<App />);
    await waitFor(() => expect(sendMessage).toHaveBeenCalledWith(42, { type: 'REQUEST_STATE' }));
    const listener = registeredListeners[0];
    const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;

    await act(async () => listener({
      type: 'VIDEO_CHANGED',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
    }, sender));
    expect(container.querySelector('[data-caption-state]')).toHaveAttribute('data-caption-state', 'loading');
    expect(screen.getByText('正在載入完整英文字幕…')).toBeVisible();

    await act(async () => listener({
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle,
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      videoTitle: 'Video one',
      videoUrl: 'https://youtube.test/watch?v=video-1',
      track: {
        language: 'en',
        isEnglish: true,
                cues: [{ id: 'ready-cue', startMs: 0, endMs: 1_000, text: 'Ready transcript.' }],
      },
    }, sender));
    expect(container.querySelector('[data-caption-state]')).toHaveAttribute('data-caption-state', 'ready');
    expect(screen.getByText(readyLifecycle.message)).toBeVisible();
    expect(screen.queryByText('正在載入完整英文字幕…')).not.toBeInTheDocument();
    await act(async () => listener({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      diagnostic: {
        stage: 'player-response',
        status: 'running',
        message: 'Transient loading diagnostic.',
      },
    }, sender));
    expect(screen.getByText('Transient loading diagnostic.')).toBeInTheDocument();

    await act(async () => listener({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      lifecycle: {
        status: 'retryable-error',
        code: 'CAPTION_FETCH_FAILED',
        message: '完整字幕下載失敗。',
        action: 'retry',
      },
    }, sender));
    expect(container.querySelector('[data-caption-state]')).toHaveAttribute('data-caption-state', 'retryable-error');
    expect(screen.getByRole('alert')).toHaveTextContent('完整字幕下載失敗。');
    expect(screen.getByTestId('transcript-cues')).toBeEmptyDOMElement();
    expect(screen.queryByText('Transient loading diagnostic.')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '重新抓取字幕' }));
    expect(sendMessage).toHaveBeenCalledWith(42, {
      type: 'RETRY_CAPTIONS',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
    });
    expect(container.querySelector('[data-caption-state]')).toHaveAttribute('data-caption-state', 'loading');

    await act(async () => listener({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId: 'video-1',
      synchronizationId: 'sync-1',
      lifecycle: {
        status: 'no-english-track',
        message: '這部影片目前沒有可用的英文字幕軌。',
        action: 'enable-english-cc',
      },
    }, sender));
    expect(container.querySelector('[data-caption-state]')).toHaveAttribute('data-caption-state', 'no-english-track');
    expect(screen.getByText(/請在 YouTube 開啟英文 CC/)).toBeVisible();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
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
      type: 'CAPTIONS_UPDATED', lifecycle: readyLifecycle, videoId: 'video-1', synchronizationId: 'sync:video-1', videoTitle: 'Video one', videoUrl: 'https://www.youtube.com/watch?v=video-1',
      track: { language: 'en', isEnglish: true, cues: [{ id: 'cue-1', startMs: 0, endMs: 1000, text: 'A selected phrase.' }] },
    }));

    await user.click(screen.getByRole('button', { name: 'Select transcript text' }));
    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(await screen.findByText('Answer despite storage failure')).toBeInTheDocument();
    expect(screen.getByText('Answer completed, but it could not be saved to history.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Add favorite' })).toBeDisabled();
  });
});
