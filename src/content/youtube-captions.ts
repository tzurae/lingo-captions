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

export function findCurrentCue(cues: CaptionCue[], currentTimeMs: number): CaptionCue | null {
  return cues.find((cue) => cue.startMs <= currentTimeMs && currentTimeMs < cue.endMs) ?? null;
}
