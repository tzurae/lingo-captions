import { describe, expect, it } from 'vitest';
import {
  getCaptionTrackIdentity,
  selectEnglishCaptionTrack,
  type CaptionTrackCandidate,
} from './caption-track-policy';

const creatorEnglish: CaptionTrackCandidate = {
  baseUrl: 'https://captions.test/creator-en',
  languageCode: 'en',
  name: 'English',
  vssId: '.en',
};

const automaticEnglish: CaptionTrackCandidate = {
  baseUrl: 'https://captions.test/automatic-en',
  kind: 'asr',
  languageCode: 'en',
  name: 'English (auto-generated)',
  vssId: 'a.en',
};

const creatorSpanish: CaptionTrackCandidate = {
  baseUrl: 'https://captions.test/creator-es',
  languageCode: 'es',
  name: 'Spanish',
  vssId: '.es',
};

describe('deterministic English Caption Track policy', () => {
  it('uses the active creator track when CC is enabled', () => {
    const selection = selectEnglishCaptionTrack(
      [automaticEnglish, creatorEnglish],
      { captionsEnabled: true, activeTrack: creatorEnglish },
    );

    expect(selection).toMatchObject({
      track: creatorEnglish,
      provenance: 'creator',
      reason: 'active',
    });
  });

  it('uses the active automatic track when CC is enabled', () => {
    const selection = selectEnglishCaptionTrack(
      [creatorEnglish, automaticEnglish],
      { captionsEnabled: true, activeTrack: automaticEnglish },
    );

    expect(selection).toMatchObject({
      track: automaticEnglish,
      provenance: 'automatic',
      reason: 'active',
    });
  });

  it('reuses the last-known English track when CC is disabled', () => {
    const selection = selectEnglishCaptionTrack(
      [creatorEnglish, automaticEnglish],
      { captionsEnabled: false, lastKnownTrackId: getCaptionTrackIdentity(automaticEnglish) },
    );

    expect(selection).toMatchObject({
      track: automaticEnglish,
      provenance: 'automatic',
      reason: 'last-known',
    });
  });

  it('prefers YouTube current last-known metadata over a stale adapter cache', () => {
    expect(selectEnglishCaptionTrack(
      [creatorEnglish, automaticEnglish],
      {
        captionsEnabled: false,
        lastKnownTrackId: getCaptionTrackIdentity(creatorEnglish),
        lastKnownTrack: automaticEnglish,
      },
    )).toMatchObject({
      track: automaticEnglish,
      provenance: 'automatic',
      reason: 'last-known',
    });
  });

  it('prefers creator-provided English when CC is disabled without history', () => {
    const selection = selectEnglishCaptionTrack(
      [automaticEnglish, creatorSpanish, creatorEnglish],
      { captionsEnabled: false },
    );

    expect(selection).toMatchObject({
      track: creatorEnglish,
      provenance: 'creator',
      reason: 'creator-fallback',
    });
  });

  it('uses automatic English only when no creator-provided English track exists', () => {
    const selection = selectEnglishCaptionTrack(
      [creatorSpanish, automaticEnglish],
      { captionsEnabled: false },
    );

    expect(selection).toMatchObject({
      track: automaticEnglish,
      provenance: 'automatic',
      reason: 'automatic-fallback',
    });
  });

  it('matches partial active metadata against one full player candidate', () => {
    expect(selectEnglishCaptionTrack(
      [automaticEnglish, creatorEnglish],
      {
        captionsEnabled: true,
        activeTrack: { languageCode: 'en', name: 'English' },
      },
    )).toMatchObject({
      track: creatorEnglish,
      provenance: 'creator',
      reason: 'active',
    });
  });

  it('trusts a stable vssId when display metadata changes', () => {
    expect(selectEnglishCaptionTrack(
      [automaticEnglish, creatorEnglish],
      {
        captionsEnabled: true,
        activeTrack: {
          languageCode: 'en',
          name: 'Localized English display name',
          vssId: '.en',
        },
      },
    )).toMatchObject({
      track: creatorEnglish,
      provenance: 'creator',
      reason: 'active',
    });
  });

  it('fails closed when CC is enabled before active identity is discoverable', () => {
    expect(selectEnglishCaptionTrack(
      [creatorEnglish, automaticEnglish],
      { captionsEnabled: true },
    )).toBeNull();
  });

  it('does not silently diverge from a non-English active track while CC is enabled', () => {
    expect(selectEnglishCaptionTrack(
      [creatorEnglish, creatorSpanish],
      {
        captionsEnabled: true,
        activeTrack: creatorSpanish,
      },
    )).toBeNull();
  });

  it('returns no selection when no English Caption Track exists', () => {
    expect(selectEnglishCaptionTrack(
      [creatorSpanish],
      { captionsEnabled: false },
    )).toBeNull();
  });

  it('chooses the same fallback regardless of candidate order', () => {
    const alternateCreator = {
      ...creatorEnglish,
      baseUrl: 'https://captions.test/creator-en-gb',
      languageCode: 'en-GB',
      vssId: '.en-GB',
    };
    const forward = selectEnglishCaptionTrack(
      [alternateCreator, creatorEnglish],
      { captionsEnabled: false },
    );
    const reversed = selectEnglishCaptionTrack(
      [creatorEnglish, alternateCreator],
      { captionsEnabled: false },
    );

    expect(forward?.track.vssId).toBe('.en');
    expect(reversed?.track.vssId).toBe('.en');
  });
});
