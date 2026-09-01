import type { CaptionDiagnostic, ContentMessage, SidePanelContentMessage } from '../domain/types';
import {
  getCaptionTrackIdentity,
  isEnglishTrack,
  selectEnglishCaptionTrack,
  type CaptionTrackCandidate,
  type CaptionTrackProvenance,
  type CaptionTrackSelectionReason,
} from './caption-track-policy';
import { createRenderedCaptionProgressMonitor, type RenderedCaptionProgressMonitor } from './rendered-caption-progress-monitor';
import {
  findPlayerCaptionRequestUrl,
  parseCaptionJson3,
  parseCaptionTrack,
  type RawCaptionCue,
  type RawCaptionTrack,
} from './youtube-captions';

type PlayerResponse = {
  videoDetails?: { videoId?: string };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: CaptionTrackResponse[];
    };
  };
};

type CaptionSelectionResponse = {
  captionsEnabled: boolean;
  activeTrack?: CaptionTrackCandidate;
};

type CorrelatedPlayerResponse = {
  videoId: string;
  requestVersion: number;
  playerResponse: PlayerResponse;
  captionSelection: CaptionSelectionResponse;
};

const pageBridgeSource = 'youtube-english-learning';
const requestPlayerResponseType = 'REQUEST_PLAYER_RESPONSE';
const playerResponseType = 'PLAYER_RESPONSE';
const playerResponseRetryDelayMs = 50;
const playerResponseRetryCount = 3;

type CaptionTrackResponse = {
  baseUrl?: string;
  kind?: string;
  languageCode?: string;
  name?: { simpleText?: string };
  vssId?: string;
};

type CaptionResult =
  | {
    type: 'track';
    track: RawCaptionTrack;
    trackId: string;
    provenance: CaptionTrackProvenance;
    selectionReason: CaptionTrackSelectionReason;
  }
  | { type: 'no-english-track'; diagnostic: CaptionDiagnostic }
  | { type: 'retryable-error'; diagnostic: CaptionDiagnostic };

type SynchronizableMessage = Extract<ContentMessage, {
  type:
    | 'VIDEO_CHANGED'
    | 'CAPTIONS_UPDATED'
    | 'CAPTION_PROGRESS_UPDATED'
    | 'CAPTION_LIFECYCLE_UPDATED'
    | 'CAPTION_DIAGNOSTIC';
}>;

const playbackIntervalMs = 250;
const adapterInstanceId = typeof globalThis.crypto?.randomUUID === 'function'
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let lastPlaybackMessageAt = Number.NEGATIVE_INFINITY;
let activeVideo: HTMLVideoElement | null = null;
let currentState: SynchronizableMessage[] = [];
let renderedCaptionProgressMonitor: RenderedCaptionProgressMonitor | null = null;
let replayEndMs: number | null = null;
let synchronizationVersion = 0;
let currentSynchronizationId: string | null = null;
let lastKnownTrack: { videoId: string; trackId: string } | null = null;
let observedCaptionSelectionKey: string | null = null;
let captionSelectionProbeTimer: number | undefined;

function sendMessage(message: ContentMessage): void {
  const monitorAtSend = renderedCaptionProgressMonitor;
  try {
    const pending = chrome.runtime.sendMessage(message);
    void pending?.catch?.(() => monitorAtSend?.stop());
  } catch {
    monitorAtSend?.stop();
  }
}

function diagnosticMessage(
  videoId: string,
  synchronizationId: string,
  diagnostic: CaptionDiagnostic,
): SynchronizableMessage {
  return { type: 'CAPTION_DIAGNOSTIC', videoId, synchronizationId, diagnostic };
}

function getVideoId(): string | null {
  return new URL(window.location.href).searchParams.get('v');
}

