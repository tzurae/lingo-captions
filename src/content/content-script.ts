import type { CaptionDiagnostic, ContentMessage, SidePanelContentMessage } from '../domain/types';
import { parseCaptionTrack, type RawCaptionCue, type RawCaptionTrack } from './youtube-captions';
import { createVisibleCaptionFallback, type VisibleCaptionFallback } from './visible-caption-fallback';
import { createRenderedCaptionProgressMonitor, type RenderedCaptionProgressMonitor } from './rendered-caption-progress-monitor';

type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrackResponse[];
    };
  };
};

type CorrelatedPlayerResponse = {
  videoId: string;
  requestVersion: number;
  playerResponse: PlayerResponse;
};

const pageBridgeSource = 'youtube-english-learning';
const requestPlayerResponseType = 'REQUEST_PLAYER_RESPONSE';
const playerResponseType = 'PLAYER_RESPONSE';
const playerResponseRetryDelayMs = 50;
const playerResponseRetryCount = 3;

type CaptionTrackResponse = {
  baseUrl?: string;
  languageCode?: string;
  name?: { simpleText?: string };
};

type CaptionResult =
  | { type: 'track'; track: RawCaptionTrack }
  | { type: 'no-captions'; reason: 'not-found' | 'not-english' | 'unsupported'; diagnostic: CaptionDiagnostic };

type SynchronizableMessage = Extract<ContentMessage, { type: 'VIDEO_CHANGED' | 'CAPTIONS_UPDATED' | 'CAPTION_PROGRESS_UPDATED' | 'NO_CAPTIONS' | 'CAPTION_DIAGNOSTIC' }>;

const playbackIntervalMs = 250;
let lastPlaybackMessageAt = Number.NEGATIVE_INFINITY;
let activeVideo: HTMLVideoElement | null = null;
let currentState: SynchronizableMessage[] = [];
let visibleCaptionFallback: VisibleCaptionFallback | null = null;
let renderedCaptionProgressMonitor: RenderedCaptionProgressMonitor | null = null;
let synchronizationVersion = 0;

function sendMessage(message: ContentMessage): void {
  const monitorAtSend = renderedCaptionProgressMonitor ?? visibleCaptionFallback;
  try {
    const pending = chrome.runtime.sendMessage(message);
    void pending?.catch?.(() => monitorAtSend?.stop());
  } catch {
    monitorAtSend?.stop();
  }
}

function diagnosticMessage(videoId: string, diagnostic: CaptionDiagnostic): SynchronizableMessage {
  return { type: 'CAPTION_DIAGNOSTIC', videoId, diagnostic };
}

function getVideoId(): string | null {
  return new URL(window.location.href).searchParams.get('v');
}

function getVideoTitle(): string {
  return document.querySelector('h1 yt-formatted-string')?.textContent?.trim() || document.title;
}

