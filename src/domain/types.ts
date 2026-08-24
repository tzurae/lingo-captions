export type CaptionCue = {
  id: string;
  startMs: number;
  endMs: number;
  text: string;
};

export type CaptionSource = 'timedtext' | 'visible-dom';

export type ActiveCaptionGroup = {
  cueIds: string[];
  startMs: number;
};

export type CaptionTrack = {
  language: string;
  isEnglish: boolean;
  source: CaptionSource;
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

export type RenderedCaptionProgress = {
  capturedAtMs: number;
  cues: CaptionCue[];
  activeGroup?: ActiveCaptionGroup;
};

export type CaptionDiagnosticStage =
  | 'player-response'
  | 'caption-tracks'
  | 'english-track'
  | 'timedtext-download'
  | 'timedtext-parse'
  | 'visible-dom'
  | 'ready';

export type CaptionDiagnostic = {
  stage: CaptionDiagnosticStage;
  status: 'running' | 'success' | 'error' | 'fallback';
  message: string;
  code?: string;
  details?: Record<string, string | number | string[]>;
};

export type ContentMessage =
  | { type: 'CAPTIONS_UPDATED'; videoId: string; videoTitle: string; videoUrl: string; track: CaptionTrack }
  | { type: 'CAPTION_PROGRESS_UPDATED'; videoId: string; progress: RenderedCaptionProgress }
  | { type: 'PLAYBACK_UPDATED'; videoId: string; currentTimeMs: number }
  | { type: 'VIDEO_CHANGED'; videoId: string; videoTitle: string; videoUrl: string }
  | { type: 'NO_CAPTIONS'; videoId: string; reason: 'not-found' | 'not-english' | 'unsupported' }
  | { type: 'CAPTION_DIAGNOSTIC'; videoId: string; diagnostic: CaptionDiagnostic };

export type SidePanelContentMessage =
  | { type: 'REQUEST_STATE' }
  | { type: 'SEEK_TO_TIME'; timeMs: number };

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