function getVideoTitle(): string {
  return document.querySelector('h1 yt-formatted-string')?.textContent?.trim() || document.title;
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
): Promise<CorrelatedPlayerResponse | undefined> {
  return new Promise((resolve) => {
    let attempts = 0;
    let retryTimer: number | undefined;
    let settled = false;
    const finish = (response: CorrelatedPlayerResponse | undefined) => {
      if (settled) return;
      settled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
      window.removeEventListener('message', receiveResponse);
      resolve(response);
    };
    const receiveResponse = (event: MessageEvent<unknown>) => {
      if (event.source !== window || !isPlayerResponseMessage(event.data)) return;
      if (event.data.videoId !== videoId || event.data.requestVersion !== requestVersion) return;
      finish(event.data);
    };
    const request = () => {
      if (getVideoId() !== videoId || requestVersion !== synchronizationVersion) {
        finish(undefined);
        return;
      }
      requestPlayerResponse(videoId, requestVersion);
      if (attempts >= playerResponseRetryCount) {
        const playerResponse = getPlayerResponse(videoId);
        finish(playerResponse ? {
          videoId,
          requestVersion,
          playerResponse,
          captionSelection: {
            captionsEnabled: document.querySelector('.ytp-subtitles-button')
              ?.getAttribute('aria-pressed') === 'true',
          },
        } : undefined);
        return;
      }
      attempts += 1;
      retryTimer = window.setTimeout(request, playerResponseRetryDelayMs);
    };

    window.addEventListener('message', receiveResponse);
    request();
  });
}

function hasOptionalStringFields(
  value: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every((field) => value[field] === undefined || typeof value[field] === 'string');
}

function isCaptionTrackResponse(value: unknown): value is CaptionTrackResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  if (!hasOptionalStringFields(candidate, ['baseUrl', 'kind', 'languageCode', 'vssId'])) return false;
  if (candidate.name === undefined) return true;
  if (typeof candidate.name !== 'object' || candidate.name === null || Array.isArray(candidate.name)) {
    return false;
  }
  const name = candidate.name as Record<string, unknown>;
  return name.simpleText === undefined || typeof name.simpleText === 'string';
}

function isActiveTrackResponse(value: unknown): value is CaptionTrackCandidate {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  return hasOptionalStringFields(
    value as Record<string, unknown>,
    ['baseUrl', 'kind', 'languageCode', 'name', 'vssId'],
  );
}

function isPlayerResponsePayload(value: unknown, videoId: string): value is PlayerResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const response = value as Record<string, unknown>;
  if (typeof response.videoDetails !== 'object'
    || response.videoDetails === null
    || Array.isArray(response.videoDetails)
    || (response.videoDetails as Record<string, unknown>).videoId !== videoId) return false;
  if (typeof response.captions !== 'object'
    || response.captions === null
    || Array.isArray(response.captions)) return false;
  const captions = response.captions as Record<string, unknown>;
  if (typeof captions.playerCaptionsTracklistRenderer !== 'object'
    || captions.playerCaptionsTracklistRenderer === null
    || Array.isArray(captions.playerCaptionsTracklistRenderer)) return false;
  const tracks = (captions.playerCaptionsTracklistRenderer as Record<string, unknown>).captionTracks;
  return Array.isArray(tracks) && tracks.every(isCaptionTrackResponse);
}

function isPlayerResponseMessage(message: unknown): message is CorrelatedPlayerResponse & {
  source: typeof pageBridgeSource;
  type: typeof playerResponseType;
} {
  if (typeof message !== 'object' || message === null || Array.isArray(message)) return false;
  const candidate = message as Record<string, unknown>;
  const videoId = candidate.videoId;
  const selection = candidate.captionSelection;
  if (typeof selection !== 'object' || selection === null || Array.isArray(selection)) return false;
  const captionSelection = selection as Record<string, unknown>;
  return candidate.source === pageBridgeSource
    && candidate.type === playerResponseType
    && typeof videoId === 'string'
    && typeof candidate.requestVersion === 'number'
    && Number.isInteger(candidate.requestVersion)
    && candidate.requestVersion >= 0
    && isPlayerResponsePayload(candidate.playerResponse, videoId)
    && typeof captionSelection.captionsEnabled === 'boolean'
    && (captionSelection.activeTrack === undefined
      || isActiveTrackResponse(captionSelection.activeTrack));
}

