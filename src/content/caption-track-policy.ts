export type CaptionTrackCandidate = {
  baseUrl?: string;
  kind?: string;
  languageCode?: string;
  name?: string;
  vssId?: string;
};

export type CaptionTrackProvenance = 'creator' | 'automatic';

export type CaptionTrackSelectionReason =
  | 'active'
  | 'last-known'
  | 'creator-fallback'
  | 'automatic-fallback';

export type CaptionTrackSelection = {
  track: CaptionTrackCandidate;
  provenance: CaptionTrackProvenance;
  reason: CaptionTrackSelectionReason;
};

export type CaptionTrackPolicyContext = {
  captionsEnabled: boolean;
  activeTrack?: CaptionTrackCandidate | null;
  lastKnownTrackId?: string | null;
  lastKnownTrack?: CaptionTrackCandidate | null;
};

export function isEnglishTrack(track: CaptionTrackCandidate): boolean {
  const language = (track.languageCode ?? track.name ?? '').trim().toLowerCase();
  const vssId = track.vssId?.trim().toLowerCase() ?? '';
  return language === 'english'
    || language === 'en'
    || language.startsWith('en-')
    || vssId === '.en'
    || vssId === 'a.en'
    || vssId.startsWith('.en-')
    || vssId.startsWith('a.en-');
}

export function getCaptionTrackIdentity(track: CaptionTrackCandidate): string {
  const vssId = track.vssId?.trim();
  if (vssId) return `vss:${vssId}`;
  const baseUrl = track.baseUrl?.trim();
  if (baseUrl) return `url:${baseUrl}`;
  return [
    'metadata',
    track.languageCode?.trim().toLowerCase() ?? '',
    track.kind?.trim().toLowerCase() ?? '',
    track.name?.trim().toLowerCase() ?? '',
  ].join(':');
}

function provenanceOf(track: CaptionTrackCandidate): CaptionTrackProvenance {
  const kind = track.kind?.trim().toLowerCase();
  const vssId = track.vssId?.trim().toLowerCase();
  const name = track.name?.trim().toLowerCase();
  return kind === 'asr' || vssId?.startsWith('a.') || name?.includes('auto-generated')
    ? 'automatic'
    : 'creator';
}

function byIdentity(left: CaptionTrackCandidate, right: CaptionTrackCandidate): number {
  const leftId = getCaptionTrackIdentity(left);
  const rightId = getCaptionTrackIdentity(right);
  return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
}

function selectionFor(
  tracks: CaptionTrackCandidate[],
  trackId: string | null | undefined,
  reason: Extract<CaptionTrackSelectionReason, 'active' | 'last-known'>,
): CaptionTrackSelection | null {
  if (!trackId) return null;
  const track = tracks.find((candidate) => getCaptionTrackIdentity(candidate) === trackId);
  return track ? { track, provenance: provenanceOf(track), reason } : null;
}

function normalized(value: string | undefined): string | null {
  const normalizedValue = value?.trim().toLowerCase();
  return normalizedValue ? normalizedValue : null;
}

function matchesTrackReference(
  candidate: CaptionTrackCandidate,
  reference: CaptionTrackCandidate,
): boolean {
  const referenceVssId = reference.vssId?.trim();
  if (referenceVssId) return candidate.vssId?.trim() === referenceVssId;
  const referenceBaseUrl = reference.baseUrl?.trim();
  if (referenceBaseUrl) return candidate.baseUrl?.trim() === referenceBaseUrl;
  const metadataFields: Array<keyof CaptionTrackCandidate> = [
    'languageCode',
    'kind',
    'name',
  ];
  const suppliedFields = metadataFields.filter((field) => normalized(reference[field]) !== null);
  return suppliedFields.length > 0 && suppliedFields.every(
    (field) => normalized(candidate[field]) === normalized(reference[field]),
  );
}

function selectionForReference(
  tracks: CaptionTrackCandidate[],
  reference: CaptionTrackCandidate | null | undefined,
  reason: Extract<CaptionTrackSelectionReason, 'active' | 'last-known'>,
): CaptionTrackSelection | null {
  if (!reference) return null;
  const matches = tracks.filter((candidate) => matchesTrackReference(candidate, reference));
  return matches.length === 1
    ? { track: matches[0], provenance: provenanceOf(matches[0]), reason }
    : null;
}

export function selectEnglishCaptionTrack(
  candidates: CaptionTrackCandidate[],
  context: CaptionTrackPolicyContext,
): CaptionTrackSelection | null {
  const englishTracks = candidates.filter(isEnglishTrack);
  if (englishTracks.length === 0) return null;

  if (context.captionsEnabled) {
    return context.activeTrack
      ? selectionForReference(englishTracks, context.activeTrack, 'active')
      : null;
  }
  if (!context.captionsEnabled) {
    const lastKnown = selectionForReference(englishTracks, context.lastKnownTrack, 'last-known')
      ?? selectionFor(englishTracks, context.lastKnownTrackId, 'last-known');
    if (lastKnown) return lastKnown;
  }

  const creator = englishTracks
    .filter((track) => provenanceOf(track) === 'creator')
    .sort(byIdentity)[0];
  if (creator) return { track: creator, provenance: 'creator', reason: 'creator-fallback' };

  const automatic = [...englishTracks].sort(byIdentity)[0];
  return automatic
    ? { track: automatic, provenance: 'automatic', reason: 'automatic-fallback' }
    : null;
}
