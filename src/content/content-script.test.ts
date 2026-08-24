import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentMessage } from '../domain/types';

const windowMessageListeners: EventListenerOrEventListenerObject[] = [];
const documentNavigationListeners: EventListenerOrEventListenerObject[] = [];

beforeEach(() => {
  const addWindowEventListener = window.addEventListener.bind(window);
  vi.spyOn(window, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'message') windowMessageListeners.push(listener);
    addWindowEventListener(type, listener, options);
  }) as typeof window.addEventListener);

  const addDocumentEventListener = document.addEventListener.bind(document);
  vi.spyOn(document, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (type === 'yt-navigate-finish') documentNavigationListeners.push(listener);
    addDocumentEventListener(type, listener, options);
  }) as typeof document.addEventListener);
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.dispatchEvent(new Event('yt-navigate-finish'));
  windowMessageListeners.splice(0).forEach((listener) => {
    window.removeEventListener('message', listener);
  });
  documentNavigationListeners.splice(0).forEach((listener) => {
    document.removeEventListener('yt-navigate-finish', listener);
  });
  vi.restoreAllMocks();
});

const playerResponse = {
  videoDetails: { videoId: 'video-1' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{
        baseUrl: 'https://captions.test/track',
        languageCode: 'en',
      }],
    },
  },
};

const matchingPlayerResponse = {
  videoDetails: { videoId: 'video-1' },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [{
        baseUrl: 'https://captions.test/video-1',
        languageCode: 'en',
        name: { simpleText: 'English' },
      }],
    },
  },
};

function dispatchPageBridgeResponse(
  postMessage: ReturnType<typeof vi.fn>,
  override: Record<string, unknown> = {},
): void {
  const request = postMessage.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter((message) => message.type === 'REQUEST_PLAYER_RESPONSE')
    .at(-1);
  if (!request) throw new Error('Missing player-response request');
  const event = new MessageEvent('message', {
    data: {
      source: 'youtube-english-learning',
      type: 'PLAYER_RESPONSE',
      videoId: request.videoId,
      requestVersion: request.requestVersion,
      playerResponse: matchingPlayerResponse,
      ...override,
    },
  });
  Object.defineProperty(event, 'source', { configurable: true, value: window });
  window.dispatchEvent(event);
}

function setVideoUrl(videoId = 'video-1'): void {
  window.history.replaceState({}, '', `/watch?v=${videoId}`);
}

