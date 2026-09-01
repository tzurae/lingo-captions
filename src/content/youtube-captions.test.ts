import { describe, expect, it } from 'vitest';
import {
  findPlayerCaptionRequestUrl,
  parseCaptionJson3,
  parseCaptionTrack,
} from './youtube-captions';

describe('parseCaptionTrack', () => {
  it.each(['en', 'en-US', 'English'])('accepts %s as an English caption language', (language) => {
    expect(parseCaptionTrack({ language, cues: [] })).toMatchObject({
      language,
      isEnglish: true,
      cues: [],
    });
  });

  it('rejects a non-English caption language', () => {
    expect(() => parseCaptionTrack({ language: 'es', cues: [] })).toThrow(
      'English caption track required',
    );
  });

  it('strips tags, decodes common entities, and trims caption text', () => {
    expect(
      parseCaptionTrack({
        language: 'en',
        cues: [
          {
            startMs: 0,
            endMs: 1000,
            text: '  <b>Tom &amp; Jerry</b> &lt;3 &gt; &quot;hi&quot; &#39;there&#x27;  ',
          },
        ],
      }).cues,
    ).toEqual([
      { id: 'cue-0', startMs: 0, endMs: 1000, text: 'Tom & Jerry <3 > "hi" \'there\'' },
    ]);
  });

  it('uses supplied IDs and deterministic IDs for omitted values', () => {
    expect(
      parseCaptionTrack({
        language: 'en',
        cues: [
          { id: 'provided', startMs: 0, endMs: 500, text: 'First' },
          { startMs: 500, endMs: 1000, text: 'Second' },
        ],
      }).cues,
    ).toEqual([
      { id: 'provided', startMs: 0, endMs: 500, text: 'First' },
      { id: 'cue-1', startMs: 500, endMs: 1000, text: 'Second' },
    ]);
  });

  it('rejects a cue whose normalized text is empty', () => {
    expect(() =>
      parseCaptionTrack({
        language: 'en',
        cues: [{ startMs: 0, endMs: 1000, text: '  <i> </i>  ' }],
      }),
    ).toThrow('Caption cue text cannot be empty');
  });

  it('removes duplicate normalized cues and orders retained cues by start time', () => {
    expect(
      parseCaptionTrack({
        language: 'en',
        cues: [
          { id: 'later', startMs: 1000, endMs: 2000, text: 'Later' },
          { id: 'first', startMs: 0, endMs: 1000, text: 'First' },
          { id: 'duplicate', startMs: 0, endMs: 1000, text: ' <b>First</b> ' },
        ],
      }).cues,
    ).toEqual([
      { id: 'first', startMs: 0, endMs: 1000, text: 'First' },
      { id: 'later', startMs: 1000, endMs: 2000, text: 'Later' },
    ]);
  });
});

describe('YouTube player caption requests', () => {
  const creatorUrl = 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&pot=creator-token&fmt=json3';
  const automaticUrl = 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&kind=asr&pot=automatic-token&fmt=json3';

  it('selects the latest exact creator request with a proof-of-origin token', () => {
    expect(findPlayerCaptionRequestUrl([
      creatorUrl,
      'https://www.youtube.com/api/timedtext?v=old-video&lang=en&pot=old&fmt=json3',
      'https://www.youtube.com/api/timedtext?v=video-1&lang=es&pot=spanish&fmt=json3',
      creatorUrl,
    ], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: undefined,
    })).toBe(creatorUrl);
  });

  it('keeps creator and automatic requests distinct', () => {
    expect(findPlayerCaptionRequestUrl([
      creatorUrl,
      automaticUrl,
    ], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: 'asr',
    })).toBe(automaticUrl);
  });

  it.each([
    { vssId: 'a.en', name: 'English' },
    { vssId: undefined, name: 'English (auto-generated)' },
  ])('recognizes automatic metadata when kind is omitted: %o', (track) => {
    expect(findPlayerCaptionRequestUrl([
      creatorUrl,
      automaticUrl,
    ], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: undefined,
      ...track,
    })).toBe(automaticUrl);
  });

  it('does not reuse a stale request from another named creator track', () => {
    const staleTrackUrl = 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&name=main&vssId=.en-main&pot=stale&fmt=json3';
    const activeTrackUrl = 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&name=commentary&vssId=.en-commentary&pot=active&fmt=json3';

    expect(findPlayerCaptionRequestUrl([
      activeTrackUrl,
      staleTrackUrl,
    ], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: undefined,
      trackBaseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&name=commentary&vssId=.en-commentary',
      vssId: '.en-commentary',
      name: 'Commentary',
    })).toBe(activeTrackUrl);

    expect(findPlayerCaptionRequestUrl([staleTrackUrl], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: undefined,
      trackBaseUrl: 'https://www.youtube.com/api/timedtext?v=video-1&lang=en&name=commentary&vssId=.en-commentary',
      vssId: '.en-commentary',
      name: 'Commentary',
    })).toBeUndefined();
  });

  it.each([
    'https://www.youtube.com/api/timedtext?v=video-1&lang=en&fmt=json3',
    'https://example.com/api/timedtext?v=video-1&lang=en&pot=foreign&fmt=json3',
    'https://www.youtube.com/api/timedtext?v=video-1&lang=en&pot=token&fmt=srv3',
  ])('rejects an unusable player request: %s', (url) => {
    expect(findPlayerCaptionRequestUrl([url], {
      videoId: 'video-1',
      languageCode: 'en',
      kind: undefined,
    })).toBeUndefined();
  });
});

describe('parseCaptionJson3', () => {
  it('projects complete JSON3 events into deterministic caption cues', () => {
    expect(parseCaptionJson3(JSON.stringify({
      events: [
        { tStartMs: 1_000, dDurationMs: 1_500, segs: [{ utf8: 'Hello ' }, { utf8: 'world.' }] },
        { tStartMs: 2_500, dDurationMs: 500 },
        { tStartMs: 3_000, dDurationMs: 1_000, segs: [{ utf8: 'Next\nline.' }] },
      ],
    }))).toEqual([
      { id: 'json3-0', startMs: 1_000, endMs: 2_500, text: 'Hello world.' },
      { id: 'json3-2', startMs: 3_000, endMs: 4_000, text: 'Next line.' },
    ]);
  });

  it.each([
    '{}',
    '{\"events\":\"invalid\"}',
    '{\"events\":[{\"tStartMs\":0,\"dDurationMs\":0,\"segs\":[{\"utf8\":\"empty duration\"}]}]}',
  ])('returns no cues for an unusable JSON3 document', (document) => {
    expect(parseCaptionJson3(document)).toEqual([]);
  });
});
