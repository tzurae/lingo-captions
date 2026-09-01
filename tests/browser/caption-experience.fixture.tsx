import { createRoot } from 'react-dom/client';
import type {
  ContentMessage,
  PublicSettings,
  RequestMessage,
  ResponseMessage,
  RunQueryResponse,
  SidePanelContentMessage,
} from '../../src/domain/types';
import { defaultSettings } from '../../src/storage/settings-store';
import { App } from '../../src/sidepanel/App';
import '../../src/sidepanel/styles.css';

export type CapturedCommand = SidePanelContentMessage;

export type CaptionExperienceHarness = {
  commands: CapturedCommand[];
  load(): void;
  clearCommands(): void;
  emitPlayback(currentTimeMs: number): void;
  refineRenderedProgress(text: string): void;
  resolveQuery(): void;
};

declare global {
  interface Window {
    __captionExperience: CaptionExperienceHarness;
  }
}

type RuntimeListener = (message: ContentMessage, sender?: chrome.runtime.MessageSender) => void;

const synchronization = { videoId: 'video-1', synchronizationId: 'sync-1' } as const;
const commands: CapturedCommand[] = [];
const runtimeListeners = new Set<RuntimeListener>();
let pendingQuery: ((response: ResponseMessage) => void) | null = null;

const { apiKey: _apiKey, ...storedSettings } = defaultSettings;
const publicSettings: PublicSettings = {
  ...storedSettings,
  hasApiKey: true,
  apiKeyLastFour: '1234',
};

function emit(message: ContentMessage): void {
  const sender = { tab: { id: 42 } } as chrome.runtime.MessageSender;
  runtimeListeners.forEach((listener) => listener(message, sender));
}

function runtimeResponse(message: RequestMessage): Promise<ResponseMessage> {
  if (message.type === 'GET_SETTINGS' || message.type === 'SAVE_SETTINGS') {
    return Promise.resolve({ ok: true, data: publicSettings });
  }
  if (message.type === 'RUN_QUERY') {
    return new Promise((resolve) => { pendingQuery = resolve; });
  }
  if (message.type === 'LIST_HISTORY') {
    return Promise.resolve({ ok: true, data: [] });
  }
  return Promise.resolve({ ok: true, data: undefined });
}

const chromeHarness = {
  runtime: {
    sendMessage: runtimeResponse,
    onMessage: {
      addListener(listener: RuntimeListener) {
        runtimeListeners.add(listener);
      },
      removeListener(listener: RuntimeListener) {
        runtimeListeners.delete(listener);
      },
    },
  },
  tabs: {
    query: () => Promise.resolve([{ id: 42 }]),
    sendMessage: (_tabId: number, message: SidePanelContentMessage) => {
      commands.push({ ...message });
      return Promise.resolve(undefined);
    },
    onActivated: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  },
  storage: {
    onChanged: {
      addListener: () => undefined,
      removeListener: () => undefined,
    },
  },
} as unknown as typeof chrome;

Object.assign(globalThis, { chrome: chromeHarness });

const harness: CaptionExperienceHarness = {
  commands,
  load() {
    emit({
      type: 'VIDEO_CHANGED',
      ...synchronization,
      videoTitle: 'Integrated video',
      videoUrl: 'https://www.youtube.com/watch?v=video-1',
    });
    emit({
      type: 'CAPTIONS_UPDATED',
      ...synchronization,
      videoTitle: 'Integrated video',
      videoUrl: 'https://www.youtube.com/watch?v=video-1',
      lifecycle: { status: 'ready', message: 'Full transcript ready.' },
      track: {
        language: 'en',
        isEnglish: true,
        cues: [
          { id: 'cue-1', startMs: 0, endMs: 1_000, text: 'First sentence.' },
          { id: 'cue-2', startMs: 1_000, endMs: 2_000, text: 'Before sentence.' },
          { id: 'cue-3', startMs: 2_000, endMs: 4_000, text: 'Current sentence continues.' },
          { id: 'cue-4', startMs: 4_000, endMs: 5_000, text: 'Next sentence.' },
          { id: 'cue-5', startMs: 5_000, endMs: 6_000, text: 'Last sentence.' },
        ],
      },
    });
    this.emitPlayback(2_500);
  },
  clearCommands() {
    commands.length = 0;
  },
  emitPlayback(currentTimeMs) {
    emit({
      type: 'PLAYBACK_UPDATED',
      ...synchronization,
      currentTimeMs,
    });
  },
  refineRenderedProgress(text) {
    const currentTimeMs = text === 'Next' ? 4_500 : 2_500;
    emit({
      type: 'CAPTION_PROGRESS_UPDATED',
      ...synchronization,
      progress: {
        capturedAtMs: currentTimeMs,
        cues: [{
          id: 'progress-0',
          startMs: currentTimeMs,
          endMs: currentTimeMs + 1,
          text,
        }],
        activeGroup: { cueIds: ['progress-0'], startMs: currentTimeMs },
      },
    });
  },
  resolveQuery() {
    const response: RunQueryResponse = {
      result: {
        answer: 'Integrated answer',
        model: publicSettings.model,
        requestedModel: publicSettings.model,
        reasoningEffort: publicSettings.reasoningEffort,
        createdAt: 10,
      },
      historySaved: false,
    };
    pendingQuery?.({ ok: true, data: response });
    pendingQuery = null;
  },
};

window.__captionExperience = harness;
createRoot(document.getElementById('root')!).render(<App />);