function setPlayerResponseScript(response: object): void {
  const script = document.createElement('script');
  script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(response)};`;
  document.body.append(script);
}

async function loadContentScriptRuntime(options: {
  captionResponse?: object;
  waitForInitialResult?: boolean;
  fetchImpl?: typeof fetch;
  sendMessageImpl?: (message: ContentMessage) => Promise<void> | void;
} = {}) {
  const sendMessage = vi.fn<(message: ContentMessage) => Promise<void> | void>(
    options.sendMessageImpl ?? (() => undefined),
  );
  const postMessage = vi.fn();
  let onMessage: ((message: unknown) => void) | undefined;
  const fetchMock = options.fetchImpl ?? vi.fn().mockResolvedValue({
    ok: options.captionResponse !== undefined,
    status: options.captionResponse === undefined ? 404 : 200,
    text: async () => '<transcript><text start="0" dur="1">Hello</text></transcript>',
  });
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        sendMessage,
        onMessage: {
          addListener: vi.fn((listener: (message: unknown) => void) => { onMessage = listener; }),
          removeListener: vi.fn(),
        },
      },
    },
    fetch: fetchMock,
  });
  Object.defineProperty(window, 'postMessage', { configurable: true, writable: true, value: postMessage });

  vi.resetModules();
  const module = await import('./content-script');
  await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'VIDEO_CHANGED' })));
  if (options.waitForInitialResult !== false) {
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: options.captionResponse === undefined ? 'NO_CAPTIONS' : 'CAPTIONS_UPDATED',
    })));
  }

  return { module, onMessage, sendMessage, postMessage, fetchMock };
}

describe('content-script player response discovery', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('reads ytInitialPlayerResponse from DOM script content', async () => {
    setPlayerResponseScript(playerResponse);
    const { getPlayerResponseFromDocument } = await import('./content-script');

    expect(getPlayerResponseFromDocument(document, undefined, 'video-1')).toEqual(playerResponse);
  });

  it('uses the isolated-world global only when DOM script content has no response', async () => {
    const fallback = {
      videoDetails: { videoId: 'video-1' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: [] } },
    };
    const { getPlayerResponseFromDocument } = await import('./content-script');

    expect(getPlayerResponseFromDocument(document, fallback, 'video-1')).toBe(fallback);
  });

  it('ignores stale document and isolated-world responses for another video', async () => {
    const staleResponse = {
      ...playerResponse,
      videoDetails: { videoId: 'old-video' },
    };
    setPlayerResponseScript(staleResponse);
    const { getPlayerResponseFromDocument } = await import('./content-script');

    expect(getPlayerResponseFromDocument(document, staleResponse, 'video-1')).toBeUndefined();
  });
});

describe('content-script late-open state synchronization', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    window.history.replaceState({}, '', '/');
  });

  it('requests the page response and retries English track extraction when it arrives', async () => {
    setVideoUrl();
    const { sendMessage, postMessage } = await loadContentScriptRuntime({
      captionResponse: playerResponse,
      waitForInitialResult: false,
    });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'youtube-english-learning',
      type: 'REQUEST_PLAYER_RESPONSE',
      videoId: 'video-1',
      requestVersion: expect.any(Number),
    }), '*');

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'NO_CAPTIONS' })));
    sendMessage.mockClear();
    dispatchPageBridgeResponse(postMessage);

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
    })));
    const timedTextMessage = sendMessage.mock.calls
      .map(([message]) => message as ContentMessage)
      .find((message) => message.type === 'CAPTIONS_UPDATED' && message.track.source === 'timedtext');
    expect(timedTextMessage?.type).toBe('CAPTIONS_UPDATED');
    if (timedTextMessage?.type !== 'CAPTIONS_UPDATED') throw new Error('Missing timed-text message');
    expect(timedTextMessage.track).toMatchObject({ source: 'timedtext' });
  });

  it('publishes rendered caption progress separately from a complete Caption Track', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.5 });
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Hello';
    document.body.append(video, segment);

    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      progress: {
        capturedAtMs: 500,
        cues: [expect.objectContaining({ id: 'progress-0', text: 'Hello' })],
        activeGroup: { cueIds: ['progress-0'], startMs: 500 },
      },
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ source: 'timedtext' }),
    }));

    sendMessage.mockClear();
    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
    }));
  });

  it('disconnects rendered progress monitoring when the progress message is rejected synchronously', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 0.5 });
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Hello';
    document.body.append(video, segment);
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');

    const { sendMessage } = await loadContentScriptRuntime({
      captionResponse: playerResponse,
      sendMessageImpl: (message) => {
        if (message.type === 'CAPTION_PROGRESS_UPDATED') throw new Error('No receiver');
      },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
    })));
    expect(disconnectSpy).toHaveBeenCalled();
  });

  it.each(['top-level video', 'nested video', 'request version'] as const)(
    'ignores a bridge response with mismatched %s',
    async (boundary) => {
      setVideoUrl();
      const { postMessage, fetchMock } = await loadContentScriptRuntime({ waitForInitialResult: false });
      const playerRequest = postMessage.mock.calls
        .map(([message]) => message as Record<string, unknown>)
        .find((message) => message.type === 'REQUEST_PLAYER_RESPONSE');
      if (!playerRequest) throw new Error('Missing player-response request');
      const requestedVersion = playerRequest.requestVersion as number;
      const override = boundary === 'top-level video'
        ? { videoId: 'old-video' }
        : boundary === 'nested video'
          ? { playerResponse: { ...matchingPlayerResponse, videoDetails: { videoId: 'old-video' } } }
          : { requestVersion: requestedVersion - 1 };

      dispatchPageBridgeResponse(postMessage, override);
      await new Promise((resolve) => window.setTimeout(resolve, 200));

      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it('ignores a matching bridge payload after the page URL changes', async () => {
    setVideoUrl();
    const { postMessage, fetchMock } = await loadContentScriptRuntime({ waitForInitialResult: false });
    window.history.replaceState({}, '', '/watch?v=other-video');
    try {
      dispatchPageBridgeResponse(postMessage);
      await new Promise((resolve) => window.setTimeout(resolve, 200));
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      setVideoUrl();
    }
  });

  it('processes an exact bridge response that arrives after the retry window', async () => {
    setVideoUrl();
    const { postMessage, sendMessage, fetchMock } = await loadContentScriptRuntime({
      captionResponse: matchingPlayerResponse,
      waitForInitialResult: false,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'NO_CAPTIONS' })));
    sendMessage.mockClear();

    dispatchPageBridgeResponse(postMessage);

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith('https://captions.test/video-1'));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
      track: expect.objectContaining({ source: 'timedtext' }),
    })));
  });

  it('replays VIDEO_CHANGED and CAPTIONS_UPDATED for REQUEST_STATE', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    sendMessage.mockClear();

    onMessage?.({ type: 'REQUEST_STATE' });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'VIDEO_CHANGED', videoId: 'video-1' })));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CAPTIONS_UPDATED', videoId: 'video-1' })));
  });

  it('requests a fresh page player response when REQUEST_STATE refreshes an existing video', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const { onMessage, postMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    postMessage.mockClear();
    sendMessage.mockClear();

    onMessage?.({ type: 'REQUEST_STATE' });

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'youtube-english-learning',
      type: 'REQUEST_PLAYER_RESPONSE',
      videoId: 'video-1',
      requestVersion: expect.any(Number),
    }), '*');
  });

  it('uses only correlated player-response requests after YouTube navigation', async () => {
    setVideoUrl();
    const { postMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });
    postMessage.mockClear();
    setVideoUrl('video-2');

    document.dispatchEvent(new Event('yt-navigate-finish'));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalled());

    const requests = postMessage.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter((message) => message.type === 'REQUEST_PLAYER_RESPONSE');
    expect(requests.length).toBeGreaterThan(0);
    expect(requests).toEqual(requests.map((message) => expect.objectContaining({
      videoId: 'video-2',
      requestVersion: expect.any(Number),
    })));
  });

  it('retries a too-early player response request and eventually loads captions', async () => {
    setVideoUrl();
    const { postMessage, sendMessage } = await loadContentScriptRuntime({
      captionResponse: playerResponse,
      waitForInitialResult: false,
    });
    postMessage.mockImplementationOnce(() => {
      setPlayerResponseScript(playerResponse);
      dispatchPageBridgeResponse(postMessage);
    });

    await vi.waitFor(() => expect(postMessage.mock.calls.length).toBeGreaterThan(1));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'CAPTIONS_UPDATED', videoId: 'video-1' })));
  });

  it('does not let an older failed synchronization replace a newer complete caption track', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const visibleSegment = document.createElement('span');
    visibleSegment.className = 'ytp-caption-segment';
    visibleSegment.textContent = 'Stale visible caption';
    document.body.append(visibleSegment);

    let resolveOlderFetch: (response: Response) => void = () => undefined;
    const olderFetch = new Promise<Response>((resolve) => { resolveOlderFetch = resolve; });
    const fetchImpl = vi.fn()
      .mockReturnValueOnce(olderFetch)
      .mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => '<transcript><text start="0" dur="1">Newest complete caption</text></transcript>',
      } as Response) as unknown as typeof fetch;
    const { onMessage, sendMessage } = await loadContentScriptRuntime({
      fetchImpl,
      waitForInitialResult: false,
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));

    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({
        language: 'en',
        cues: [expect.objectContaining({ text: 'Newest complete caption' })],
      }),
    })));
    sendMessage.mockClear();

    resolveOlderFetch({ ok: false, status: 500, text: async () => '' } as Response);
    await new Promise((resolve) => window.setTimeout(resolve, 500));

    expect(sendMessage).not.toHaveBeenCalled();

    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ language: 'en' }),
    })));
    const replayedCaption = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'CAPTIONS_UPDATED');
    expect(replayedCaption).toEqual(expect.objectContaining({
      track: expect.objectContaining({
        language: 'en',
        cues: [expect.objectContaining({ text: 'Newest complete caption' })],
      }),
    }));
  });

  it('stops an active visible-caption fallback when a fresh complete track is loaded', async () => {
    setVideoUrl();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Fallback before refresh';
    document.body.append(segment);
    const disconnectSpy = vi.spyOn(MutationObserver.prototype, 'disconnect');
    const { onMessage, sendMessage } = await loadContentScriptRuntime({
      captionResponse: playerResponse,
      waitForInitialResult: false,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ language: 'en-visible' }),
    })), { timeout: 2_000 });
    disconnectSpy.mockClear();

    setPlayerResponseScript(playerResponse);
    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ language: 'en' }),
    })));
    expect(disconnectSpy).toHaveBeenCalled();
    sendMessage.mockClear();

    segment.textContent = 'A stopped fallback must not publish this';
    await new Promise((resolve) => window.setTimeout(resolve, 500));

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ language: 'en-visible' }),
    }));
    disconnectSpy.mockRestore();
  });

  it('does not let an older message rejection stop the newest visible-caption fallback', async () => {
    setVideoUrl();
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'First fallback caption';
    document.body.append(segment);
    let rejectOldMessage: (reason: Error) => void = () => undefined;
    const oldMessage = new Promise<void>((_resolve, reject) => { rejectOldMessage = reject; });
    let messageCount = 0;
    const { onMessage, sendMessage } = await loadContentScriptRuntime({
      captionResponse: playerResponse,
      waitForInitialResult: false,
      sendMessageImpl: () => {
        messageCount += 1;
        return messageCount === 1 ? oldMessage : undefined;
      },
    });
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => (
      message.type === 'CAPTIONS_UPDATED' && message.track.language === 'en-visible'
    ))).toHaveLength(1), { timeout: 2_000 });

    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(sendMessage.mock.calls.filter(([message]) => (
      message.type === 'CAPTIONS_UPDATED' && message.track.language === 'en-visible'
    )).length).toBeGreaterThanOrEqual(3), { timeout: 2_000 });
    sendMessage.mockClear();

    rejectOldMessage(new Error('Older message channel closed'));
    await Promise.resolve();
    segment.textContent = 'Newest fallback is still active';

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({
        language: 'en-visible',
        cues: expect.arrayContaining([expect.objectContaining({
          text: expect.stringContaining('Newest fallback is still active'),
        })]),
      }),
    })), { timeout: 2_000 });

    setPlayerResponseScript(playerResponse);
    onMessage?.({ type: 'REQUEST_STATE' });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ language: 'en' }),
    })));
  });

  it('captures captions already visible on the YouTube player when timedtext is unavailable', async () => {
    setVideoUrl();
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10 });
    const firstSegment = document.createElement('span');
    firstSegment.className = 'ytp-caption-segment';
    firstSegment.textContent = 'Visible English caption.';
    const secondSegment = document.createElement('span');
    secondSegment.className = 'ytp-caption-segment';
    secondSegment.textContent = 'Second sentence.';
    document.body.append(video, firstSegment, secondSegment);

    const { sendMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });

    await vi.waitFor(() => expect(sendMessage.mock.calls.some(([message]) => (
      message.type === 'CAPTIONS_UPDATED' && message.track.source === 'visible-dom'
    ))).toBe(true));
    const visibleMessage = sendMessage.mock.calls
      .map(([message]) => message as ContentMessage)
      .find((message) => message.type === 'CAPTIONS_UPDATED' && message.track.source === 'visible-dom');
    expect(visibleMessage?.type).toBe('CAPTIONS_UPDATED');
    if (visibleMessage?.type !== 'CAPTIONS_UPDATED') throw new Error('Missing visible-DOM message');
    expect(visibleMessage).toMatchObject({
      videoId: 'video-1',
      track: {
        language: 'en-visible',
        source: 'visible-dom',
        cues: [
          expect.objectContaining({ id: 'visible-0', text: 'Visible English caption.' }),
          expect.objectContaining({ id: 'visible-1', text: 'Second sentence.' }),
        ],
        activeGroup: { cueIds: ['visible-0', 'visible-1'], startMs: 10_000 },
      },
    });
  });

  it('reports the exact caption pipeline stage before activating the visible-caption fallback', async () => {
    setVideoUrl();
    const { sendMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      diagnostic: expect.objectContaining({
        stage: 'player-response',
        status: 'error',
        code: 'PLAYER_RESPONSE_MISSING',
      }),
    })));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({ stage: 'visible-dom', status: 'fallback' }),
    })));
  });

  it('replays VIDEO_CHANGED and NO_CAPTIONS for REQUEST_STATE', async () => {
    setVideoUrl();
    setPlayerResponseScript({ captions: {} });
    const video = document.createElement('video');
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime();
    sendMessage.mockClear();

    onMessage?.({ type: 'REQUEST_STATE' });

    const replayedState = sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type !== 'CAPTION_DIAGNOSTIC');
    expect(replayedState[0]).toEqual(expect.objectContaining({ type: 'VIDEO_CHANGED', videoId: 'video-1' }));
    expect(replayedState[1]).toEqual(expect.objectContaining({ type: 'NO_CAPTIONS', videoId: 'video-1' }));
    expect(replayedState[2]).toEqual({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 0 });
  });

  it('replays paused playback immediately even when playback throttling was just used', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 12.345 });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    video.dispatchEvent(new Event('timeupdate'));
    sendMessage.mockClear();
    onMessage?.({ type: 'REQUEST_STATE' });

    const replayedState = sendMessage.mock.calls.map(([message]) => message).filter((message) => message.type !== 'CAPTION_DIAGNOSTIC');
    expect(replayedState[0]).toEqual(expect.objectContaining({ type: 'VIDEO_CHANGED', videoId: 'video-1' }));
    expect(replayedState[1]).toEqual(expect.objectContaining({ type: 'CAPTIONS_UPDATED', videoId: 'video-1' }));
    expect(replayedState[2]).toEqual({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 12345 });
  });

  it('seeks, starts playback, and immediately reports playback for a requested time', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    sendMessage.mockClear();

    onMessage?.({ type: 'SEEK_TO_TIME', timeMs: 500 });

    expect(video.currentTime).toBe(0.5);
    expect(play).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 500 });
  });

  it('accepts a zero seek time for a cue near the start of the video', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: vi.fn().mockResolvedValue(undefined) });
    document.body.append(video);
    const { onMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    onMessage?.({ type: 'SEEK_TO_TIME', timeMs: 0 });

    expect(video.currentTime).toBe(0);
  });
});