function captionSelectionKey(selection: CaptionSelectionResponse): string {
  const activeTrack = selection.activeTrack;
  return JSON.stringify([
    selection.captionsEnabled,
    activeTrack?.vssId?.trim() ?? '',
    activeTrack?.baseUrl?.trim() ?? '',
    activeTrack?.languageCode?.trim().toLowerCase() ?? '',
    activeTrack?.kind?.trim().toLowerCase() ?? '',
    activeTrack?.name?.trim().toLowerCase() ?? '',
  ]);
}

function handleCaptionSelectionResponse(event: MessageEvent<unknown>): void {
  if (event.source !== window || !isPlayerResponseMessage(event.data)) return;
  if (event.data.videoId !== getVideoId()
    || event.data.requestVersion !== synchronizationVersion) return;
  const nextSelectionKey = captionSelectionKey(event.data.captionSelection);
  if (observedCaptionSelectionKey === null) {
    observedCaptionSelectionKey = nextSelectionKey;
    return;
  }
  if (nextSelectionKey === observedCaptionSelectionKey) return;
  observedCaptionSelectionKey = nextSelectionKey;
  void synchronizeVideo(false);
}

function scheduleCaptionSelectionProbe(): void {
  if (captionSelectionProbeTimer !== undefined) {
    window.clearTimeout(captionSelectionProbeTimer);
  }
  captionSelectionProbeTimer = window.setTimeout(() => {
    captionSelectionProbeTimer = undefined;
    const videoId = getVideoId();
    if (!videoId || currentSynchronizationId === null) return;
    requestPlayerResponse(videoId, synchronizationVersion);
  }, 100);
}

function handleCaptionControlClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  if (event.target.closest('.ytp-subtitles-button, .ytp-menuitem')) {
    scheduleCaptionSelectionProbe();
  }
}

