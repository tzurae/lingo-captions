import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { CaptionCue, CaptionDiagnostic, CaptionLifecycle, CaptionTrack, ContentMessage, PublicSettings, QueryIntentId, QueryRequest, QueryResult as QueryResultValue, RenderedCaptionProgress } from '../domain/types';
import { buildQueryContext } from '../domain/context-builder';
import { projectLearningTranscriptExperience } from '../domain/learning-transcript-experience';
import {
  initialLearningTranscriptSession,
  projectSessionTranscript,
  projectContinuousSessionTranscript,
  transitionLearningTranscriptSession,
  type LearningTranscriptEvent,
  type PlaybackIntent,
  type ReplayRange,
  type StudyContext,
  type StudySentence,
} from '../domain/learning-transcript-session';
import { projectContinuousViewingStudyRows, projectStudySentences } from '../domain/study-sentences';
import { defaultSettings } from '../storage/settings-store';
import * as messageClient from './message-client';
import { HistoryView } from './components/HistoryView';
import { SelectionAssistant } from './components/SelectionAssistant';
import { TranscriptPanel, type TranscriptPlaybackAction, type TranscriptSelection } from './components/TranscriptPanel';
import { SettingsView } from './components/SettingsView';
import { CaptionDiagnostics } from './components/CaptionDiagnostics';
import { readOwnerTabId } from './panel-owner';

type Tab = 'transcript' | 'history' | 'settings';
type Video = { id: string; title: string; url: string } | null;
type ActiveQueryConfig = Pick<PublicSettings, 'model' | 'reasoningEffort'>;
type SettingsLoadState = 'loading' | 'ready' | 'error';
type AppProps = { reloadPage?: () => void };

const defaultReloadPage = () => window.location.reload();

const { apiKey: _apiKey, ...defaultPublicSettings } = defaultSettings;
const publicDefaultSettings: PublicSettings = {
  ...defaultPublicSettings,
  hasApiKey: false,
  apiKeyLastFour: null,
};

