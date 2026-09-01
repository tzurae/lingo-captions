import { beforeEach, describe, expect, it, vi } from 'vitest';

const bridgeSource = 'youtube-english-learning';
const requestType = 'REQUEST_PLAYER_RESPONSE';
const responseType = 'PLAYER_RESPONSE';
const request = {
  source: bridgeSource,
  type: requestType,
  videoId: 'video-1',
  requestVersion: 7,
};

function responseFor(videoId: string, baseUrl: string) {
  return {
    captions: {
      playerCaptionsTracklistRenderer: {
        captionTracks: [{
          baseUrl,
          kind: baseUrl.includes('automatic') ? 'asr' : undefined,
          languageCode: 'en',
          name: { simpleText: 'English' },
          vssId: baseUrl.includes('automatic') ? 'a.en' : '.en',
        }],
      },
    },
    videoDetails: { videoId },
  };
}

const playerResponse = responseFor('video-1', 'https://captions.test/track');

function setPlayerResponseScript(response: object): void {
  const script = document.createElement('script');
  script.textContent = `var ytInitialPlayerResponse = ${JSON.stringify(response)};`;
  document.body.append(script);
}

function pageWindowFor(
  videoId: string,
  postMessage: ReturnType<typeof vi.fn>,
  additions: Record<string, unknown> = {},
): Window {
  return {
    ...window,
    ...additions,
    location: { href: `https://www.youtube.com/watch?v=${videoId}` },
    postMessage,
  } as unknown as Window;
}

function installMoviePlayer(response: object, activeTrack?: object): void {
  const player = document.createElement('div');
  player.id = 'movie_player';
  const typedPlayer = player as HTMLDivElement & {
    getOption: (namespace: string, option: string) => object | undefined;
    getPlayerResponse: () => object;
  };
  typedPlayer.getPlayerResponse = () => response;
  typedPlayer.getOption = (namespace, option) => (
    namespace === 'captions' && option === 'track' ? activeTrack : undefined
  );
  document.body.append(player);
}

function expectedBridgeResponse(response = playerResponse) {
  return {
    source: bridgeSource,
    type: responseType,
    videoId: 'video-1',
    requestVersion: 7,
    playerResponse: {
      videoDetails: { videoId: 'video-1' },
      captions: response.captions,
    },
    captionSelection: { captionsEnabled: false },
  };
}

function postBridgeRequest(
  handler: (event: MessageEvent<unknown>) => void,
  pageWindow: Window,
  data = request,
): void {
  handler(new MessageEvent('message', {
    source: pageWindow,
    data,
  }));
}

