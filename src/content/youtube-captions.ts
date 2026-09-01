import { getCaptionTrackProvenance } from './caption-track-policy';
import type { CaptionCue, CaptionTrack } from '../domain/types';

export type RawCaptionCue = {
  id?: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type RawCaptionTrack = {
  language: string;
  cues: RawCaptionCue[];
};

export type PlayerCaptionRequestIdentity = {
  videoId: string;
  languageCode: string;
  kind?: string;
  trackBaseUrl?: string;
  vssId?: string;
  name?: string;
};

type TrackRequestSelectors = {
  name: string | null;
  translatedLanguage: string | null;
  vssId: string | null;
  fallbackName: string | null;
};

function normalized(value: string | null | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue ? normalizedValue : null;
}

function trackRequestSelectors(identity: PlayerCaptionRequestIdentity): TrackRequestSelectors {
  let trackUrl: URL | undefined;
  try {
    trackUrl = identity.trackBaseUrl ? new URL(identity.trackBaseUrl) : undefined;
  } catch {
    trackUrl = undefined;
  }
  return {
    name: trackUrl?.searchParams.get('name') ?? null,
    translatedLanguage: trackUrl?.searchParams.get('tlang') ?? null,
    vssId: trackUrl?.searchParams.get('vssId')
      ?? trackUrl?.searchParams.get('vss_id')
      ?? normalized(identity.vssId),
    fallbackName: normalized(identity.name),
  };
}

function matchesTrackSelectors(url: URL, selectors: TrackRequestSelectors): boolean {
  const requestName = url.searchParams.get('name');
  if (selectors.name !== null && requestName !== selectors.name) return false;
  if (selectors.name === null
    && requestName !== null
    && selectors.fallbackName !== null
    && normalized(requestName) !== selectors.fallbackName) return false;

  const translatedLanguage = url.searchParams.get('tlang');
  if (selectors.translatedLanguage !== null
    && translatedLanguage !== selectors.translatedLanguage) return false;

  const requestVssId = url.searchParams.get('vssId') ?? url.searchParams.get('vss_id');
  return requestVssId === null
    || selectors.vssId === null
    || normalized(requestVssId) === normalized(selectors.vssId);
}

export function findPlayerCaptionRequestUrl(
  resourceUrls: string[],
  identity: PlayerCaptionRequestIdentity,
): string | undefined {
  const selectors = trackRequestSelectors(identity);
  for (let index = resourceUrls.length - 1; index >= 0; index -= 1) {
    const resourceUrl = resourceUrls[index];
    let url: URL;
    try {
      url = new URL(resourceUrl);
    } catch {
      continue;
    }
    if (url.origin !== 'https://www.youtube.com'
      || url.pathname !== '/api/timedtext'
      || url.searchParams.get('v') !== identity.videoId
      || url.searchParams.get('lang')?.toLowerCase() !== identity.languageCode.toLowerCase()
      || url.searchParams.get('fmt') !== 'json3'
      || !url.searchParams.get('pot')
      || !matchesTrackSelectors(url, selectors)) continue;
    const expectsAutomatic = getCaptionTrackProvenance(identity) === 'automatic';
    const requestIsAutomatic = url.searchParams.get('kind')?.toLowerCase() === 'asr';
    if (expectsAutomatic === requestIsAutomatic) return resourceUrl;
  }
  return undefined;
}

export function parseCaptionJson3(document: string): RawCaptionCue[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(document);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return [];
  const events = (parsed as Record<string, unknown>).events;
  if (!Array.isArray(events)) return [];
  return events.flatMap((value, index): RawCaptionCue[] => {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return [];
    const event = value as Record<string, unknown>;
    if (typeof event.tStartMs !== 'number'
      || !Number.isFinite(event.tStartMs)
      || event.tStartMs < 0
      || typeof event.dDurationMs !== 'number'
      || !Number.isFinite(event.dDurationMs)
      || event.dDurationMs <= 0
      || !Array.isArray(event.segs)) return [];
    const text = event.segs
      .flatMap((segment) => {
        if (typeof segment !== 'object' || segment === null || Array.isArray(segment)) return [];
        const utf8 = (segment as Record<string, unknown>).utf8;
        return typeof utf8 === 'string' ? [utf8] : [];
      })
      .join('')
      .replace(/\s+/g, ' ')
      .trim();
    return text ? [{
      id: `json3-${index}`,
      startMs: event.tStartMs,
      endMs: event.tStartMs + event.dDurationMs,
      text,
    }] : [];
  });
}

const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&#x27;': "'",
};

function isEnglish(language: string): boolean {
  const normalizedLanguage = language.trim().toLowerCase();
  return normalizedLanguage === 'english' || normalizedLanguage === 'en' || normalizedLanguage.startsWith('en-');
}

function normalizeText(text: string): string {
  return text
    .replace(/<[^>]*>/g, '')
    .replace(/&(?:amp|lt|gt|quot);|&#39;|&#x27;/g, (entity) => entities[entity])
    .trim();
}

export function parseCaptionTrack(raw: RawCaptionTrack): CaptionTrack {
  if (!isEnglish(raw.language)) {
    throw new Error('English caption track required');
  }

  const uniqueCues = new Map<string, CaptionCue>();

  raw.cues.forEach((cue, index) => {
    const text = normalizeText(cue.text);

    if (!text) {
      throw new Error('Caption cue text cannot be empty');
    }

    const deduplicationKey = `${cue.startMs}\u0000${cue.endMs}\u0000${text}`;
    if (!uniqueCues.has(deduplicationKey)) {
      uniqueCues.set(deduplicationKey, {
        id: cue.id ?? `cue-${index}`,
        startMs: cue.startMs,
        endMs: cue.endMs,
        text,
      });
    }
  });

  return {
    language: raw.language,
    isEnglish: true,
    cues: [...uniqueCues.values()].sort((left, right) => left.startMs - right.startMs),
  };
}
