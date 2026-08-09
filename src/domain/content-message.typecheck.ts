import type { CaptionTrack, ContentMessage } from './types';

declare const track: CaptionTrack;

const timedTextTrack: CaptionTrack = {
  language: 'en',
  isEnglish: true,
  source: 'timedtext',
  cues: [],
};

const visibleTrack: CaptionTrack = {
  language: 'en-visible',
  isEnglish: true,
  source: 'visible-dom',
  cues: [{ id: 'visible-0', startMs: 1_000, endMs: 5_000, text: 'Visible sentence.' }],
  activeGroup: { cueIds: ['visible-0'], startMs: 1_000 },
};

const messages: ContentMessage[] = [
  {
    type: 'CAPTIONS_UPDATED',
    videoId: 'video-id',
    videoTitle: 'Video title',
    videoUrl: 'https://www.youtube.com/watch?v=video-id',
    track,
  },
  { type: 'PLAYBACK_UPDATED', videoId: 'video-id', currentTimeMs: 1500 },
  {
    type: 'VIDEO_CHANGED',
    videoId: 'video-id',
    videoTitle: 'Video title',
    videoUrl: 'https://www.youtube.com/watch?v=video-id',
  },
  { type: 'NO_CAPTIONS', videoId: 'video-id', reason: 'not-found' },
];

void timedTextTrack;
void visibleTrack;
void messages;