function isEnglishTrack(track: CaptionTrackResponse): boolean {
  const language = (track.languageCode ?? track.name?.simpleText ?? '').trim().toLowerCase();
  return language === 'english' || language === 'en' || language.startsWith('en-');
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

export function parsePlayerResponseScript(scriptContent: string): PlayerResponse | undefined {
  const assignment = /(?:^|[;\n])\s*(?:(?:var|let|const)\s+)?(?:window\.)?ytInitialPlayerResponse\s*=\s*/m.exec(scriptContent);
  if (!assignment) {
    return undefined;
  }

  const objectStart = assignment.index + assignment[0].length;
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

function hasExactVideoId(response: PlayerResponse | undefined, videoId: string): response is PlayerResponse {
  return response?.videoDetails?.videoId === videoId;
}

export function getPlayerResponseFromDocument(
  pageDocument: Document,
  fallback: PlayerResponse | undefined,
  expectedVideoId: string,
): PlayerResponse | undefined {
  for (const script of Array.from(pageDocument.scripts)) {
    const playerResponse = parsePlayerResponseScript(script.textContent ?? '');
    if (hasExactVideoId(playerResponse, expectedVideoId)) {
      return playerResponse;
    }
  }

  return hasExactVideoId(fallback, expectedVideoId) ? fallback : undefined;
}

function getPlayerResponse(videoId: string): PlayerResponse | undefined {
  const fallback = (window as Window & { ytInitialPlayerResponse?: PlayerResponse }).ytInitialPlayerResponse;
  return getPlayerResponseFromDocument(document, fallback, videoId);
}

function requestPlayerResponse(videoId: string, requestVersion: number): void {
  window.postMessage({
    source: pageBridgeSource,
    type: requestPlayerResponseType,
    videoId,
    requestVersion,
  }, '*');
}

function waitForPlayerResponse(
  videoId: string,
  requestVersion: number,
  requestFirst: boolean,
): Promise<PlayerResponse | undefined> {
  return new Promise((resolve) => {
    let attempts = 0;
    let initialRequestSent = false;
    const tryRead = () => {
      if (getVideoId() !== videoId || requestVersion !== synchronizationVersion) {
        resolve(undefined);
        return;
      }

      if (requestFirst && !initialRequestSent) {
        requestPlayerResponse(videoId, requestVersion);
        initialRequestSent = true;
      }

      const response = getPlayerResponse(videoId);
      if (response) {
        resolve(response);
        return;
      }

      if (!requestFirst || attempts > 0) {
        requestPlayerResponse(videoId, requestVersion);
      }
      if (attempts >= playerResponseRetryCount) {
        resolve(undefined);
        return;
      }

      attempts += 1;
      window.setTimeout(tryRead, playerResponseRetryDelayMs);
    };

    tryRead();
  });
}

function isPlayerResponseMessage(message: unknown): message is CorrelatedPlayerResponse & {
  source: typeof pageBridgeSource;
  type: typeof playerResponseType;
} {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as Record<string, unknown>;
  const response = candidate.playerResponse as PlayerResponse | undefined;
  return candidate.source === pageBridgeSource
    && candidate.type === playerResponseType
    && typeof candidate.videoId === 'string'
    && typeof candidate.requestVersion === 'number'
    && Number.isInteger(candidate.requestVersion)
    && candidate.requestVersion >= 0
    && response?.videoDetails?.videoId === candidate.videoId;
}

function parseCaptionXml(xml: string): RawCaptionCue[] {
  const documentElement = new DOMParser().parseFromString(xml, 'text/xml');

  return Array.from(documentElement.querySelectorAll('text')).flatMap((element) => {
    const startSeconds = Number.parseFloat(element.getAttribute('start') ?? '');
    const durationSeconds = Number.parseFloat(element.getAttribute('dur') ?? '');

    if (!Number.isFinite(startSeconds) || !Number.isFinite(durationSeconds)) {
      return [];
    }

    return [{
      startMs: Math.round(startSeconds * 1000),
      endMs: Math.round((startSeconds + durationSeconds) * 1000),
      text: element.textContent ?? '',
    }];
  });
}

async function findEnglishCaptionTrack(response: PlayerResponse | undefined): Promise<CaptionResult> {
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks;

  if (!tracks?.length) {
    return {
      type: 'no-captions',
      reason: 'not-found',
      diagnostic: response
        ? { stage: 'caption-tracks', status: 'error', code: 'CAPTION_TRACKS_MISSING', message: '播放器資料中沒有字幕軌。' }
        : { stage: 'player-response', status: 'error', code: 'PLAYER_RESPONSE_MISSING', message: '無法取得 YouTube 播放器資料。' },
    };
  }

  const track = tracks.find(isEnglishTrack);
  if (!track) {
    return {
      type: 'no-captions',
      reason: 'not-english',
      diagnostic: {
        stage: 'english-track',
        status: 'error',
        code: 'ENGLISH_TRACK_MISSING',
        message: '找到字幕軌，但沒有英文字幕軌。',
        details: { trackCount: tracks.length, languages: tracks.map((item) => item.languageCode ?? item.name?.simpleText ?? 'unknown') },
      },
    };
  }

  if (!track.baseUrl) {
    return {
      type: 'no-captions',
      reason: 'unsupported',
      diagnostic: { stage: 'timedtext-download', status: 'error', code: 'CAPTION_URL_MISSING', message: '英文字幕軌缺少可下載的字幕網址。' },
    };
  }

  try {
    const response = await fetch(track.baseUrl);
    if (!response.ok) {
      return {
        type: 'no-captions',
        reason: 'unsupported',
        diagnostic: {
          stage: 'timedtext-download',
          status: 'error',
          code: 'CAPTION_FETCH_FAILED',
          message: `字幕下載失敗（HTTP ${response.status || 'unknown'}）。`,
          details: { httpStatus: response.status || 0 },
        },
      };
    }

    const cues = parseCaptionXml(await response.text());
    if (!cues.length) {
      return {
        type: 'no-captions',
        reason: 'unsupported',
        diagnostic: { stage: 'timedtext-parse', status: 'error', code: 'CAPTION_PARSE_EMPTY', message: '字幕檔下載成功，但解析不到任何字幕內容。' },
      };
    }

    return {
      type: 'track',
      track: {
        language: track.languageCode ?? track.name?.simpleText ?? 'English',
        cues,
      },
    };
  } catch (reason) {
    return {
      type: 'no-captions',
      reason: 'unsupported',
      diagnostic: {
        stage: 'timedtext-download',
        status: 'error',
        code: 'CAPTION_FETCH_EXCEPTION',
        message: `字幕下載發生錯誤：${reason instanceof Error ? reason.message : '未知錯誤'}`,
      },
    };
  }
}

function broadcastState(message: SynchronizableMessage): void {
  sendMessage(message);
}

function isSidePanelContentMessage(message: unknown): message is SidePanelContentMessage {
  if (typeof message !== 'object' || message === null) return false;
  const type = (message as { type?: unknown }).type;
  return type === 'REQUEST_STATE' || (type === 'SEEK_TO_TIME' && typeof (message as { timeMs?: unknown }).timeMs === 'number');
}

function seekToTime(timeMs: number): void {
  const video = document.querySelector('video') ?? activeVideo;
  if (!video) return;
  video.currentTime = Math.max(0, timeMs) / 1000;
  void video.play().catch(() => undefined);
  sendCurrentPlayback();
}

function isRequestStateMessage(message: SidePanelContentMessage): message is Extract<SidePanelContentMessage, { type: 'REQUEST_STATE' }> {
  return message.type === 'REQUEST_STATE';
}

function sendCurrentPlayback(): void {
  const videoId = getVideoId();
  const video = document.querySelector('video') ?? activeVideo;
  if (!videoId || !video) {
    return;
  }

  bindPlayback(video);
  sendMessage({ type: 'PLAYBACK_UPDATED', videoId, currentTimeMs: Math.round(video.currentTime * 1000) });
}

function bindPlayback(video: HTMLVideoElement): void {
  if (video === activeVideo) {
    return;
  }

  activeVideo = video;
  video.addEventListener('timeupdate', () => {
    const videoId = getVideoId();
    const now = Date.now();

    if (!videoId || now - lastPlaybackMessageAt < playbackIntervalMs) {
      return;
    }

    lastPlaybackMessageAt = now;
    sendMessage({ type: 'PLAYBACK_UPDATED', videoId, currentTimeMs: Math.round(video.currentTime * 1000) });
  });
}

function startVisibleCaptionFallback(
  videoId: string,
  videoChangedMessage: SynchronizableMessage,
  failureDiagnostic: SynchronizableMessage,
  version: number,
): boolean {
  visibleCaptionFallback?.stop();
  renderedCaptionProgressMonitor?.stop();
  renderedCaptionProgressMonitor = null;
  const fallbackDiagnostic = diagnosticMessage(videoId, {
    stage: 'visible-dom',
    status: 'fallback',
    code: 'VISIBLE_DOM_FALLBACK_ACTIVE',
    message: '完整字幕抓取失敗，改為讀取 YouTube 畫面上實際顯示的字幕。',
  });
  broadcastState(failureDiagnostic);
  broadcastState(fallbackDiagnostic);

  let captured = false;
  visibleCaptionFallback = createVisibleCaptionFallback({
    document,
    getCurrentTimeMs: () => Math.round((document.querySelector('video')?.currentTime ?? 0) * 1000),
    onSnapshotChanged: ({ cues, activeGroup }) => {
      if (version !== synchronizationVersion || getVideoId() !== videoId) {
        return;
      }
      captured = true;
      const readyDiagnostic = diagnosticMessage(videoId, {
        stage: 'ready',
        status: 'success',
        message: `已從畫面字幕取得 ${cues.length} 句。`,
        details: { cueCount: cues.length, source: 'visible-dom' },
      });
      const captionsUpdatedMessage: SynchronizableMessage = {
        type: 'CAPTIONS_UPDATED',
        videoId,
        videoTitle: getVideoTitle(),
        videoUrl: window.location.href,
        track: {
          language: 'en-visible',
          isEnglish: true,
          source: 'visible-dom',
          cues,
          ...(activeGroup ? { activeGroup } : {}),
        },
      };
      currentState = [videoChangedMessage, fallbackDiagnostic, readyDiagnostic, captionsUpdatedMessage];
      broadcastState(readyDiagnostic);
      broadcastState(captionsUpdatedMessage);
    },
  });
  visibleCaptionFallback.start();
  if (!captured) {
    currentState = [videoChangedMessage, failureDiagnostic, fallbackDiagnostic];
  }
  return captured;
}

function startRenderedCaptionProgressMonitor(videoId: string, version: number): void {
  visibleCaptionFallback?.stop();
  visibleCaptionFallback = null;
  renderedCaptionProgressMonitor?.stop();
  renderedCaptionProgressMonitor = createRenderedCaptionProgressMonitor({
    document,
    getCurrentTimeMs: () => Math.round((document.querySelector('video')?.currentTime ?? 0) * 1000),
    onProgressChanged: (progress) => {
      if (version !== synchronizationVersion || getVideoId() !== videoId) return;
      const progressMessage: SynchronizableMessage = {
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId,
        progress,
      };
      currentState = [
        ...currentState.filter((message) => message.type !== 'CAPTION_PROGRESS_UPDATED'),
        progressMessage,
      ];
      broadcastState(progressMessage);
    },
  });
  renderedCaptionProgressMonitor.start();
}

async function synchronizeVideo(
  sendPlaybackAfter = false,
  requestPlayerResponseFirst = false,
  suppliedPlayerResponse?: PlayerResponse,
): Promise<void> {
  const videoId = getVideoId();
  if (!videoId) {
    return;
  }
  const version = ++synchronizationVersion;
  visibleCaptionFallback?.stop();
  visibleCaptionFallback = null;
  renderedCaptionProgressMonitor?.stop();
  renderedCaptionProgressMonitor = null;

  lastPlaybackMessageAt = Number.NEGATIVE_INFINITY;
  const video = document.querySelector('video');
  if (video) {
    bindPlayback(video);
  }

  const videoChangedMessage: SynchronizableMessage = {
    type: 'VIDEO_CHANGED',
    videoId,
    videoTitle: getVideoTitle(),
    videoUrl: window.location.href,
  };
  currentState = [videoChangedMessage];
  broadcastState(videoChangedMessage);

  const loadingDiagnostic = diagnosticMessage(videoId, {
    stage: 'player-response',
    status: 'running',
    message: '正在讀取 YouTube 播放器與字幕資料。',
  });
  currentState.push(loadingDiagnostic);
  broadcastState(loadingDiagnostic);

  const playerResponse = hasExactVideoId(suppliedPlayerResponse, videoId)
    ? suppliedPlayerResponse
    : await waitForPlayerResponse(videoId, version, requestPlayerResponseFirst);
  if (version !== synchronizationVersion || getVideoId() !== videoId) {
    return;
  }
  const result = await findEnglishCaptionTrack(playerResponse);
  if (version !== synchronizationVersion || getVideoId() !== videoId) {
    return;
  }

  if (result.type === 'no-captions') {
    const failureDiagnostic = diagnosticMessage(videoId, result.diagnostic);
    const capturedVisibleCaption = startVisibleCaptionFallback(videoId, videoChangedMessage, failureDiagnostic, version);
    if (capturedVisibleCaption) {
      if (sendPlaybackAfter) sendCurrentPlayback();
      return;
    }
    const noCaptionsMessage: SynchronizableMessage = { type: 'NO_CAPTIONS', videoId, reason: result.reason };
    currentState = [videoChangedMessage, failureDiagnostic, noCaptionsMessage];
    broadcastState(noCaptionsMessage);
    if (sendPlaybackAfter) {
      sendCurrentPlayback();
    }
    return;
  }

  try {
    const captionsUpdatedMessage: SynchronizableMessage = {
      type: 'CAPTIONS_UPDATED',
      videoId,
      videoTitle: getVideoTitle(),
      videoUrl: window.location.href,
      track: parseCaptionTrack(result.track),
    };
    const readyDiagnostic = diagnosticMessage(videoId, {
      stage: 'ready',
      status: 'success',
      message: `已取得完整英文字幕，共 ${captionsUpdatedMessage.track.cues.length} 句。`,
      details: { cueCount: captionsUpdatedMessage.track.cues.length, source: 'timedtext' },
    });
    currentState = [videoChangedMessage, readyDiagnostic, captionsUpdatedMessage];
    broadcastState(readyDiagnostic);
    broadcastState(captionsUpdatedMessage);
    startRenderedCaptionProgressMonitor(videoId, version);
    if (sendPlaybackAfter) {
      sendCurrentPlayback();
    }
  } catch {
    const noCaptionsMessage: SynchronizableMessage = { type: 'NO_CAPTIONS', videoId, reason: 'unsupported' };
    currentState = [videoChangedMessage, noCaptionsMessage];
    broadcastState(noCaptionsMessage);
    if (sendPlaybackAfter) {
      sendCurrentPlayback();
    }
  }
}

window.addEventListener('message', (event: MessageEvent<unknown>) => {
  if (event.source !== window || !isPlayerResponseMessage(event.data)) {
    return;
  }
  if (getVideoId() !== event.data.videoId) return;
  if (event.data.requestVersion !== synchronizationVersion) return;
  void synchronizeVideo(false, false, event.data.playerResponse);
});

if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isSidePanelContentMessage(message)) {
      return;
    }
    if (message.type === 'SEEK_TO_TIME') {
      seekToTime(message.timeMs);
      return;
    }

    const videoId = getVideoId();
    if (!videoId) return;
    if (currentState.length && currentState[0].videoId === videoId) {
      currentState.forEach(broadcastState);
      sendCurrentPlayback();
    }
    void synchronizeVideo(true, true);
  });
}

document.addEventListener('yt-navigate-finish', () => {
  visibleCaptionFallback?.stop();
  visibleCaptionFallback = null;
  void synchronizeVideo(false, true);
});

void synchronizeVideo(false, true);