function handleCaptionShortcut(event: KeyboardEvent): void {
  if (!event.altKey && !event.ctrlKey && !event.metaKey && event.key.toLowerCase() === 'c') {
    scheduleCaptionSelectionProbe();
  }
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

type CaptionDownload = {
  url: string;
  format: 'json3' | 'xml';
};

function captionResourceUrls(): string[] {
  if (typeof globalThis.performance?.getEntriesByType !== 'function') return [];
  try {
    return globalThis.performance.getEntriesByType('resource')
      .map((entry) => entry.name)
      .filter((name) => typeof name === 'string');
  } catch {
    return [];
  }
}

async function resolveCaptionDownload(
  track: CaptionTrackCandidate,
  videoId: string,
  captionsEnabled: boolean,
): Promise<CaptionDownload | undefined> {
  if (track.languageCode) {
    const canObservePlayerRequests = typeof globalThis.performance?.getEntriesByType === 'function';
    const attempts = captionsEnabled && canObservePlayerRequests ? 6 : 0;
    for (let attempt = 0; attempt <= attempts; attempt += 1) {
      const playerUrl = findPlayerCaptionRequestUrl(captionResourceUrls(), {
        videoId,
        languageCode: track.languageCode,
        kind: track.kind,
        trackBaseUrl: track.baseUrl,
        vssId: track.vssId,
        name: track.name,
      });
      if (playerUrl) return { url: playerUrl, format: 'json3' };
      if (attempt < attempts) {
        await new Promise<void>((resolve) => window.setTimeout(resolve, 50));
      }
    }
  }
  return track.baseUrl ? { url: track.baseUrl, format: 'xml' } : undefined;
}

async function findEnglishCaptionTrack(
  response: PlayerResponse,
  captionSelection: CaptionSelectionResponse,
  lastKnownTrackId: string | null,
  videoId: string,
): Promise<CaptionResult> {
  const tracks = response.captions?.playerCaptionsTracklistRenderer?.captionTracks;
  if (!tracks?.length) {
    return {
      type: 'no-english-track',
      diagnostic: {
        stage: 'caption-tracks',
        status: 'error',
        code: 'CAPTION_TRACKS_MISSING',
        message: '播放器資料中沒有英文字幕軌。',
        details: { source: 'youtube-player', action: 'enable-english-cc-or-choose-another-video' },
      },
    };
  }

  const candidates = tracks.map((track): CaptionTrackCandidate => ({
    baseUrl: track.baseUrl,
    kind: track.kind,
    languageCode: track.languageCode,
    name: track.name?.simpleText,
    vssId: track.vssId,
  }));
  if (captionSelection.captionsEnabled && !captionSelection.activeTrack) {
    return {
      type: 'retryable-error',
      diagnostic: {
        stage: 'track-policy',
        status: 'error',
        code: 'ACTIVE_TRACK_MISSING',
        message: 'YouTube 已開啟 CC，但目前 active Caption Track identity 尚未就緒。',
        details: { source: 'youtube-player', action: 'retry' },
      },
    };
  }

  const selection = selectEnglishCaptionTrack(candidates, {
    captionsEnabled: captionSelection.captionsEnabled,
    activeTrack: captionSelection.activeTrack,
    lastKnownTrackId,
    lastKnownTrack: captionSelection.captionsEnabled ? null : captionSelection.activeTrack,
  });

  if (!selection) {
    const activeTrack = captionSelection.activeTrack;
    const hasActiveLanguageIdentity = Boolean(
      activeTrack?.languageCode?.trim() || activeTrack?.vssId?.trim(),
    );
    const activeTrackIsUnresolvedEnglish = captionSelection.captionsEnabled
      && activeTrack !== undefined
      && (!hasActiveLanguageIdentity || isEnglishTrack(activeTrack));
    if (activeTrackIsUnresolvedEnglish) {
      return {
        type: 'retryable-error',
        diagnostic: {
          stage: 'track-policy',
          status: 'error',
          code: 'ACTIVE_TRACK_UNRESOLVED',
          message: 'YouTube active English Caption Track 尚無法唯一對應到播放器字幕軌。',
          details: {
            source: 'youtube-player',
            action: 'retry',
            ...(activeTrack?.languageCode ? { activeLanguage: activeTrack.languageCode } : {}),
          },
        },
      };
    }
    const activeTrackIsNonEnglish = captionSelection.captionsEnabled && activeTrack !== undefined;
    return {
      type: 'no-english-track',
      diagnostic: {
        stage: activeTrackIsNonEnglish ? 'track-policy' : 'english-track',
        status: 'error',
        code: activeTrackIsNonEnglish ? 'ACTIVE_TRACK_NOT_ENGLISH' : 'ENGLISH_TRACK_MISSING',
        message: activeTrackIsNonEnglish
          ? 'YouTube 目前啟用的字幕軌不是可用的英文字幕軌。'
          : '找到字幕軌，但沒有英文字幕軌。',
        details: {
          trackCount: tracks.length,
          languages: tracks.map((track) => track.languageCode ?? track.name?.simpleText ?? 'unknown'),
          source: 'youtube-player',
          action: activeTrackIsNonEnglish
            ? 'select-english-cc'
            : 'enable-english-cc-or-choose-another-video',
          ...(activeTrack?.languageCode ? { activeLanguage: activeTrack.languageCode } : {}),
        },
      },
    };
  }

  const trackId = getCaptionTrackIdentity(selection.track);
  const download = await resolveCaptionDownload(
    selection.track,
    videoId,
    captionSelection.captionsEnabled,
  );
  if (!download) {
    return {
      type: 'retryable-error',
      diagnostic: {
        stage: 'timedtext-download',
        status: 'error',
        code: 'CAPTION_URL_MISSING',
        message: '選定的英文字幕軌缺少可下載網址。',
        details: { source: 'youtube-player', action: 'retry' },
      },
    };
  }

  try {
    const response = await fetch(download.url);
    if (!response.ok) {
      return {
        type: 'retryable-error',
        diagnostic: {
          stage: 'timedtext-download',
          status: 'error',
          code: 'CAPTION_FETCH_FAILED',
          message: `完整字幕下載失敗（HTTP ${response.status || 'unknown'}）。`,
          details: {
            httpStatus: response.status || 0,
            source: download.format === 'json3' ? 'youtube-player-json3' : 'timedtext',
            action: 'retry',
          },
        },
      };
    }

    const document = await response.text();
    const cues = download.format === 'json3'
      ? parseCaptionJson3(document)
      : parseCaptionXml(document);
    if (!cues.length) {
      return {
        type: 'retryable-error',
        diagnostic: {
          stage: 'timedtext-parse',
          status: 'error',
          code: 'CAPTION_PARSE_EMPTY',
          message: '字幕檔下載成功，但完整內容為空。',
          details: {
            source: download.format === 'json3' ? 'youtube-player-json3' : 'timedtext',
            action: 'retry',
          },
        },
      };
    }

    return {
      type: 'track',
      track: {
        language: selection.track.languageCode ?? selection.track.name ?? 'English',
        cues,
      },
      trackId,
      provenance: selection.provenance,
      selectionReason: selection.reason,
    };
  } catch (reason) {
    return {
      type: 'retryable-error',
      diagnostic: {
        stage: 'timedtext-download',
        status: 'error',
        code: 'CAPTION_FETCH_EXCEPTION',
        message: `完整字幕下載發生錯誤：${reason instanceof Error ? reason.message : '未知錯誤'}`,
        details: {
          source: download.format === 'json3' ? 'youtube-player-json3' : 'timedtext',
          action: 'retry',
        },
      },
    };
  }
}

function broadcastState(message: SynchronizableMessage): void {
  sendMessage(message);
}

function isSidePanelContentMessage(message: unknown): message is SidePanelContentMessage {
  if (typeof message !== 'object' || message === null) return false;
  const candidate = message as {
    type?: unknown;
    videoId?: unknown;
    synchronizationId?: unknown;
    timeMs?: unknown;
    startMs?: unknown;
    endMs?: unknown;
  };
  if (candidate.type === 'REQUEST_STATE') return true;
  if (typeof candidate.videoId !== 'string' || typeof candidate.synchronizationId !== 'string') {
    return false;
  }
  if (candidate.type === 'RETRY_CAPTIONS'
    || candidate.type === 'PAUSE_PLAYBACK'
    || candidate.type === 'RESUME_PLAYBACK') return true;
  if ((candidate.type === 'JUMP_TO_HERE' || candidate.type === 'PLAY_FROM_HERE')
    && typeof candidate.timeMs === 'number'
    && Number.isFinite(candidate.timeMs)) {
    return true;
  }
  return candidate.type === 'REPLAY_RANGE'
    && typeof candidate.startMs === 'number'
    && Number.isFinite(candidate.startMs)
    && typeof candidate.endMs === 'number'
    && Number.isFinite(candidate.endMs);
}

function playbackVideo(): HTMLVideoElement | null {
  return document.querySelector('video') ?? activeVideo;
}

function jumpToHere(timeMs: number): void {
  const video = playbackVideo();
  if (!video) return;
  replayEndMs = null;
  video.currentTime = Math.max(0, timeMs) / 1000;
  sendCurrentPlayback();
}

function pausePlayback(): void {
  const video = playbackVideo();
  if (!video) return;
  replayEndMs = null;
  video.pause();
  sendCurrentPlayback();
}

function resumePlayback(): void {
  const video = playbackVideo();
  if (!video) return;
  replayEndMs = null;
  void video.play().catch(() => undefined);
  sendCurrentPlayback();
}

function playFromHere(timeMs: number): void {
  const video = playbackVideo();
  if (!video) return;
  replayEndMs = null;
  video.currentTime = Math.max(0, timeMs) / 1000;
  void video.play().catch(() => undefined);
  sendCurrentPlayback();
}

function replayRange(startMs: number, endMs: number): void {
  const video = playbackVideo();
  if (!video) return;
  bindPlayback(video);
  const normalizedStartMs = Math.max(0, startMs);
  replayEndMs = Math.max(normalizedStartMs + 1, endMs);
  video.currentTime = normalizedStartMs / 1000;
  void video.play().catch(() => undefined);
  sendCurrentPlayback();
}

function isRequestStateMessage(message: SidePanelContentMessage): message is Extract<SidePanelContentMessage, { type: 'REQUEST_STATE' }> {
  return message.type === 'REQUEST_STATE';
}

function sendCurrentPlayback(): void {
  const videoId = getVideoId();
  const video = document.querySelector('video') ?? activeVideo;
  if (!videoId || !video || !currentSynchronizationId) {
    return;
  }

  bindPlayback(video);
  sendMessage({
    type: 'PLAYBACK_UPDATED',
    videoId,
    synchronizationId: currentSynchronizationId,
    currentTimeMs: Math.round(video.currentTime * 1000),
  });
}

function bindPlayback(video: HTMLVideoElement): void {
  if (video === activeVideo) {
    return;
  }

  activeVideo = video;
  replayEndMs = null;
  video.addEventListener('timeupdate', () => {
    if (video !== activeVideo) return;
    const videoId = getVideoId();
    const synchronizationId = currentSynchronizationId;
    if (!videoId || !synchronizationId) return;
    const currentTimeMs = Math.round(video.currentTime * 1000);
    if (replayEndMs !== null && currentTimeMs >= replayEndMs) {
      const completedReplayEndMs = replayEndMs;
      replayEndMs = null;
      video.currentTime = completedReplayEndMs / 1000;
      video.pause();
      sendMessage({ type: 'PLAYBACK_UPDATED', videoId, synchronizationId, currentTimeMs: completedReplayEndMs });
      return;
    }
    const now = Date.now();
    if (now - lastPlaybackMessageAt < playbackIntervalMs) return;
    lastPlaybackMessageAt = now;
    sendMessage({ type: 'PLAYBACK_UPDATED', videoId, synchronizationId, currentTimeMs });
  });
}


function startRenderedCaptionProgressMonitor(
  videoId: string,
  synchronizationId: string,
  version: number,
): boolean {
  renderedCaptionProgressMonitor?.stop();
  renderedCaptionProgressMonitor = createRenderedCaptionProgressMonitor({
    document,
    getCurrentTimeMs: () => Math.round((document.querySelector('video')?.currentTime ?? 0) * 1000),
    onProgressChanged: (progress) => {
      if (version !== synchronizationVersion
        || synchronizationId !== currentSynchronizationId
        || getVideoId() !== videoId) return;
      const progressMessage: SynchronizableMessage = {
        type: 'CAPTION_PROGRESS_UPDATED',
        videoId,
        synchronizationId,
        progress,
      };
      currentState = [
        ...currentState.filter((message) => message.type !== 'CAPTION_PROGRESS_UPDATED'),
        progressMessage,
      ];
      broadcastState(progressMessage);
    },
  });
  return renderedCaptionProgressMonitor.start();
}

function retainCurrentProgress(
  videoChangedMessage: SynchronizableMessage,
  messages: SynchronizableMessage[],
): void {
  const progress = currentState.find((message) => message.type === 'CAPTION_PROGRESS_UPDATED');
  currentState = [videoChangedMessage, ...messages, ...(progress ? [progress] : [])];
}

async function synchronizeVideo(sendPlaybackAfter = false): Promise<void> {
  const videoId = getVideoId();
  if (!videoId) {
    synchronizationVersion += 1;
    currentSynchronizationId = null;
    observedCaptionSelectionKey = null;
    currentState = [];
    renderedCaptionProgressMonitor?.stop();
    renderedCaptionProgressMonitor = null;
    return;
  }
  const version = ++synchronizationVersion;
  const synchronizationId = `${adapterInstanceId}:${version}`;
  currentSynchronizationId = synchronizationId;
  observedCaptionSelectionKey = null;
  if (lastKnownTrack?.videoId !== videoId) lastKnownTrack = null;
  renderedCaptionProgressMonitor?.stop();
  renderedCaptionProgressMonitor = null;

  lastPlaybackMessageAt = Number.NEGATIVE_INFINITY;
  const video = document.querySelector('video');
  if (video) bindPlayback(video);

  const videoChangedMessage: SynchronizableMessage = {
    type: 'VIDEO_CHANGED',
    videoId,
    synchronizationId,
    videoTitle: getVideoTitle(),
    videoUrl: window.location.href,
  };
  const loadingLifecycle: SynchronizableMessage = {
    type: 'CAPTION_LIFECYCLE_UPDATED',
    videoId,
    synchronizationId,
    lifecycle: {
      status: 'loading',
      message: '正在載入完整英文字幕…',
    },
  };
  const loadingDiagnostic = diagnosticMessage(videoId, synchronizationId, {
    stage: 'player-response',
    status: 'running',
    message: '正在讀取 YouTube 播放器、字幕軌與目前 CC 狀態。',
  });
  currentState = [videoChangedMessage, loadingDiagnostic, loadingLifecycle];
  broadcastState(videoChangedMessage);
  broadcastState(loadingDiagnostic);
  broadcastState(loadingLifecycle);
  startRenderedCaptionProgressMonitor(videoId, synchronizationId, version);

  const correlatedResponse = await waitForPlayerResponse(videoId, version);
  if (version !== synchronizationVersion
    || synchronizationId !== currentSynchronizationId
    || getVideoId() !== videoId) return;

  if (!correlatedResponse) {
    const diagnostic = diagnosticMessage(videoId, synchronizationId, {
      stage: 'player-response',
      status: 'error',
      code: 'PLAYER_RESPONSE_MISSING',
      message: '無法取得目前影片的 YouTube 播放器資料。',
      details: { source: 'youtube-player', action: 'retry' },
    });
    const lifecycle: SynchronizableMessage = {
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId,
      synchronizationId,
      lifecycle: {
        status: 'retryable-error',
        code: 'PLAYER_RESPONSE_MISSING',
        message: '完整英文字幕尚未載入；請重試。',
        action: 'retry',
      },
    };
    observedCaptionSelectionKey = 'unavailable';
    retainCurrentProgress(videoChangedMessage, [diagnostic, lifecycle]);
    broadcastState(diagnostic);
    broadcastState(lifecycle);
    if (sendPlaybackAfter) sendCurrentPlayback();
    return;
  }
  observedCaptionSelectionKey = captionSelectionKey(correlatedResponse.captionSelection);

  const result = await findEnglishCaptionTrack(
    correlatedResponse.playerResponse,
    correlatedResponse.captionSelection,
    lastKnownTrack?.trackId ?? null,
    videoId,
  );
  if (version !== synchronizationVersion
    || synchronizationId !== currentSynchronizationId
    || getVideoId() !== videoId) return;

  if (result.type !== 'track') {
    const diagnostic = diagnosticMessage(videoId, synchronizationId, result.diagnostic);
    const lifecycle: SynchronizableMessage = {
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId,
      synchronizationId,
      lifecycle: result.type === 'no-english-track'
        ? {
          status: 'no-english-track',
          message: '這部影片目前沒有可用的英文字幕軌。',
          action: 'enable-english-cc',
        }
        : {
          status: 'retryable-error',
          code: result.diagnostic.code ?? 'CAPTION_ACQUISITION_FAILED',
          message: '完整英文字幕下載或解析失敗；未建立部分 Transcript。',
          action: 'retry',
        },
    };
    retainCurrentProgress(videoChangedMessage, [diagnostic, lifecycle]);
    broadcastState(diagnostic);
    broadcastState(lifecycle);
    if (sendPlaybackAfter) sendCurrentPlayback();
    return;
  }

  try {
    const captionsUpdatedMessage: SynchronizableMessage = {
      type: 'CAPTIONS_UPDATED',
      videoId,
      synchronizationId,
      videoTitle: getVideoTitle(),
      videoUrl: window.location.href,
      track: parseCaptionTrack(result.track),
      lifecycle: {
        status: 'ready',
        message: '完整英文字幕已就緒。',
      },
    };
    const policyDiagnostic = diagnosticMessage(videoId, synchronizationId, {
      stage: 'track-policy',
      status: 'success',
      message: `已選定 ${result.provenance === 'creator' ? 'creator-provided' : 'automatic'} English Caption Track。`,
      details: {
        source: result.provenance,
        selection: result.selectionReason,
        trackId: result.trackId,
        action: 'none',
      },
    });
    const readyDiagnostic = diagnosticMessage(videoId, synchronizationId, {
      stage: 'ready',
      status: 'success',
      message: `已取得完整英文字幕，共 ${captionsUpdatedMessage.track.cues.length} 句。`,
      details: {
        cueCount: captionsUpdatedMessage.track.cues.length,
        source: 'timedtext',
        provenance: result.provenance,
      },
    });
    if (result.selectionReason === 'active' || result.selectionReason === 'last-known') {
      lastKnownTrack = { videoId, trackId: result.trackId };
    }
    retainCurrentProgress(videoChangedMessage, [
      policyDiagnostic,
      readyDiagnostic,
      captionsUpdatedMessage,
    ]);
    broadcastState(policyDiagnostic);
    broadcastState(readyDiagnostic);
    broadcastState(captionsUpdatedMessage);
    if (sendPlaybackAfter) sendCurrentPlayback();
  } catch (reason) {
    const diagnostic = diagnosticMessage(videoId, synchronizationId, {
      stage: 'timedtext-parse',
      status: 'error',
      code: 'CAPTION_NORMALIZATION_FAILED',
      message: `完整字幕正規化失敗：${reason instanceof Error ? reason.message : '未知錯誤'}`,
      details: { source: 'timedtext', action: 'retry' },
    });
    const lifecycle: SynchronizableMessage = {
      type: 'CAPTION_LIFECYCLE_UPDATED',
      videoId,
      synchronizationId,
      lifecycle: {
        status: 'retryable-error',
        code: 'CAPTION_NORMALIZATION_FAILED',
        message: '完整英文字幕無法建立；未建立部分 Transcript。',
        action: 'retry',
      },
    };
    retainCurrentProgress(videoChangedMessage, [diagnostic, lifecycle]);
    broadcastState(diagnostic);
    broadcastState(lifecycle);
    if (sendPlaybackAfter) sendCurrentPlayback();
  }
}

window.addEventListener('message', handleCaptionSelectionResponse);
document.addEventListener('click', handleCaptionControlClick);
document.addEventListener('keydown', handleCaptionShortcut);

if (typeof chrome !== 'undefined') {
  chrome.runtime.onMessage.addListener((message: unknown) => {
    if (!isSidePanelContentMessage(message)) return;
    if (isRequestStateMessage(message)) {
      const videoId = getVideoId();
      if (!videoId || currentState[0]?.videoId !== videoId) return;
      currentState.forEach(broadcastState);
      sendCurrentPlayback();
      return;
    }
    if (message.videoId !== getVideoId()
      || message.synchronizationId !== currentSynchronizationId) return;
    if (message.type === 'RETRY_CAPTIONS') {
      void synchronizeVideo(true);
      return;
    }
    if (message.type === 'PAUSE_PLAYBACK') {
      pausePlayback();
      return;
    }
    if (message.type === 'RESUME_PLAYBACK') {
      resumePlayback();
      return;
    }
    if (message.type === 'JUMP_TO_HERE') {
      jumpToHere(message.timeMs);
      return;
    }
    if (message.type === 'PLAY_FROM_HERE') {
      playFromHere(message.timeMs);
      return;
    }
    replayRange(message.startMs, message.endMs);
  });
}

document.addEventListener('yt-navigate-finish', () => {
  replayEndMs = null;
  void synchronizeVideo(false);
});

void synchronizeVideo(false);
