export const PAGE_BRIDGE_SOURCE = 'youtube-english-learning';
export const REQUEST_PLAYER_RESPONSE = 'REQUEST_PLAYER_RESPONSE';
export const PLAYER_RESPONSE = 'PLAYER_RESPONSE';

const retryDelayMs = 50;
const retryCount = 3;

type CaptionTrack = {
  baseUrl?: string;
  kind?: string;
  languageCode?: string;
  name?: { simpleText?: string };
  vssId?: string;
};

type ActiveCaptionTrack = {
  kind?: string;
  languageCode?: string;
  name?: string;
  vssId?: string;
};

type CaptionSelection = {
  captionsEnabled: boolean;
  activeTrack?: ActiveCaptionTrack;
};

export type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrack[];
    };
  };
};

type PageWindow = Window & {
  ytInitialPlayerResponse?: PlayerResponse;
  ytplayer?: { player?: { getPlayerResponse?: () => unknown } };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function extractJsonObject(source: string, startIndex: number): string | undefined {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const character = source[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return undefined;
}

function parsePlayerResponseScript(scriptContent: string): PlayerResponse | undefined {
  const marker = scriptContent.indexOf('ytInitialPlayerResponse');
  if (marker < 0) {
    return undefined;
  }

  const equals = scriptContent.indexOf('=', marker + 'ytInitialPlayerResponse'.length);
  if (equals < 0) {
    return undefined;
  }

  const objectStart = equals + 1 + (scriptContent.slice(equals + 1).match(/^\s*/) ?? [''])[0].length;
  if (scriptContent[objectStart] !== '{') {
    return undefined;
  }

  const objectContent = extractJsonObject(scriptContent, objectStart);
  if (!objectContent) {
    return undefined;
  }

  try {
    return JSON.parse(objectContent) as PlayerResponse;
  } catch {
    return undefined;
  }
}

function getCaptionTracks(response: unknown): CaptionTrack[] | undefined {
  if (!isRecord(response)) {
    return undefined;
  }

  const captions = response.captions;
  if (!isRecord(captions) || !isRecord(captions.playerCaptionsTracklistRenderer)) {
    return undefined;
  }

  const tracks = captions.playerCaptionsTracklistRenderer.captionTracks;
  return Array.isArray(tracks) ? tracks.filter(isRecord).map((track) => {
    const sanitized: CaptionTrack = {};
    if (typeof track.baseUrl === 'string') {
      sanitized.baseUrl = track.baseUrl;
    }
    if (typeof track.languageCode === 'string') {
      sanitized.languageCode = track.languageCode;
    }
    if (isRecord(track.name) && typeof track.name.simpleText === 'string') {
      sanitized.name = { simpleText: track.name.simpleText };
    }
    if (typeof track.kind === 'string') {
      sanitized.kind = track.kind;
    }
    if (typeof track.vssId === 'string') {
      sanitized.vssId = track.vssId;
    }
    return sanitized;
  }) : undefined;
}

function sanitizeActiveTrack(value: unknown): ActiveCaptionTrack | undefined {
  if (!isRecord(value)) return undefined;
  const activeTrack: ActiveCaptionTrack = {};
  const kind = value.kind;
  const languageCode = value.languageCode ?? value.language_code;
  const vssId = value.vssId ?? value.vss_id;
  const name = isRecord(value.name) ? value.name.simpleText : value.name;
  if (typeof kind === 'string') activeTrack.kind = kind;
  if (typeof languageCode === 'string') activeTrack.languageCode = languageCode;
  if (typeof name === 'string') activeTrack.name = name;
  if (typeof vssId === 'string') activeTrack.vssId = vssId;
  return Object.keys(activeTrack).length > 0 ? activeTrack : undefined;
}

function getCaptionSelection(pageDocument: Document): CaptionSelection {
  const moviePlayer = pageDocument.getElementById('movie_player') as (HTMLElement & {
    getOption?: (namespace: string, option: string) => unknown;
  }) | null;
  let activeTrack: ActiveCaptionTrack | undefined;
  try {
    activeTrack = sanitizeActiveTrack(moviePlayer?.getOption?.('captions', 'track'));
  } catch {
    activeTrack = undefined;
  }
  const captionsEnabled = pageDocument
    .querySelector('.ytp-subtitles-button')
    ?.getAttribute('aria-pressed') === 'true';
  return {
    captionsEnabled,
    ...(activeTrack ? { activeTrack } : {}),
  };
}

function hasExactVideoIdentity(response: unknown, expectedVideoId: string): response is PlayerResponse {
  return isRecord(response)
    && isRecord(response.videoDetails)
    && response.videoDetails.videoId === expectedVideoId;
}

function hasUsableCaptions(response: unknown, expectedVideoId: string): response is PlayerResponse {
  return hasExactVideoIdentity(response, expectedVideoId)
    && Boolean(getCaptionTracks(response)?.length);
}

function getPagePlayerResponse(
  pageWindow: Window,
  pageDocument: Document,
  expectedVideoId: string,
): PlayerResponse | undefined {
  const typedWindow = pageWindow as PageWindow;
  const moviePlayer = pageDocument.getElementById('movie_player') as (HTMLElement & {
    getPlayerResponse?: () => unknown;
  }) | null;
  const liveCandidates = [
    moviePlayer?.getPlayerResponse?.(),
    typedWindow.ytplayer?.player?.getPlayerResponse?.(),
  ];
  for (const candidate of liveCandidates) {
    if (hasUsableCaptions(candidate, expectedVideoId)) {
      return candidate;
    }
  }

  const parsedScriptResponses = Array.from(pageDocument.scripts)
    .map((script) => parsePlayerResponseScript(script.textContent ?? ''))
    .filter((response): response is PlayerResponse => response !== undefined);
  const laterCandidates = [typedWindow.ytInitialPlayerResponse, ...parsedScriptResponses];
  for (const candidate of laterCandidates) {
    if (hasUsableCaptions(candidate, expectedVideoId)) {
      return candidate;
    }
  }

  return undefined;
}

export function createPageBridgeMessageHandler(
  pageWindow: Window,
  pageDocument: Document,
): (event: MessageEvent<unknown>) => void {
  return (event) => {
    if (event.source !== pageWindow || !isRecord(event.data)) {
      return;
    }

    if (event.data.source !== PAGE_BRIDGE_SOURCE || event.data.type !== REQUEST_PLAYER_RESPONSE) {
      return;
    }

    const requestVersion = event.data.requestVersion;
    if (typeof event.data.videoId !== 'string'
      || typeof requestVersion !== 'number'
      || !Number.isInteger(requestVersion)
      || requestVersion < 0) {
      return;
    }

    const requestedVideoId = event.data.videoId;
    let attempts = 0;
    const respondIfReady = () => {
      const currentVideoId = new URL(pageWindow.location.href).searchParams.get('v');
      if (currentVideoId !== requestedVideoId) {
        return;
      }

      const response = getPagePlayerResponse(pageWindow, pageDocument, requestedVideoId);
      const captionTracks = getCaptionTracks(response);
      if (response && captionTracks?.length) {
        pageWindow.postMessage({
          source: PAGE_BRIDGE_SOURCE,
          type: PLAYER_RESPONSE,
          videoId: requestedVideoId,
          requestVersion,
          playerResponse: {
            videoDetails: { videoId: requestedVideoId },
            captions: {
              playerCaptionsTracklistRenderer: { captionTracks },
            },
          },
          captionSelection: getCaptionSelection(pageDocument),
        }, '*');
        return;
      }

      if (attempts < retryCount) {
        attempts += 1;
        setTimeout(respondIfReady, retryDelayMs);
      }
    };

    respondIfReady();
  };
}

if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  window.addEventListener('message', createPageBridgeMessageHandler(window, document));
}