export function App({ reloadPage = defaultReloadPage }: AppProps = {}) {
  const [ownerTabId] = useState(() => readOwnerTabId(window.location.search));
  const [tab, setTab] = useState<Tab>('transcript');
  const [captionTrack, setCaptionTrack] = useState<CaptionTrack | null>(null);
  const [renderedProgress, setRenderedProgress] = useState<RenderedCaptionProgress | null>(null);
  const [playbackMs, setPlaybackMs] = useState<number | null>(null);
  const [video, setVideo] = useState<Video>(null);
  const [selection, setSelection] = useState<TranscriptSelection | null>(null);
  const [result, setResult] = useState<QueryResultValue | null>(null);
  const [completedRequest, setCompletedRequest] = useState<QueryRequest | null>(null);
  const [savedHistoryId, setSavedHistoryId] = useState<string | null>(null);
  const [isFavorite, setIsFavorite] = useState(false);
  const [historyWarning, setHistoryWarning] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [captionLifecycle, setCaptionLifecycle] = useState<CaptionLifecycle>({
    status: 'retryable-error',
    code: 'YOUTUBE_TAB_REQUIRED',
    message: 'Open an available YouTube tab to load captions.',
    action: 'retry',
  });
  const [diagnostics, setDiagnostics] = useState<CaptionDiagnostic[]>([]);
  const [queryError, setQueryError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PublicSettings>(publicDefaultSettings);
  const [activeQueryConfig, setActiveQueryConfig] = useState<ActiveQueryConfig | null>(null);
  const [settingsLoadState, setSettingsLoadState] = useState<SettingsLoadState>('loading');
  const [transcriptSession, setTranscriptSession] = useState(initialLearningTranscriptSession);
  const [focusRequest, setFocusRequest] = useState<{ cueId: string; version: number }>();
  const transcriptExperience = useMemo(() => projectLearningTranscriptExperience({
    track: captionTrack,
    playbackMs,
    renderedProgress,
  }), [captionTrack, playbackMs, renderedProgress]);
  const orderedSourceCues = useMemo(
    () => [...transcriptExperience.fullTranscript].sort((left, right) => left.startMs - right.startMs),
    [transcriptExperience.fullTranscript],
  );
  const studySentences = useMemo(
    () => projectStudySentences(orderedSourceCues),
    [orderedSourceCues],
  );
  const continuousViewingStudyRows = useMemo(
    () => projectContinuousViewingStudyRows({
      projectedCues: transcriptExperience.continuousViewingProjection,
      sourceCues: orderedSourceCues,
      sourceCueIndexByProjectedId: transcriptExperience.sourceCueIndexByProjectedId,
      studySentences,
    }),
    [
      orderedSourceCues,
      studySentences,
      transcriptExperience.continuousViewingProjection,
      transcriptExperience.sourceCueIndexByProjectedId,
    ],
  );
  const hasPinnedStudyContext = transcriptSession.mode === 'focused-study'
    && transcriptSession.studyContext !== null;
  const transcriptStudySentences = useMemo(
    () => projectSessionTranscript(transcriptSession, studySentences),
    [studySentences, transcriptSession],
  );
  const displayedCues = useMemo(
    () => hasPinnedStudyContext
      ? transcriptStudySentences
      : projectContinuousSessionTranscript(transcriptSession, continuousViewingStudyRows.rows),
    [
      continuousViewingStudyRows.rows,
      hasPinnedStudyContext,
      transcriptSession,
      transcriptStudySentences,
    ],
  );
  const transcriptStudySentenceIndexByProjectedId = useMemo(() => {
    const sourceIndexByStudySentenceId = new Map(
      transcriptStudySentences.map((sentence, index) => [sentence.id, index]),
    );
    return Object.fromEntries(displayedCues.flatMap((row) => {
      const directIndex = sourceIndexByStudySentenceId.get(row.id);
      if (directIndex !== undefined) return [[row.id, directIndex]];
      const liveStudySentenceIndex = continuousViewingStudyRows
        .studySentenceIndexByProjectedId[row.id];
      const liveStudySentenceId = liveStudySentenceIndex === undefined
        ? undefined
        : studySentences[liveStudySentenceIndex]?.id;
      const sourceIndex = liveStudySentenceId === undefined
        ? undefined
        : sourceIndexByStudySentenceId.get(liveStudySentenceId);
      return sourceIndex === undefined ? [] : [[row.id, sourceIndex]];
    }));
  }, [
    continuousViewingStudyRows.studySentenceIndexByProjectedId,
    displayedCues,
    studySentences,
    transcriptStudySentences,
  ]);
  const currentFocusedStudySentenceIds = useMemo(() => {
    const currentSourceIds = new Set(transcriptExperience.currentSourceCueIds);
    return transcriptStudySentences
      .filter((sentence) => sentence.sourceCueIds.some((id) => currentSourceIds.has(id)))
      .map((sentence) => sentence.id);
  }, [transcriptStudySentences, transcriptExperience.currentSourceCueIds]);
  const liveCurrentDisplayedCueIds = transcriptExperience.currentCueIds.flatMap(
    (id) => continuousViewingStudyRows.rowIdsByProjectedId[id] ?? [id],
  );
  const playbackAnchorStudySentence = transcriptStudySentences.find(
    (sentence) => sentence.id === transcriptSession.playbackAnchorStudySentenceId,
  );
  const activePlaybackAnchorStudySentenceId = playbackAnchorStudySentence
    && (playbackMs === null
      || (playbackAnchorStudySentence.startMs <= playbackMs
        && playbackMs < playbackAnchorStudySentence.endMs))
    ? playbackAnchorStudySentence.id
    : undefined;
  const currentDisplayedCueIds = hasPinnedStudyContext
    ? currentFocusedStudySentenceIds.length > 0
      ? currentFocusedStudySentenceIds
      : activePlaybackAnchorStudySentenceId ? [activePlaybackAnchorStudySentenceId] : []
    : liveCurrentDisplayedCueIds.length > 0
      ? liveCurrentDisplayedCueIds
      : activePlaybackAnchorStudySentenceId ? [activePlaybackAnchorStudySentenceId] : [];
  const displayedDiagnostics = useMemo<CaptionDiagnostic[]>(() => {
    if (!transcriptExperience.alignmentFailure) return diagnostics;
    return [
      ...diagnostics.filter((diagnostic) => diagnostic.stage !== 'caption-progress'),
      {
        stage: 'caption-progress',
        status: 'error',
        code: 'CAPTION_PROGRESS_ALIGNMENT_FAILED',
        message: 'YouTube 畫面字幕無法對齊完整字幕，已改用完整目前句子。',
        details: {
          reason: transcriptExperience.alignmentFailure.reason,
          currentText: transcriptExperience.alignmentFailure.currentText,
          renderedText: transcriptExperience.alignmentFailure.renderedText,
        },
      },
    ];
  }, [diagnostics, transcriptExperience.alignmentFailure]);
  const currentSynchronizationRef = useRef<{ videoId: string; synchronizationId: string } | null>(null);
  const activeTabIdRef = useRef<number | undefined>(undefined);
  const queryRequestTokenRef = useRef(0);
  const invalidatedContextReloadedRef = useRef(false);
  const runtimeMessageListenerRef = useRef<(message: ContentMessage, sender?: chrome.runtime.MessageSender) => void>(() => undefined);
  const transcriptSessionRef = useRef(initialLearningTranscriptSession);
  const studyIdentityRef = useRef(0);
  const focusRequestVersionRef = useRef(0);

  function replayRangeForCue(cue: CaptionCue | StudySentence): ReplayRange {
    return {
      startMs: Math.max(0, cue.startMs),
      endMs: Math.max(cue.startMs + 1, cue.endMs),
    };
  }

  function sendPlaybackIntent(intent: PlaybackIntent): void {
    if (!intent) return;
    const activeTabId = ownerTabId ?? activeTabIdRef.current;
    const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
    const identity = currentSynchronizationRef.current;
    if (activeTabId === undefined || !tabs || !identity) return;
    if (intent.type === 'pause') {
      void tabs.sendMessage(activeTabId, { type: 'PAUSE_PLAYBACK', ...identity });
      return;
    }
    if (intent.type === 'resume') {
      void tabs.sendMessage(activeTabId, { type: 'RESUME_PLAYBACK', ...identity });
      return;
    }
    void tabs.sendMessage(activeTabId, { type: 'PLAY_FROM_HERE', ...identity, timeMs: intent.timeMs });
  }

  function continuousRowIdForStudySentence(studySentenceId: string): string {
    const studySentenceIndex = studySentences.findIndex((sentence) => sentence.id === studySentenceId);
    if (studySentenceIndex < 0) return studySentenceId;
    const currentProjectedId = transcriptExperience.currentCueIds.find(
      (id) => continuousViewingStudyRows.studySentenceIndexByProjectedId[id] === studySentenceIndex,
    );
    if (currentProjectedId) {
      return continuousViewingStudyRows.rowIdsByProjectedId[currentProjectedId]?.[0]
        ?? currentProjectedId;
    }
    if (continuousViewingStudyRows.rows.some((row) => row.id === studySentenceId)) {
      return studySentenceId;
    }
    const projectedEntry = Object.entries(
      continuousViewingStudyRows.studySentenceIndexByProjectedId,
    ).find(([, index]) => index === studySentenceIndex);
    return projectedEntry?.[0] ?? studySentenceId;
  }

  function dispatchTranscriptEvent(event: LearningTranscriptEvent): void {
    const transition = transitionLearningTranscriptSession(transcriptSessionRef.current, event);
    transcriptSessionRef.current = transition.session;
    setTranscriptSession(transition.session);
    sendPlaybackIntent(transition.playbackIntent);
    if (transition.focusStudySentenceId) {
      const version = ++focusRequestVersionRef.current;
      setFocusRequest({
        cueId: continuousRowIdForStudySentence(transition.focusStudySentenceId),
        version,
      });
    }
  }

  function resetTranscriptSession(): void {
    dispatchTranscriptEvent({ type: 'RESET' });
    setFocusRequest(undefined);
  }

  function clearAssistant(): void {
    queryRequestTokenRef.current += 1;
    setSelection(null);
    setResult(null);
    setCompletedRequest(null);
    setSavedHistoryId(null);
    setIsFavorite(false);
    setHistoryWarning(null);
    setQueryError(null);
    setLoading(false);
    setActiveQueryConfig(null);
  }

  function selectTranscript(nextSelection: TranscriptSelection): void {
    const studySentence = transcriptStudySentences[nextSelection.studySentenceIndex];
    if (!studySentence) return;
    const queryContext = buildQueryContext({
      selectedText: nextSelection.selectedText,
      cueIndex: nextSelection.studySentenceIndex,
      cues: transcriptStudySentences,
      contextLines: settings.contextLines,
    });
    const studyContext: StudyContext = {
      id: `study-${++studyIdentityRef.current}`,
      studySentenceIndex: nextSelection.studySentenceIndex,
      studySentence: { ...studySentence, sourceCueIds: [...studySentence.sourceCueIds] },
      selectedText: nextSelection.selectedText,
      contextBefore: [...queryContext.contextBefore],
      contextAfter: [...queryContext.contextAfter],
      replayRange: replayRangeForCue(studySentence),
    };

    queryRequestTokenRef.current += 1;
    setSelection(nextSelection);
    setResult(null);
    setCompletedRequest(null);
    setSavedHistoryId(null);
    setIsFavorite(false);
    setHistoryWarning(null);
    setQueryError(null);
    setLoading(false);
    setActiveQueryConfig(null);
    dispatchTranscriptEvent({
      type: 'SELECT_TEXT',
      studyContext,
      studySentences,
    });
  }

  const loadSettings = useCallback(async () => {
    try {
      const loadedSettings = await messageClient.getSettings();
      setSettings(loadedSettings);
      setSettingsLoadState('ready');
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason);
      if (!invalidatedContextReloadedRef.current && /extension context invalidated/i.test(message)) {
        invalidatedContextReloadedRef.current = true;
        reloadPage();
        return;
      }
      setSettingsLoadState('error');
    }
  }, [reloadPage]);

  useEffect(() => {
    void loadSettings();
    const storage = typeof chrome !== 'undefined' ? chrome.storage : undefined;
    const settingsChangedListener = (_changes: { [key: string]: chrome.storage.StorageChange }, areaName: string) => {
      if (areaName === 'local') void loadSettings();
    };
    const focusListener = () => void loadSettings();
    const visibilityListener = () => {
      if (document.visibilityState === 'visible') void loadSettings();
    };

    storage?.onChanged?.addListener(settingsChangedListener);
    window.addEventListener('focus', focusListener);
    document.addEventListener('visibilitychange', visibilityListener);

    return () => {
      storage?.onChanged?.removeListener(settingsChangedListener);
      window.removeEventListener('focus', focusListener);
      document.removeEventListener('visibilitychange', visibilityListener);
    };
  }, [loadSettings]);

  useEffect(() => {
    dispatchTranscriptEvent({
      type: 'LEARNING_TRANSCRIPT_UPDATED',
      studySentences,
    });
  }, [studySentences]);

  useEffect(() => {
    const listener = (message: ContentMessage, sender?: chrome.runtime.MessageSender) => {
      if (typeof message.synchronizationId !== 'string' || message.synchronizationId.length === 0) return;
      const senderTabId = sender?.tab?.id;
      if (activeTabIdRef.current !== undefined
        && senderTabId !== undefined
        && senderTabId !== activeTabIdRef.current) return;

      const incomingIdentity = {
        videoId: message.videoId,
        synchronizationId: message.synchronizationId,
      };
      const currentIdentity = currentSynchronizationRef.current;
      if (currentIdentity === null) {
        if (message.type === 'PLAYBACK_UPDATED'
          || message.type === 'CAPTION_PROGRESS_UPDATED'
          || message.type === 'CAPTION_DIAGNOSTIC') return;
        currentSynchronizationRef.current = incomingIdentity;
      } else if (currentIdentity.videoId !== message.videoId
        || currentIdentity.synchronizationId !== message.synchronizationId) {
        const isActiveTabNavigation = message.type === 'VIDEO_CHANGED'
          && activeTabIdRef.current !== undefined
          && senderTabId === activeTabIdRef.current;
        if (!isActiveTabNavigation) return;
        currentSynchronizationRef.current = incomingIdentity;
      }

      if (message.type === 'CAPTIONS_UPDATED') {
        setCaptionTrack({
          ...message.track,
          cues: [...message.track.cues].sort((left, right) => left.startMs - right.startMs),
        });
        setRenderedProgress(null);
        setVideo({ id: message.videoId, title: message.videoTitle, url: message.videoUrl });
        setCaptionLifecycle(message.lifecycle);
        setDiagnostics((current) => current.filter((entry) => entry.status !== 'running'));
      }
      if (message.type === 'CAPTION_PROGRESS_UPDATED') {
        setRenderedProgress(message.progress);
      }
      if (message.type === 'CAPTION_DIAGNOSTIC') {
        setDiagnostics((current) => [
          ...current.filter((entry) => entry.stage !== message.diagnostic.stage),
          message.diagnostic,
        ]);
      }
      if (message.type === 'PLAYBACK_UPDATED') {
        setPlaybackMs(message.currentTimeMs);
      }
      if (message.type === 'VIDEO_CHANGED') {
        setCaptionTrack(null);
        setRenderedProgress(null);
        setPlaybackMs(null);
        setVideo({ id: message.videoId, title: message.videoTitle, url: message.videoUrl });
        clearAssistant();
        resetTranscriptSession();
        setDiagnostics([]);
        setCaptionLifecycle({ status: 'loading', message: '正在載入完整英文字幕…' });
      }
      if (message.type === 'CAPTION_LIFECYCLE_UPDATED') {
        setCaptionLifecycle(message.lifecycle);
        setCaptionTrack(null);
        if (message.lifecycle.status !== 'loading') {
          setDiagnostics((current) => current.filter((entry) => entry.status !== 'running'));
          clearAssistant();
          resetTranscriptSession();
        }
      }
    };
    runtimeMessageListenerRef.current = listener;
    chrome.runtime.onMessage.addListener(listener);

    const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
    if (tabs) {
      let activeTabRequestToken = 0;
      const showConnectionFailure = () => {
        const diagnostic: CaptionDiagnostic = {
          stage: 'player-response',
          status: 'error',
          code: 'EXTENSION_CONNECTION_FAILED',
          message: '請在 YouTube 分頁按 Ctrl+Shift+R，再重試完整字幕。',
          details: { source: 'extension-content-script', action: 'retry' },
        };
        setDiagnostics([diagnostic]);
        setCaptionLifecycle({
          status: 'retryable-error',
          code: 'EXTENSION_CONNECTION_FAILED',
          message: '無法連線到 YouTube 字幕腳本；請重新整理影片分頁後重試。',
          action: 'retry',
        });
      };
      const resetActiveTabState = () => {
        currentSynchronizationRef.current = null;
        setCaptionTrack(null);
        setRenderedProgress(null);
        setPlaybackMs(null);
        setVideo(null);
        clearAssistant();
        resetTranscriptSession();
        setDiagnostics([]);
        setCaptionLifecycle({
          status: 'retryable-error',
          code: 'YOUTUBE_TAB_REQUIRED',
          message: 'Open an available YouTube tab to load captions.',
          action: 'retry',
        });
      };
      const requestTabState = async (tabId: number, requestToken: number) => {
        if (requestToken !== activeTabRequestToken) return;
        activeTabIdRef.current = tabId;
        const message = await tabs.sendMessage(tabId, { type: 'REQUEST_STATE' });
        if (requestToken === activeTabRequestToken && activeTabIdRef.current === tabId && message && typeof message === 'object' && 'type' in message) {
          listener(message as ContentMessage, { tab: { id: tabId } } as chrome.runtime.MessageSender);
        }
      };
      const activatedListener = (activeInfo: chrome.tabs.TabActiveInfo) => {
        const requestToken = ++activeTabRequestToken;
        resetActiveTabState();
        void requestTabState(activeInfo.tabId, requestToken).catch(() => {
          if (requestToken === activeTabRequestToken) showConnectionFailure();
        });
      };
      const initialRequestToken = ++activeTabRequestToken;
      if (ownerTabId !== undefined) {
        void requestTabState(ownerTabId, initialRequestToken).catch(() => {
          if (initialRequestToken === activeTabRequestToken) showConnectionFailure();
        });
        return () => {
          chrome.runtime.onMessage.removeListener(listener);
        };
      }

      tabs.onActivated?.addListener(activatedListener);
      void tabs.query({ active: true, lastFocusedWindow: true })
        .then(([tab]) => tab?.id === undefined ? undefined : requestTabState(tab.id, initialRequestToken))
        .then((message) => {
          void message;
        })
        .catch(() => {
          if (initialRequestToken === activeTabRequestToken) showConnectionFailure();
        });

      return () => {
        chrome.runtime.onMessage.removeListener(listener);
        tabs.onActivated?.removeListener(activatedListener);
      };
    }

    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  async function refreshTranscript(): Promise<void> {
    setCaptionTrack(null);
    setRenderedProgress(null);
    setPlaybackMs(null);
    clearAssistant();
    resetTranscriptSession();
    setDiagnostics([]);
    setCaptionLifecycle({ status: 'loading', message: '正在載入完整英文字幕…' });
    try {
      const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
      if (!tabs) throw new Error('目前沒有可用的 YouTube 分頁。');
      const activeTabId = ownerTabId ?? (await tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (activeTabId === undefined) throw new Error('找不到目前使用中的 YouTube 分頁。');
      const identity = currentSynchronizationRef.current;
      const request = identity
        ? { type: 'RETRY_CAPTIONS' as const, ...identity }
        : { type: 'REQUEST_STATE' as const };
      const message = await tabs.sendMessage(activeTabId, request);
      if (message && typeof message === 'object' && 'type' in message) {
        runtimeMessageListenerRef.current(message as ContentMessage);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '無法連線到目前的 YouTube 分頁。';
      setDiagnostics([{
        stage: 'player-response',
        status: 'error',
        code: 'EXTENSION_CONNECTION_FAILED',
        message: '請在 YouTube 分頁按 Ctrl+Shift+R，再重試完整字幕。',
        details: { error: message, source: 'extension-content-script', action: 'retry' },
      }]);
      setCaptionLifecycle({
        status: 'retryable-error',
        code: 'EXTENSION_CONNECTION_FAILED',
        message: `重新抓取完整字幕失敗：${message}`,
        action: 'retry',
      });
    }
  }

  function handlePlaybackAction(action: TranscriptPlaybackAction, studySentence: StudySentence): void {
    const activeTabId = ownerTabId ?? activeTabIdRef.current;
    const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
    const identity = currentSynchronizationRef.current;
    if (activeTabId === undefined || !tabs || !identity) return;
    const replayRange = replayRangeForCue(studySentence);
    if (action === 'jump') {
      void tabs.sendMessage(activeTabId, { type: 'JUMP_TO_HERE', ...identity, timeMs: replayRange.startMs });
      return;
    }
    if (action === 'play-from-here') {
      clearAssistant();
      dispatchTranscriptEvent({
        type: 'PLAY_FROM_HERE',
        studySentenceId: studySentence.id,
        timeMs: replayRange.startMs,
      });
      return;
    }

    const studyContext = transcriptSessionRef.current.studyContext;
    const fixedReplayRange = studyContext?.studySentence.id === studySentence.id
      ? studyContext.replayRange
      : replayRange;
    void tabs.sendMessage(activeTabId, {
      type: 'REPLAY_RANGE',
      ...identity,
      ...fixedReplayRange,
    });
  }

  async function chooseIntent(intent: QueryIntentId, customQuestion?: string) {
    const studyContext = transcriptSessionRef.current.studyContext;
    if (!studyContext) return;
    dispatchTranscriptEvent({ type: 'LEARNING_ACTION', studyId: studyContext.id });
    if (settingsLoadState !== 'ready') {
      setQueryError('設定尚未載入完成，請稍候或到設定頁重新讀取。');
      return;
    }
    if (!video) {
      setQueryError('No YouTube video is available.');
      return;
    }
    const requestToken = ++queryRequestTokenRef.current;
    const request: QueryRequest = {
      intent,
      selectedText: studyContext.selectedText,
      sentence: studyContext.studySentence.text,
      contextBefore: [...studyContext.contextBefore],
      contextAfter: [...studyContext.contextAfter],
      outputLanguage: settings.outputLanguage,
      detailLevel: settings.detailLevel,
      customQuestion,
    };
    setLoading(true);
    setResult(null);
    setCompletedRequest(null);
    setSavedHistoryId(null);
    setIsFavorite(false);
    setQueryError(null);
    setHistoryWarning(null);
    setActiveQueryConfig({ model: settings.model, reasoningEffort: settings.reasoningEffort });
    try {
      const queryVideo = {
        ...video,
        subtitlePosition: { ...studyContext.replayRange },
      };
      const response = await messageClient.runQuery(request, queryVideo);
      const isCurrentStudy = queryRequestTokenRef.current === requestToken
        && transcriptSessionRef.current.studyContext?.id === studyContext.id;
      if (!isCurrentStudy) return;
      setResult(response.result);
      setCompletedRequest(request);
      if (response.historySaved && response.history) {
        setSavedHistoryId(response.history.id);
        setIsFavorite(response.history.isFavorite);
        setHistoryWarning(null);
      } else {
        setSavedHistoryId(null);
        setIsFavorite(false);
        setHistoryWarning(response.historyWarning ?? 'Answer completed, but it could not be saved to history.');
      }
    } catch (reason) {
      const isCurrentStudy = queryRequestTokenRef.current === requestToken
        && transcriptSessionRef.current.studyContext?.id === studyContext.id;
      if (isCurrentStudy) {
        setQueryError(reason instanceof Error ? reason.message : 'The OpenAI request failed.');
      }
    } finally {
      if (queryRequestTokenRef.current === requestToken
        && transcriptSessionRef.current.studyContext?.id === studyContext.id) {
        setLoading(false);
      }
    }
  }

  async function toggleResultFavorite() {
    if (!savedHistoryId) return;
    const nextFavorite = !isFavorite;
    try {
      await messageClient.toggleFavorite(savedHistoryId, nextFavorite);
      setIsFavorite(nextFavorite);
    } catch (reason) {
      setQueryError(reason instanceof Error ? reason.message : 'Unable to update favorite.');
    }
  }

  function currentStudySentenceId(): string | undefined {
    const currentStudySentenceId = currentFocusedStudySentenceIds[0]
      ?? activePlaybackAnchorStudySentenceId;
    if (currentStudySentenceId) return currentStudySentenceId;
    if (transcriptStudySentences.length === 0) return undefined;
    if (playbackMs === null) return transcriptStudySentences[0].id;
    const nextSentenceIndex = transcriptStudySentences.findIndex(
      (sentence) => sentence.startMs > playbackMs,
    );
    return nextSentenceIndex < 0
      ? transcriptStudySentences.at(-1)?.id
      : transcriptStudySentences[Math.max(0, nextSentenceIndex - 1)]?.id;
  }

  function browseEarlierTranscript(): void {
    dispatchTranscriptEvent({
      type: 'BROWSE_EARLIER_LEARNING_TRANSCRIPT',
      studySentences,
    });
  }

  function returnToCurrent(): void {
    clearAssistant();
    dispatchTranscriptEvent({
      type: 'RETURN_TO_CURRENT',
      currentStudySentenceId: currentStudySentenceId(),
    });
  }

  function resumeViewing(): void {
    clearAssistant();
    dispatchTranscriptEvent({
      type: 'RESUME',
      currentStudySentenceId: currentStudySentenceId(),
    });
  }

  const style = { '--font-size': `${settings.fontSize}px`, '--text-color': settings.textColor, '--active-cue-color': settings.activeCueColor } as CSSProperties;
  return <main className="sidepanel-app" style={style}>
    <nav role="tablist" aria-label="Side panel tabs">
      <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>字幕</button>
      <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>歷史</button>
      <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>設定</button>
    </nav>
    <section className={`tab-content ${tab === 'transcript' ? 'transcript-view' : ''}`}>
    {tab === 'transcript' && <>
      <div className="transcript-actions" data-caption-state={captionLifecycle.status}>
        {captionLifecycle.status === 'loading' && <p role="status">{captionLifecycle.message}</p>}
        {captionLifecycle.status === 'ready' && <>
          <p role="status">{captionLifecycle.message}</p>
          <button type="button" className="primary-action" onClick={() => void refreshTranscript()}>
            重新抓取字幕
          </button>
        </>}
        {captionLifecycle.status === 'retryable-error' && <>
          <p role="alert">{captionLifecycle.message}</p>
          <button type="button" className="primary-action" onClick={() => void refreshTranscript()}>
            重新抓取字幕
          </button>
        </>}
        {captionLifecycle.status === 'no-english-track' && <>
          <p role="status">{captionLifecycle.message} 請在 YouTube 開啟英文 CC，或選擇另一部影片。</p>
          <button type="button" className="primary-action" onClick={() => void refreshTranscript()}>
            重新抓取字幕
          </button>
        </>}
      </div>
      <CaptionDiagnostics entries={displayedDiagnostics} />
      {captionLifecycle.status === 'ready' && transcriptSession.mode === 'focused-study' && <section
        className="focused-study-controls"
        aria-label="Focused Study controls"
      >
        <strong>Focused Study</strong>
        {transcriptSession.newStudySentenceCount > 0 && <span>
          {transcriptSession.newStudySentenceCount} new {transcriptSession.newStudySentenceCount === 1 ? 'Study Sentence' : 'Study Sentences'}
        </span>}
        <button type="button" onClick={returnToCurrent}>Return to Current</button>
        <button type="button" onClick={resumeViewing}>Resume</button>
      </section>}
      <TranscriptPanel
        cues={displayedCues}
        studySentences={transcriptStudySentences}
        studySentenceIndexByProjectedId={transcriptStudySentenceIndexByProjectedId}
        currentCueIds={currentDisplayedCueIds}
        autoFollowPlayback={transcriptSession.mode === 'continuous-viewing' && settings.autoFollowPlayback}
        studySentenceId={transcriptSession.studyContext?.studySentence.id}
        focusRequest={focusRequest}
        fontSize={settings.fontSize}
        textColor={settings.textColor}
        onSelection={selectTranscript}
        onPlaybackAction={handlePlaybackAction}
        onBrowseEarlierTranscript={browseEarlierTranscript}
      />
      {selection && <SelectionAssistant
        selectedText={completedRequest?.selectedText ?? selection.selectedText}
        anchor={selection.anchor}
        result={result}
        loading={loading}
        requestedModel={activeQueryConfig?.model}
        requestedReasoningEffort={activeQueryConfig?.reasoningEffort}
        error={queryError}
        warning={historyWarning}
        onChooseIntent={(intent, question) => void chooseIntent(intent, question)}
        onClose={clearAssistant}
        onToggleFavorite={toggleResultFavorite}
        isSaved={savedHistoryId !== null}
        isFavorite={isFavorite}
      />}
    </>}
    {tab === 'history' && <HistoryView />}
    {tab === 'settings' && settingsLoadState === 'loading' && <p role="status">正在讀取設定…</p>}
    {tab === 'settings' && settingsLoadState === 'error' && <section className="settings-load-error">
      <p role="alert">設定讀取失敗。套件重新整理後，請重新聚焦側邊欄或按下重試。</p>
      <button type="button" onClick={() => void loadSettings()}>重試讀取設定</button>
    </section>}
    {tab === 'settings' && settingsLoadState === 'ready' && <SettingsView settings={settings} onSaved={(saved) => {
      setSettings(saved);
      setSettingsLoadState('ready');
    }} />}
    </section>
  </main>;
}
