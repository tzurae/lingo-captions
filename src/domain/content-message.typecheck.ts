import type { CaptionTrack, ContentMessage } from './types';

declare const track: CaptionTrack;

const timedTextTrack: CaptionTrack = {
  language: 'en',
  isEnglish: true,
  cues: [],
};

const messages: ContentMessage[] = [
  {
    type: 'CAPTIONS_UPDATED',
    videoId: 'video-id',
    synchronizationId: 'sync-id',
    videoTitle: 'Video title',
    videoUrl: 'https://www.youtube.com/watch?v=video-id',
    track,
    lifecycle: { status: 'ready', message: 'Full transcript ready.' },
  },
  { type: 'PLAYBACK_UPDATED', videoId: 'video-id', synchronizationId: 'sync-id', currentTimeMs: 1_500 },
  {
    type: 'VIDEO_CHANGED',
    videoId: 'video-id',
    synchronizationId: 'sync-id',
    videoTitle: 'Video title',
    videoUrl: 'https://www.youtube.com/watch?v=video-id',
  },
  {
    type: 'CAPTION_LIFECYCLE_UPDATED',
    videoId: 'video-id',
    synchronizationId: 'sync-id',
    lifecycle: {
      status: 'no-english-track',
      message: 'No English Caption Track.',
      action: 'enable-english-cc',
    },
  },
];

void timedTextTrack;
void messages;
