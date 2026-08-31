import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { ActiveCaptionGroup, CaptionCue, CaptionDiagnostic, CaptionTrack, ContentMessage, PublicSettings, QueryIntentId, QueryRequest, QueryResult as QueryResultValue, RenderedCaptionProgress } from '../domain/types';
import { buildQueryContext } from '../domain/context-builder';
import { projectLearningTranscriptExperience } from '../domain/learning-transcript-experience';
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

function sanitizeActiveGroup(track: CaptionTrack): ActiveCaptionGroup | undefined {
  if (track.source !== 'visible-dom' || !track.activeGroup) return undefined;
  const validIds = new Set(track.cues.map((cue) => cue.id));
  const cueOrder = new Map(track.cues.map((cue, index) => [cue.id, index]));
  const seen = new Set<string>();
  const cueIds = track.activeGroup.cueIds.filter((id) => {
    if (!validIds.has(id) || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const positions = cueIds.map((id) => cueOrder.get(id)!);
  const contiguous = positions.every((position, index) => (
    index === 0 || position === positions[index - 1] + 1
  ));
  return cueIds.length > 0
    && contiguous
    && Number.isFinite(track.activeGroup.startMs)
    ? { cueIds, startMs: Math.max(0, track.activeGroup.startMs) }
    : undefined;
}

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
  const [refreshing, setRefreshing] = useState(false);
  const [diagnostics, setDiagnostics] = useState<CaptionDiagnostic[]>([]);
  const [error, setError] = useState<string | null>('Open an available YouTube tab to load captions.');
  const [queryError, setQueryError] = useState<string | null>(null);
  const [settings, setSettings] = useState<PublicSettings>(publicDefaultSettings);
  const [activeQueryConfig, setActiveQueryConfig] = useState<ActiveQueryConfig | null>(null);
  const [settingsLoadState, setSettingsLoadState] = useState<SettingsLoadState>('loading');
  const transcriptExperience = useMemo(() => projectLearningTranscriptExperience({
    track: captionTrack,
    playbackMs,
    renderedProgress,
  }), [captionTrack, playbackMs, renderedProgress]);
  const orderedCues = useMemo(
    () => [...transcriptExperience.fullTranscript].sort((left, right) => left.startMs - right.startMs),
    [transcriptExperience.fullTranscript],
  );
  const displayedDiagnostics = useMemo<CaptionDiagnostic[]>(() => {
    if (!transcriptExperience.alignmentFailure) return diagnostics;
    return [
      ...diagnostics.filter((diagnostic) => diagnostic.stage !== 'visible-dom'),
      {
        stage: 'visible-dom',
        status: 'fallback',
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
  const captionSource = captionTrack?.source ?? null;
  const activeGroup = captionTrack?.activeGroup;
  const selectedVideoIdRef = useRef<string | null>(null);
  const activeTabIdRef = useRef<number | undefined>(undefined);
  const queryRequestTokenRef = useRef(0);
  const invalidatedContextReloadedRef = useRef(false);
  const runtimeMessageListenerRef = useRef<(message: ContentMessage, sender?: chrome.runtime.MessageSender) => void>(() => undefined);

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
    const listener = (message: ContentMessage, sender?: chrome.runtime.MessageSender) => {
      const senderTabId = sender?.tab?.id;
      if (activeTabIdRef.current !== undefined && senderTabId !== undefined && senderTabId !== activeTabIdRef.current) {
        return;
      }
      if (selectedVideoIdRef.current === null) {
        if (message.type === 'PLAYBACK_UPDATED' || message.type === 'CAPTION_PROGRESS_UPDATED') {
          return;
        }
        selectedVideoIdRef.current = message.videoId;
      } else if (message.videoId !== selectedVideoIdRef.current) {
        const isActiveTabNavigation = message.type === 'VIDEO_CHANGED'
          && activeTabIdRef.current !== undefined
          && senderTabId === activeTabIdRef.current;
        if (!isActiveTabNavigation) return;
        selectedVideoIdRef.current = message.videoId;
      }

      if (message.type === 'CAPTIONS_UPDATED') {
        setCaptionTrack({
          ...message.track,
          cues: [...message.track.cues].sort((left, right) => left.startMs - right.startMs),
          activeGroup: sanitizeActiveGroup(message.track),
        });
        setRenderedProgress((current) => message.track.source === 'timedtext' ? null : current);
        setVideo({ id: message.videoId, title: message.videoTitle, url: message.videoUrl });
        setError(null);
        setRefreshing(false);
      }
      if (message.type === 'CAPTION_PROGRESS_UPDATED') {
        setRenderedProgress(message.progress);
        setCaptionTrack((current) => {
          if (current || !message.progress.activeGroup || message.progress.cues.length === 0) return current;
          return {
            language: 'en-visible',
            isEnglish: true,
            source: 'visible-dom',
            cues: message.progress.cues,
            activeGroup: message.progress.activeGroup,
          };
        });
      }
      if (message.type === 'CAPTION_DIAGNOSTIC') {
        setDiagnostics((current) => [...current.filter((entry) => entry.stage !== message.diagnostic.stage), message.diagnostic]);
        if (message.diagnostic.status === 'error') {
          setError(message.diagnostic.message);
        }
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
        setDiagnostics([]);
      }
      if (message.type === 'NO_CAPTIONS') {
        setCaptionTrack(null);
        setRenderedProgress(null);
        setPlaybackMs(null);
        clearAssistant();
        setError(message.reason === 'not-english'
          ? 'YouTube 有字幕，但沒有英文字幕軌。'
          : message.reason === 'unsupported'
            ? '找到英文字幕軌，但字幕下載或解析失敗；請查看字幕診斷。'
            : '尚未取得完整字幕或畫面字幕；請確認 YouTube 的 CC 已開啟。');
        setRefreshing(false);
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
          message: '請在 YouTube 分頁按 Ctrl+Shift+R，再重新抓取字幕。',
        };
        setDiagnostics([diagnostic]);
        setError('無法連線到 YouTube 字幕腳本；目前分頁可能仍在使用舊版 extension。');
      };
      const resetActiveTabState = () => {
        selectedVideoIdRef.current = null;
        setCaptionTrack(null);
        setRenderedProgress(null);
        setPlaybackMs(null);
        setVideo(null);
        clearAssistant();
        setDiagnostics([]);
        setError(null);
        setRefreshing(false);
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
    setRefreshing(true);
    setError(null);
    setDiagnostics([]);
    try {
      const tabs = typeof chrome !== 'undefined' ? chrome.tabs : undefined;
      if (!tabs) throw new Error('目前沒有可用的 YouTube 分頁。');
      const activeTabId = ownerTabId ?? (await tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;
      if (activeTabId === undefined) throw new Error('找不到目前使用中的 YouTube 分頁。');
      const message = await tabs.sendMessage(activeTabId, { type: 'REQUEST_STATE' });
      if (message && typeof message === 'object' && 'type' in message) {
        runtimeMessageListenerRef.current(message as ContentMessage);
      }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '無法連線到目前的 YouTube 分頁。';
      setDiagnostics([{
        stage: 'player-response',
        status: 'error',
        code: 'EXTENSION_CONNECTION_FAILED',
        message: '請在 YouTube 分頁按 Ctrl+Shift+R，再重新抓取字幕。',
        details: { error: message },
      }]);
      setError(`重新抓取字幕失敗：${message}`);
      setRefreshing(false);
    }
  }

  function handlePlaybackAction(action: TranscriptPlaybackAction, cue: CaptionCue): void {
    const activeTabId = ownerTabId ?? activeTabIdRef.current;
    if (activeTabId === undefined || !chrome.tabs) return;
    const belongsToVisibleGroup = captionSource === 'visible-dom'
      && activeGroup?.cueIds.includes(cue.id);
    const startMs = belongsToVisibleGroup ? activeGroup?.startMs ?? cue.startMs : cue.startMs;
    if (action === 'jump') {
      void chrome.tabs.sendMessage(activeTabId, { type: 'JUMP_TO_HERE', timeMs: Math.max(0, startMs) });
      return;
    }
    if (action === 'play-from-here') {
      clearAssistant();
      void chrome.tabs.sendMessage(activeTabId, { type: 'PLAY_FROM_HERE', timeMs: Math.max(0, startMs) });
      return;
    }

    const activeCueIds = new Set(belongsToVisibleGroup ? activeGroup?.cueIds : []);
    const activeEndMs = belongsToVisibleGroup
      ? captionTrack?.cues
        .filter((candidate) => activeCueIds.has(candidate.id))
        .reduce((endMs, candidate) => Math.max(endMs, candidate.endMs), cue.endMs) ?? cue.endMs
      : cue.endMs;
    void chrome.tabs.sendMessage(activeTabId, {
      type: 'REPLAY_RANGE',
      startMs: Math.max(0, startMs),
      endMs: Math.max(startMs + 1, activeEndMs),
    });
  }

  const context = useMemo(() => selection ? {
    ...buildQueryContext({
      selectedText: selection.selectedText,
      cueIndex: selection.cueIndex,
      cues: orderedCues,
      contextLines: settings.contextLines,
    }),
  } : null, [orderedCues, settings.contextLines, selection]);

  async function chooseIntent(intent: QueryIntentId, customQuestion?: string) {
    const querySelection = selection;
    const queryContext = context;
    if (!querySelection || !queryContext) return;
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
      selectedText: querySelection.selectedText,
      sentence: queryContext.sentence,
      contextBefore: queryContext.contextBefore,
      contextAfter: queryContext.contextAfter,
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
      const selectedCue = orderedCues[querySelection.cueIndex];
      const queryVideo = selectedCue
        ? { ...video, subtitlePosition: { startMs: selectedCue.startMs, endMs: selectedCue.endMs } }
        : video;
      const response = await messageClient.runQuery(request, queryVideo);
      if (queryRequestTokenRef.current !== requestToken) return;
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
      if (queryRequestTokenRef.current === requestToken) {
        setQueryError(reason instanceof Error ? reason.message : 'The OpenAI request failed.');
      }
    } finally {
      if (queryRequestTokenRef.current === requestToken) setLoading(false);
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

  const style = { '--font-size': `${settings.fontSize}px`, '--text-color': settings.textColor, '--active-cue-color': settings.activeCueColor } as CSSProperties;
  return <main className="sidepanel-app" style={style}>
    <nav role="tablist" aria-label="Side panel tabs">
      <button role="tab" aria-selected={tab === 'transcript'} onClick={() => setTab('transcript')}>字幕</button>
      <button role="tab" aria-selected={tab === 'history'} onClick={() => setTab('history')}>歷史</button>
      <button role="tab" aria-selected={tab === 'settings'} onClick={() => setTab('settings')}>設定</button>
    </nav>
    <section className={`tab-content ${tab === 'transcript' ? 'transcript-view' : ''}`}>
    {tab === 'transcript' && <>
      <div className="transcript-actions">
        <button type="button" className="primary-action" onClick={() => void refreshTranscript()} disabled={refreshing}>
          重新抓取字幕
        </button>
        {refreshing && <p role="status">正在重新抓取字幕…</p>}
      </div>
      <CaptionDiagnostics entries={displayedDiagnostics} />
      <TranscriptPanel
        cues={settings.autoFollowPlayback ? transcriptExperience.visibleCues : orderedCues}
        sourceCues={orderedCues}
        sourceCueIndexByVisibleId={transcriptExperience.sourceCueIndexByVisibleId}
        currentCueIds={transcriptExperience.currentCueIds}
        autoFollowPlayback={settings.autoFollowPlayback}
        fontSize={settings.fontSize}
        textColor={settings.textColor}
        onSelection={selectTranscript}
        onPlaybackAction={handlePlaybackAction}
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
      {error && <p role="alert">{error}</p>}
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
