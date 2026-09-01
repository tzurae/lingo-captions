export type CaptionCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type ActiveCaptionGroup = {
  cueIds: string[];
  startMs: number;
};

export type CaptionTrack = {
  language: string;
  isEnglish: boolean;
  cues: CaptionCue[];
};

export type RenderedCaptionProgress = {
  capturedAtMs: number;
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

export type CaptionDiagnosticStage =
  | 'player-response'
  | 'caption-tracks'
  | 'caption-progress'
  | 'track-policy'
  | 'english-track'
  | 'timedtext-download'
  | 'timedtext-parse'
  | 'ready';

export type CaptionDiagnostic = {
  stage: CaptionDiagnosticStage;
  status: 'running' | 'success' | 'error';
  message: string;
  code?: string;
  details?: Record<string, string | number | string[]>;
};

export type CaptionLifecycle =
  | { status: 'loading'; message: string }
  | { status: 'ready'; message: string }
  | { status: 'retryable-error'; code: string; message: string; action: 'retry' }
  | { status: 'no-english-track'; message: string; action: 'enable-english-cc' };

export type CaptionReadyLifecycle = Extract<CaptionLifecycle, { status: 'ready' }>;
export type CaptionPendingLifecycle = Exclude<CaptionLifecycle, { status: 'ready' }>;

type SynchronizedContentMessage = {
  videoId: string;
  synchronizationId: string;
};

export type ContentMessage =
  | (SynchronizedContentMessage & { type: 'CAPTIONS_UPDATED'; videoTitle: string; videoUrl: string; track: CaptionTrack; lifecycle: CaptionReadyLifecycle })
  | (SynchronizedContentMessage & { type: 'CAPTION_PROGRESS_UPDATED'; progress: RenderedCaptionProgress })
  | (SynchronizedContentMessage & { type: 'PLAYBACK_UPDATED'; currentTimeMs: number })
  | (SynchronizedContentMessage & { type: 'VIDEO_CHANGED'; videoTitle: string; videoUrl: string })
  | (SynchronizedContentMessage & { type: 'CAPTION_LIFECYCLE_UPDATED'; lifecycle: CaptionPendingLifecycle })
  | (SynchronizedContentMessage & { type: 'CAPTION_DIAGNOSTIC'; diagnostic: CaptionDiagnostic });

export type SidePanelContentMessage =
  | { type: 'REQUEST_STATE' }
  | (SynchronizedContentMessage & { type: 'RETRY_CAPTIONS' })
  | (SynchronizedContentMessage & { type: 'PAUSE_PLAYBACK' })
  | (SynchronizedContentMessage & { type: 'RESUME_PLAYBACK' })
  | (SynchronizedContentMessage & { type: 'JUMP_TO_HERE'; timeMs: number })
  | (SynchronizedContentMessage & { type: 'PLAY_FROM_HERE'; timeMs: number })
  | (SynchronizedContentMessage & { type: 'REPLAY_RANGE'; startMs: number; endMs: number });

export type QueryIntentId =
  | 'translate_sentence'
  | 'explain_selection'
  | 'grammar'
  | 'synonyms_antonyms'
  | 'natural_rewrite'
  | 'custom';

export type QueryIntent = {
  id: QueryIntentId;
  label: string;
  primary: boolean;
};

export type QueryRequest = {
  intent: QueryIntentId;
  selectedText: string;
  sentence: string;
  contextBefore: string[];
  contextAfter: string[];
  outputLanguage: string;
  detailLevel: 'brief' | 'normal' | 'detailed';
  customQuestion?: string;
};

export type OpenAIModel = 'gpt-5.6-luna' | 'gpt-5.6-terra' | 'gpt-5.6-sol';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type QueryResult = {
  answer: string;
  model: string;
  requestedModel?: string;
  reasoningEffort?: ReasoningEffort;
  createdAt: number;
};

export type PromptTemplates = {
  basePrompt: string;
  inputPrompt: string;
  intentPrompts: Record<QueryIntentId, string>;
};

export type SubtitlePosition = {
  startMs: number;
  endMs: number;
};

export type HistoryRecord = {
  id: string;
  createdAt: number;
  videoId: string;
  videoTitle: string;
  videoUrl: string;
  request: QueryRequest;
  result: QueryResult;
  isFavorite: boolean;
  subtitlePosition?: SubtitlePosition;
};

export type RunQueryResponse = {
  result: QueryResult;
  history?: HistoryRecord;
  historySaved: boolean;
  historyWarning?: string;
};

export type Settings = {
  apiKey: string;
  model: OpenAIModel;
  reasoningEffort: ReasoningEffort;
  outputLanguage: string;
  detailLevel: 'brief' | 'normal' | 'detailed';
  contextLines: number;
  fontSize: number;
  textColor: string;
  activeCueColor: string;
  autoFollowPlayback: boolean;
  prompts: PromptTemplates;
};

export type PublicSettings = Omit<Settings, 'apiKey'> & {
  hasApiKey: boolean;
  apiKeyLastFour: string | null;
};

export type RequestMessage =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; patch: Partial<Settings> }
  | { type: 'RUN_QUERY'; request: QueryRequest; video: { id: string; title: string; url: string; subtitlePosition?: SubtitlePosition } }
  | { type: 'SAVE_HISTORY'; record: HistoryRecord }
  | { type: 'LIST_HISTORY'; filter?: { videoId?: string; isFavorite?: boolean } }
  | { type: 'DELETE_HISTORY'; id: string }
  | { type: 'TOGGLE_FAVORITE'; id: string; isFavorite: boolean };

export type ResponseMessage =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };
