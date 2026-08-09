import { describe, expect, it } from 'vitest';
import { findCurrentCue, parseCaptionTrack } from './youtube-captions';

describe('parseCaptionTrack', () => {
  it.each(['en', 'en-US', 'English'])('accepts %s as an English caption language', (language) => {
    expect(parseCaptionTrack({ language, cues: [] })).toMatchObject({
      language,
      isEnglish: true,
      source: 'timedtext',
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

describe('findCurrentCue', () => {
  const cues = [
    { id: 'first', startMs: 0, endMs: 1000, text: 'First' },
    { id: 'second', startMs: 1500, endMs: 2500, text: 'Second' },
  ];

  it('returns a cue at its inclusive start and before its exclusive end', () => {
    expect(findCurrentCue(cues, 0)).toEqual(cues[0]);
    expect(findCurrentCue(cues, 999)).toEqual(cues[0]);
    expect(findCurrentCue(cues, 1500)).toEqual(cues[1]);
    expect(findCurrentCue(cues, 2499)).toEqual(cues[1]);
  });

  it('returns null before captions, in a gap, and at or after a cue end', () => {
    expect(findCurrentCue(cues, -1)).toBeNull();
    expect(findCurrentCue(cues, 1000)).toBeNull();
    expect(findCurrentCue(cues, 1499)).toBeNull();
    expect(findCurrentCue(cues, 2500)).toBeNull();
  });
});
