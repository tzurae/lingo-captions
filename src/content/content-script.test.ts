import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContentMessage, SidePanelContentMessage } from '../domain/types';

const windowMessageListeners: EventListenerOrEventListenerObject[] = [];
const documentRuntimeListeners: Array<{
  type: string;
  listener: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}> = [];

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
    if (type === 'yt-navigate-finish' || type === 'click' || type === 'keydown') {
      documentRuntimeListeners.push({ type, listener, options });
    }
    addDocumentEventListener(type, listener, options);
  }) as typeof document.addEventListener);
});

afterEach(() => {
  window.history.replaceState({}, '', '/');
  document.dispatchEvent(new Event('yt-navigate-finish'));
  windowMessageListeners.splice(0).forEach((listener) => {
    window.removeEventListener('message', listener);
  });
  documentRuntimeListeners.splice(0).forEach(({ type, listener, options }) => {
    document.removeEventListener(type, listener, options);
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
      captionSelection: { captionsEnabled: false },
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

type CorrelatedSidePanelMessage = Exclude<SidePanelContentMessage, { type: 'REQUEST_STATE' }>;
type WithoutSynchronization<T> = T extends unknown
  ? Omit<T, 'videoId' | 'synchronizationId'>
  : never;

type SentMessageSpy = {
  mock: { calls: Array<[ContentMessage]> };
};

function forCurrentSynchronization(
  sendMessage: SentMessageSpy,
  message: WithoutSynchronization<CorrelatedSidePanelMessage>,
): CorrelatedSidePanelMessage {
  const currentVideo = sendMessage.mock.calls
    .map(([sent]) => sent as ContentMessage)
    .filter((sent): sent is Extract<ContentMessage, { type: 'VIDEO_CHANGED' }> => (
      sent.type === 'VIDEO_CHANGED'
    ))
    .at(-1);
  if (!currentVideo) throw new Error('Current synchronization is missing');
  return {
    ...message,
    videoId: currentVideo.videoId,
    synchronizationId: currentVideo.synchronizationId,
  } as CorrelatedSidePanelMessage;
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
  let onMessage: ((message: SidePanelContentMessage) => void) | undefined;
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
          addListener: vi.fn((listener: (message: SidePanelContentMessage) => void) => { onMessage = listener; }),
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
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining(
      options.captionResponse === undefined
        ? {
          type: 'CAPTION_LIFECYCLE_UPDATED',
          lifecycle: expect.objectContaining({
            status: expect.stringMatching(/^(retryable-error|no-english-track)$/),
          }),
        }
        : { type: 'CAPTIONS_UPDATED' },
    )));
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

    sendMessage.mockClear();
    dispatchPageBridgeResponse(postMessage);

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      videoId: 'video-1',
    })));
    const timedTextMessage = sendMessage.mock.calls
      .map(([message]) => message as ContentMessage)
      .find((message) => message.type === 'CAPTIONS_UPDATED');
    expect(timedTextMessage?.type).toBe('CAPTIONS_UPDATED');
    if (timedTextMessage?.type !== 'CAPTIONS_UPDATED') throw new Error('Missing timed-text message');
    expect(timedTextMessage.track).toMatchObject({ isEnglish: true });
  });

  it.each([
    {
      label: 'CC-on creator',
      captionSelection: { captionsEnabled: true, activeTrack: { languageCode: 'en', vssId: '.en' } },
      expectedUrl: 'https://captions.test/creator',
      expectedProvenance: 'creator',
      expectedReason: 'active',
      tracks: [
        { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
        { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
      ],
    },
    {
      label: 'CC-on automatic',
      captionSelection: { captionsEnabled: true, activeTrack: { kind: 'asr', languageCode: 'en', vssId: 'a.en' } },
      expectedUrl: 'https://captions.test/automatic',
      expectedProvenance: 'automatic',
      expectedReason: 'active',
      tracks: [
        { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
        { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
      ],
    },
    {
      label: 'CC-off last-known',
      captionSelection: { captionsEnabled: false, activeTrack: { kind: 'asr', languageCode: 'en', vssId: 'a.en' } },
      expectedUrl: 'https://captions.test/automatic',
      expectedProvenance: 'automatic',
      expectedReason: 'last-known',
      tracks: [
        { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
        { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
      ],
    },
    {
      label: 'CC-off creator fallback',
      captionSelection: { captionsEnabled: false },
      expectedUrl: 'https://captions.test/creator',
      expectedProvenance: 'creator',
      expectedReason: 'creator-fallback',
      tracks: [
        { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
        { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
      ],
    },
    {
      label: 'automatic-only fallback',
      captionSelection: { captionsEnabled: false },
      expectedUrl: 'https://captions.test/automatic',
      expectedProvenance: 'automatic',
      expectedReason: 'automatic-fallback',
      tracks: [
        { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
      ],
    },
  ])('applies the $label policy at the adapter-to-experience seam', async ({
    captionSelection,
    expectedProvenance,
    expectedReason,
    expectedUrl,
    tracks,
  }) => {
    setVideoUrl();
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<transcript><text start="0" dur="1">Expected full transcript</text></transcript>',
    } as Response) as unknown as typeof fetch;
    const { fetchMock, postMessage, sendMessage } = await loadContentScriptRuntime({
      fetchImpl,
      waitForInitialResult: false,
    });

    dispatchPageBridgeResponse(postMessage, {
      playerResponse: {
        videoDetails: { videoId: 'video-1' },
        captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
      },
      captionSelection,
    });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledWith(expectedUrl));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({
        stage: 'track-policy',
        status: 'success',
        details: expect.objectContaining({
          source: expectedProvenance,
          selection: expectedReason,
        }),
      }),
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'Expected full transcript' })],
      }),
    }));
  });

  it('reports No English Track instead of diverging from YouTube active wording', async () => {
    setVideoUrl();
    const { fetchMock, postMessage, sendMessage } = await loadContentScriptRuntime({
      waitForInitialResult: false,
    });

    dispatchPageBridgeResponse(postMessage, {
      playerResponse: {
        videoDetails: { videoId: 'video-1' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://captions.test/creator-en', languageCode: 'en', vssId: '.en' },
              { baseUrl: 'https://captions.test/creator-es', languageCode: 'es', vssId: '.es' },
            ],
          },
        },
      },
      captionSelection: {
        captionsEnabled: true,
        activeTrack: { languageCode: 'es', vssId: '.es' },
      },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({
        stage: 'track-policy',
        code: 'ACTIVE_TRACK_NOT_ENGLISH',
        details: expect.objectContaining({
          activeLanguage: 'es',
          action: 'select-english-cc',
        }),
      }),
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'no-english-track' }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows Retryable Error when CC is on before active identity is discoverable', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const ccButton = document.createElement('button');
    ccButton.className = 'ytp-subtitles-button';
    ccButton.setAttribute('aria-pressed', 'true');
    document.body.append(ccButton);
    const { fetchMock, sendMessage } = await loadContentScriptRuntime({
      waitForInitialResult: false,
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({
        stage: 'track-policy',
        code: 'ACTIVE_TRACK_MISSING',
        details: expect.objectContaining({ action: 'retry' }),
      }),
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('shows Retryable Error for an ambiguous partial English active reference', async () => {
    setVideoUrl();
    const { fetchMock, postMessage, sendMessage } = await loadContentScriptRuntime({
      waitForInitialResult: false,
    });
    dispatchPageBridgeResponse(postMessage, {
      playerResponse: {
        videoDetails: { videoId: 'video-1' },
        captions: {
          playerCaptionsTracklistRenderer: {
            captionTracks: [
              { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
              { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
            ],
          },
        },
      },
      captionSelection: {
        captionsEnabled: true,
        activeTrack: { languageCode: 'en' },
      },
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({
        stage: 'track-policy',
        code: 'ACTIVE_TRACK_UNRESOLVED',
        details: expect.objectContaining({ activeLanguage: 'en', action: 'retry' }),
      }),
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('starts a new synchronization when YouTube changes the active Caption Track', async () => {
    setVideoUrl();
    const tracks = [
      { baseUrl: 'https://captions.test/creator', languageCode: 'en', vssId: '.en' },
      { baseUrl: 'https://captions.test/automatic', kind: 'asr', languageCode: 'en', vssId: 'a.en' },
    ];
    const playerResponseWithTracks = {
      videoDetails: { videoId: 'video-1' },
      captions: { playerCaptionsTracklistRenderer: { captionTracks: tracks } },
    };
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '<transcript><text start="0" dur="1">Full transcript</text></transcript>',
    } as Response) as unknown as typeof fetch;
    const { postMessage, sendMessage } = await loadContentScriptRuntime({
      fetchImpl,
      waitForInitialResult: false,
    });
    dispatchPageBridgeResponse(postMessage, {
      playerResponse: playerResponseWithTracks,
      captionSelection: {
        captionsEnabled: true,
        activeTrack: { languageCode: 'en', vssId: '.en' },
      },
    });
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('https://captions.test/creator'));
    const initialSynchronizationId = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'VIDEO_CHANGED')?.synchronizationId;

    const menuItem = document.createElement('button');
    menuItem.className = 'ytp-menuitem';
    document.body.append(menuItem);
    vi.useFakeTimers();
    try {
      menuItem.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await vi.advanceTimersByTimeAsync(100);
      const probeRequest = postMessage.mock.calls
        .map(([message]) => message as Record<string, unknown>)
        .filter((message) => message.type === 'REQUEST_PLAYER_RESPONSE')
        .at(-1);
      if (!probeRequest) throw new Error('Caption-selection probe request missing');

      dispatchPageBridgeResponse(postMessage, {
        playerResponse: playerResponseWithTracks,
        captionSelection: {
          captionsEnabled: true,
          activeTrack: { kind: 'asr', languageCode: 'en', vssId: 'a.en' },
        },
      });
      await Promise.resolve();
      const replacementRequest = postMessage.mock.calls
        .map(([message]) => message as Record<string, unknown>)
        .filter((message) => message.type === 'REQUEST_PLAYER_RESPONSE')
        .at(-1);
      expect(replacementRequest?.requestVersion).not.toBe(probeRequest.requestVersion);

      dispatchPageBridgeResponse(postMessage, {
        playerResponse: playerResponseWithTracks,
        captionSelection: {
          captionsEnabled: true,
          activeTrack: { kind: 'asr', languageCode: 'en', vssId: 'a.en' },
        },
      });
      await Promise.resolve();
    } finally {
      vi.useRealTimers();
    }

    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledWith('https://captions.test/automatic'));
    const replacementSynchronization = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type === 'VIDEO_CHANGED')
      .at(-1);
    expect(replacementSynchronization?.synchronizationId).not.toBe(initialSynchronizationId);
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      diagnostic: expect.objectContaining({
        stage: 'track-policy',
        details: expect.objectContaining({ source: 'automatic', selection: 'active' }),
      }),
    })));
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

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      videoId: 'video-1',
      progress: {
        capturedAtMs: 500,
        cues: [expect.objectContaining({ id: 'progress-0', text: 'Hello' })],
        activeGroup: { cueIds: ['progress-0'], startMs: 500 },
      },
    })));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({ isEnglish: true }),
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

  it('publishes fast rendered progress when an automatic Caption Track has no timedtext body', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    let currentTime = 29;
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, get: () => currentTime });
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'I';
    document.body.append(video, segment);
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      text: async () => '',
    } as Response) as unknown as typeof fetch;

    const { sendMessage } = await loadContentScriptRuntime({
      fetchImpl,
      waitForInitialResult: false,
    });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      progress: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'I' })],
      }),
    })));
    sendMessage.mockClear();

    currentTime = 29.2;
    segment.textContent = 'National League guy,.....Almost';
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      progress: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'National League guy,.....Almost' })],
      }),
    })));
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

  it.each(['top-level video', 'nested video', 'request version', 'active track shape'] as const)(
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
          : boundary === 'active track shape'
            ? { captionSelection: { captionsEnabled: true, activeTrack: { vssId: 1 } } }
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

  it('rejects a bridge response after its synchronization has reached a terminal error', async () => {
    setVideoUrl();
    const { postMessage, sendMessage, fetchMock } = await loadContentScriptRuntime({
      captionResponse: matchingPlayerResponse,
      waitForInitialResult: false,
    });
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    })));
    const fetchCallCount = vi.mocked(fetchMock).mock.calls.length;

    dispatchPageBridgeResponse(postMessage);

    expect(fetchMock).toHaveBeenCalledTimes(fetchCallCount);
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

  it('starts a new correlated synchronization only for an explicit Retry action', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const { onMessage, postMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    const previousIdentity = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'VIDEO_CHANGED')?.synchronizationId;
    const retryMessage = forCurrentSynchronization(sendMessage, { type: 'RETRY_CAPTIONS' });
    postMessage.mockClear();
    sendMessage.mockClear();

    onMessage?.(retryMessage);

    expect(postMessage).toHaveBeenCalledWith(expect.objectContaining({
      source: 'youtube-english-learning',
      type: 'REQUEST_PLAYER_RESPONSE',
      videoId: 'video-1',
      requestVersion: expect.any(Number),
    }), '*');
    const nextIdentity = sendMessage.mock.calls
      .map(([message]) => message)
      .find((message) => message.type === 'VIDEO_CHANGED')?.synchronizationId;
    expect(nextIdentity).toBeDefined();
    expect(nextIdentity).not.toBe(previousIdentity);
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

  it('does not let an older failed synchronization replace a newer complete Caption Track', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
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

    onMessage?.(forCurrentSynchronization(sendMessage, { type: 'RETRY_CAPTIONS' }));
    await vi.waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'Newest complete caption' })],
      }),
    })));
    sendMessage.mockClear();

    resolveOlderFetch({ ok: false, status: 500, text: async () => '' } as Response);
    await olderFetch;
    await Promise.resolve();
    onMessage?.({ type: 'REQUEST_STATE' });

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    }));
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
      track: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'Newest complete caption' })],
      }),
    }));
  });

  it('keeps rendered DOM captions as current progress without creating a partial Learning Transcript', async () => {
    setVideoUrl();
    const video = document.createElement('video');
    Object.defineProperty(video, 'currentTime', { configurable: true, value: 10 });
    const segment = document.createElement('span');
    segment.className = 'ytp-caption-segment';
    segment.textContent = 'Visible current caption.';
    document.body.append(video, segment);

    const { sendMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_PROGRESS_UPDATED',
      progress: expect.objectContaining({
        cues: [expect.objectContaining({ text: 'Visible current caption.' })],
      }),
    })));
    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    })));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTIONS_UPDATED',
    }));
  });

  it('publishes no partial rows or false Ready state after complete timedtext download fails', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const { sendMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'retryable-error' }),
    })));

    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'CAPTIONS_UPDATED' }));
    expect(sendMessage).not.toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      lifecycle: expect.objectContaining({ status: 'ready' }),
    }));
  });

  it('reports the failure source and actionable Retry step', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const { sendMessage } = await loadContentScriptRuntime({ waitForInitialResult: false });

    await vi.waitFor(() => expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'CAPTION_DIAGNOSTIC',
      videoId: 'video-1',
      diagnostic: expect.objectContaining({
        stage: 'timedtext-download',
        status: 'error',
        code: 'CAPTION_FETCH_FAILED',
        details: expect.objectContaining({
          source: 'timedtext',
          action: 'retry',
        }),
      }),
    })));
  });
  it('replays VIDEO_CHANGED and No English Track lifecycle for REQUEST_STATE', async () => {
    setVideoUrl();
    setPlayerResponseScript({ videoDetails: { videoId: 'video-1' }, captions: {} });
    const video = document.createElement('video');
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime();
    sendMessage.mockClear();

    onMessage?.({ type: 'REQUEST_STATE' });

    const replayedState = sendMessage.mock.calls
      .map(([message]) => message)
      .filter((message) => message.type !== 'CAPTION_DIAGNOSTIC');
    expect(replayedState[0]).toEqual(expect.objectContaining({ type: 'VIDEO_CHANGED', videoId: 'video-1' }));
    expect(replayedState[1]).toEqual(expect.objectContaining({
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId: 'video-1',
      lifecycle: expect.objectContaining({ status: 'no-english-track' }),
    }));
    expect(replayedState[2]).toEqual(expect.objectContaining({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      currentTimeMs: 0,
    }));
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
    expect(replayedState.at(-1)).toEqual(expect.objectContaining({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 12345 }));
  });

  it.each([true, false])('jumps without changing a paused=%s playback intent', async (paused) => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'paused', { configurable: true, value: paused });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    const jumpMessage = forCurrentSynchronization(sendMessage, { type: 'JUMP_TO_HERE', timeMs: 500 });
    sendMessage.mockClear();
    onMessage?.({
      ...jumpMessage,
      synchronizationId: `${jumpMessage.synchronizationId}:stale`,
    });
    expect(video.currentTime).toBe(12);
    expect(sendMessage).not.toHaveBeenCalled();

    onMessage?.(jumpMessage);

    expect(video.currentTime).toBe(0.5);
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ type: 'PLAYBACK_UPDATED', videoId: 'video-1', currentTimeMs: 500 }));
  });

  it('pauses and resumes Focused Study without seeking', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });
    const pauseMessage = forCurrentSynchronization(sendMessage, { type: 'PAUSE_PLAYBACK' });
    const resumeMessage = forCurrentSynchronization(sendMessage, { type: 'RESUME_PLAYBACK' });
    sendMessage.mockClear();

    onMessage?.(pauseMessage);
    expect(video.currentTime).toBe(12);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      currentTimeMs: 12_000,
    }));

    onMessage?.(resumeMessage);
    expect(video.currentTime).toBe(12);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('plays continuously from an explicit historical time', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    onMessage?.(forCurrentSynchronization(sendMessage, { type: 'PLAY_FROM_HERE', timeMs: 500 }));

    expect(video.currentTime).toBe(0.5);
    expect(play).toHaveBeenCalledTimes(1);
  });

  it('replays one range and pauses at its end', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    onMessage?.(forCurrentSynchronization(sendMessage, { type: 'REPLAY_RANGE', startMs: 500, endMs: 1_500 }));
    expect(video.currentTime).toBe(0.5);
    expect(play).toHaveBeenCalledTimes(1);
    video.currentTime = 1.5;
    video.dispatchEvent(new Event('timeupdate'));

    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('clamps an overshooting Replay Range to its exact end before pausing', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    onMessage?.(forCurrentSynchronization(sendMessage, { type: 'REPLAY_RANGE', startMs: 500, endMs: 1_500 }));
    video.currentTime = 1.75;
    video.dispatchEvent(new Event('timeupdate'));
    expect(video.currentTime).toBe(1.5);
    expect(pause).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'PLAYBACK_UPDATED',
      videoId: 'video-1',
      currentTimeMs: 1_500,
    }));
  });

  it('cancels a Replay Range when YouTube navigation reuses the video element', async () => {
    setVideoUrl();
    setPlayerResponseScript(playerResponse);
    const video = document.createElement('video');
    const play = vi.fn().mockResolvedValue(undefined);
    const pause = vi.fn();
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 12 });
    Object.defineProperty(video, 'play', { configurable: true, value: play });
    Object.defineProperty(video, 'pause', { configurable: true, value: pause });
    document.body.append(video);
    const { onMessage, sendMessage } = await loadContentScriptRuntime({ captionResponse: playerResponse });

    onMessage?.(forCurrentSynchronization(sendMessage, { type: 'REPLAY_RANGE', startMs: 500, endMs: 1_500 }));
    document.dispatchEvent(new Event('yt-navigate-finish'));
    video.currentTime = 1.5;
    video.dispatchEvent(new Event('timeupdate'));

    expect(pause).not.toHaveBeenCalled();
  });
});