describe('page bridge', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('posts only caption track data for an exact bridge request', async () => {
    setPlayerResponseScript(playerResponse);
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage);
    const { createPageBridgeMessageHandler } = await import('./page-bridge');

    postBridgeRequest(createPageBridgeMessageHandler(pageWindow, document), pageWindow);

    expect(postMessage).toHaveBeenCalledWith(expectedBridgeResponse(), '*');
  });

  it('reads a usable player response from the movie player when no initial response exists', async () => {
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage);
    installMoviePlayer(playerResponse);
    const { createPageBridgeMessageHandler } = await import('./page-bridge');

    postBridgeRequest(createPageBridgeMessageHandler(pageWindow, document), pageWindow);

    expect(postMessage).toHaveBeenCalledWith(expectedBridgeResponse(), '*');
  });

  it('prefers the current movie player over a stale SPA initial response', async () => {
    const oldResponse = responseFor('old-video', 'https://captions.test/old');
    const currentResponse = responseFor('video-1', 'https://captions.test/current');
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage, { ytInitialPlayerResponse: oldResponse });
    installMoviePlayer(currentResponse);

    const { createPageBridgeMessageHandler } = await import('./page-bridge');
    postBridgeRequest(createPageBridgeMessageHandler(pageWindow, document), pageWindow);

    expect(postMessage).toHaveBeenCalledWith(expectedBridgeResponse(currentResponse), '*');
    expect(postMessage.mock.calls[0][0].playerResponse.captions).toEqual(currentResponse.captions);
  });

  it('discovers the active automatic Caption Track when YouTube CC is enabled', async () => {
    const automaticResponse = responseFor('video-1', 'https://captions.test/automatic');
    const activeTrack = {
      kind: 'asr',
      languageCode: 'en',
      name: { simpleText: 'English (auto-generated)' },
      vssId: 'a.en',
    };
    const ccButton = document.createElement('button');
    ccButton.className = 'ytp-subtitles-button';
    ccButton.setAttribute('aria-pressed', 'true');
    document.body.append(ccButton);
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage);
    installMoviePlayer(automaticResponse, activeTrack);
    const { createPageBridgeMessageHandler } = await import('./page-bridge');

    postBridgeRequest(createPageBridgeMessageHandler(pageWindow, document), pageWindow);

    expect(postMessage.mock.calls[0][0].captionSelection).toEqual({
      captionsEnabled: true,
      activeTrack: {
        kind: 'asr',
        languageCode: 'en',
        name: 'English (auto-generated)',
        vssId: 'a.en',
      },
    });
    expect(postMessage.mock.calls[0][0].playerResponse.captions)
      .toEqual(automaticResponse.captions);
  });

  it('retries a request after the page data becomes available', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn();
      const pageWindow = pageWindowFor('video-1', postMessage);
      const { createPageBridgeMessageHandler } = await import('./page-bridge');
      const handleMessage = createPageBridgeMessageHandler(pageWindow, document);

      postBridgeRequest(handleMessage, pageWindow);
      setPlayerResponseScript(playerResponse);

      await vi.advanceTimersByTimeAsync(100);

      expect(postMessage).toHaveBeenCalledWith(expectedBridgeResponse(), '*');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancels retry when navigation changes the page video id', async () => {
    vi.useFakeTimers();
    try {
      const postMessage = vi.fn();
      const pageWindow = pageWindowFor('video-1', postMessage);
      const { createPageBridgeMessageHandler } = await import('./page-bridge');
      const handleMessage = createPageBridgeMessageHandler(pageWindow, document);

      postBridgeRequest(handleMessage, pageWindow);
      pageWindow.location.href = 'https://www.youtube.com/watch?v=video-2';
      setPlayerResponseScript(playerResponse);

      await vi.advanceTimersByTimeAsync(100);

      expect(postMessage).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it.each([
    ['missing identity', { captions: playerResponse.captions }, 7],
    ['wrong identity', responseFor('old-video', 'https://captions.test/old'), 7],
    ['invalid version', playerResponse, -1],
  ])('does not post %s', async (_label, response, requestVersion) => {
    setPlayerResponseScript(response);
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage);
    const { createPageBridgeMessageHandler } = await import('./page-bridge');

    postBridgeRequest(createPageBridgeMessageHandler(pageWindow, document), pageWindow, {
      ...request,
      requestVersion,
    });

    expect(postMessage).not.toHaveBeenCalled();
  });

  it('ignores messages that do not use the exact bridge protocol or page source', async () => {
    setPlayerResponseScript(playerResponse);
    const postMessage = vi.fn();
    const pageWindow = pageWindowFor('video-1', postMessage);
    const foreignWindow = {} as Window;
    const { createPageBridgeMessageHandler } = await import('./page-bridge');
    const handleMessage = createPageBridgeMessageHandler(pageWindow, document);

    handleMessage(new MessageEvent('message', {
      source: pageWindow,
      data: { source: 'other-extension', type: requestType, videoId: 'video-1', requestVersion: 7 },
    }));
    handleMessage(new MessageEvent('message', {
      source: pageWindow,
      data: { source: bridgeSource, type: 'OTHER_REQUEST', videoId: 'video-1', requestVersion: 7 },
    }));
    handleMessage(new MessageEvent('message', {
      source: pageWindow,
      data: { source: bridgeSource, type: requestType, requestVersion: 7 },
    }));
    handleMessage(new MessageEvent('message', {
      source: pageWindow,
      data: { source: bridgeSource, type: requestType, videoId: 'video-1' },
    }));
    handleMessage(new MessageEvent('message', {
      source: foreignWindow,
      data: request,
    }));

    expect(postMessage).not.toHaveBeenCalled();
  });
});
