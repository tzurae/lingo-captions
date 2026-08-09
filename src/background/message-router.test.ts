import { describe, expect, it } from 'vitest';
import type { HistoryRecord, QueryRequest, QueryResult, Settings } from '../domain/types';
import { LLMError } from '../llm/openai-client';
import { defaultPromptTemplates } from '../llm/prompt-templates';
import type { HistoryRepository } from '../storage/history-repository';
import type { SettingsStore } from '../storage/settings-store';
import type { WorkflowRunner } from '../workflows/workflow-runner';
import { MessageRouter } from './message-router';

const settings: Settings = {
  apiKey: 'sk-example-1234',
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'normal',
  contextLines: 1,
  fontSize: 16,
  textColor: '#111111',
  activeCueColor: '#eeeeee',
  autoFollowPlayback: true,
  prompts: defaultPromptTemplates,
};

const request: QueryRequest = {
  intent: 'translate_sentence',
  selectedText: 'Good morning',
  sentence: 'Good morning, everyone.',
  contextBefore: [],
  contextAfter: [],
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'normal',
};

const result: QueryResult = { answer: '早安', model: 'gpt-test', createdAt: 1000 };

function historyRecord(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'history-1',
    createdAt: 1000,
    videoId: 'video-1',
    videoTitle: 'Video one',
    videoUrl: 'https://www.youtube.com/watch?v=video-1',
    request,
    result,
    isFavorite: false,
    ...overrides,
  };
}

class MemorySettingsStore implements SettingsStore {
  constructor(private value: Settings = settings) {}

  async get(): Promise<Settings> {
    return this.value;
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    this.value = { ...this.value, ...patch };
    return this.value;
  }

  async clearApiKey(): Promise<void> {
    this.value = { ...this.value, apiKey: '' };
  }
}

class MemoryHistoryRepository implements HistoryRepository {
  records: HistoryRecord[] = [];

  async add(record: HistoryRecord): Promise<void> {
    this.records.push(record);
  }

  async list(filter?: { videoId?: string; isFavorite?: boolean }): Promise<HistoryRecord[]> {
    return this.records.filter((record) => (
      (filter?.videoId === undefined || record.videoId === filter.videoId)
      && (filter?.isFavorite === undefined || record.isFavorite === filter.isFavorite)
    ));
  }

  async update(id: string, patch: Partial<Pick<HistoryRecord, 'isFavorite'>>): Promise<void> {
    const record = this.records.find((item) => item.id === id);
    if (record === undefined) throw new Error(`Missing history: ${id}`);
    Object.assign(record, patch);
  }

  async remove(id: string): Promise<void> {
    this.records = this.records.filter((record) => record.id !== id);
  }

  async clear(): Promise<void> {
    this.records = [];
  }
}

function createRouter(options: {
  currentSettings?: Settings;
  run?: (input: QueryRequest) => Promise<QueryResult>;
  repository?: MemoryHistoryRepository;
  settingsStore?: MemorySettingsStore;
} = {}) {
  const repository = options.repository ?? new MemoryHistoryRepository();
  const settingsStore = options.settingsStore ?? new MemorySettingsStore(options.currentSettings);
  const inputs: QueryRequest[] = [];
  const runner = {
    async run(input: QueryRequest): Promise<QueryResult> {
      inputs.push(input);
      return options.run?.(input) ?? result;
    },
  } as WorkflowRunner;
  const factorySettings: Settings[] = [];
  const router = new MessageRouter({
    settingsStore,
    historyRepository: repository,
    workflowFactory: (current) => {
      factorySettings.push(current);
      return runner;
    },
    idFactory: () => 'generated-id',
    now: () => 2000,
  });

  return { router, repository, settingsStore, inputs, factorySettings };
}

describe('MessageRouter', () => {
  it('returns settings without the stored API key', async () => {
    const { router } = createRouter();
    const { apiKey: _apiKey, ...publicSettings } = settings;

    const response = await router.handle({ type: 'GET_SETTINGS' });

    expect(response).toEqual({
      ok: true,
      data: { ...publicSettings, hasApiKey: true, apiKeyLastFour: '1234' },
    });
    expect(response.ok && response.data).not.toHaveProperty('apiKey');
    expect(JSON.stringify(response)).not.toContain(settings.apiKey);
  });

  it('persists a settings patch and returns sanitized settings', async () => {
    const { router, settingsStore } = createRouter();
    const { apiKey: _apiKey, ...publicSettings } = settings;

    const response = await router.handle({ type: 'SAVE_SETTINGS', patch: { apiKey: 'replacement-9876' } });

    expect(await settingsStore.get()).toEqual({ ...settings, apiKey: 'replacement-9876' });
    expect(response).toEqual({
      ok: true,
      data: { ...publicSettings, hasApiKey: true, apiKeyLastFour: '9876' },
    });
    expect(response.ok && response.data).not.toHaveProperty('apiKey');
    expect(JSON.stringify(response)).not.toContain('replacement-9876');
  });

  it('returns no API-key suffix when no key is configured', async () => {
    const { router } = createRouter({ currentSettings: { ...settings, apiKey: '   ' } });

    const response = await router.handle({ type: 'GET_SETTINGS' });

    expect(response.ok && response.data).toMatchObject({
      hasApiKey: false,
      apiKeyLastFour: null,
    });
  });

  it('rejects a query without an API key before creating a workflow', async () => {
    const { router, inputs, factorySettings } = createRouter({ currentSettings: { ...settings, apiKey: '   ' } });

    const response = await router.handle({ type: 'RUN_QUERY', request, video: { id: 'video-1', title: 'Video one', url: 'https://www.youtube.com/watch?v=video-1', subtitlePosition: { startMs: 1_000, endMs: 2_000 } } });

    expect(response).toEqual({ ok: false, error: { code: 'API_KEY_MISSING', message: 'An OpenAI API key is required.' } });
    expect(factorySettings).toEqual([]);
    expect(inputs).toEqual([]);
  });

  it('returns the auto-saved record and favorites it without creating duplicate history', async () => {
    const { router, repository, inputs, factorySettings } = createRouter();

    const response = await router.handle({ type: 'RUN_QUERY', request, video: { id: 'video-1', title: 'Video one', url: 'https://www.youtube.com/watch?v=video-1', subtitlePosition: { startMs: 1_000, endMs: 2_000 } } });

    expect(inputs).toEqual([request]);
    expect(factorySettings).toEqual([settings]);
    expect(repository.records).toEqual([historyRecord({ id: 'generated-id', createdAt: 2000, subtitlePosition: { startMs: 1_000, endMs: 2_000 } })]);
    expect(JSON.stringify(repository.records)).not.toContain(settings.apiKey);
    expect(response).toEqual({ ok: true, data: { result, history: historyRecord({ id: 'generated-id', createdAt: 2000, subtitlePosition: { startMs: 1_000, endMs: 2_000 } }), historySaved: true } });
    expect(JSON.stringify(response)).not.toContain(settings.apiKey);

    await expect(router.handle({ type: 'TOGGLE_FAVORITE', id: 'generated-id', isFavorite: true })).resolves.toEqual({ ok: true, data: undefined });

    expect(repository.records).toEqual([historyRecord({ id: 'generated-id', createdAt: 2000, isFavorite: true, subtitlePosition: { startMs: 1_000, endMs: 2_000 } })]);
  });

  it('preserves an LLM error code without exposing the API key', async () => {
    const { router } = createRouter({
      run: async () => { throw new LLMError('RATE_LIMITED', `Retry later; ${settings.apiKey}`); },
    });

    const response = await router.handle({ type: 'RUN_QUERY', request, video: { id: 'video-1', title: 'Video one', url: 'https://www.youtube.com/watch?v=video-1' } });

    expect(response).toEqual({ ok: false, error: { code: 'RATE_LIMITED', message: 'The OpenAI service is rate-limited. Please try again later.' } });
    expect(JSON.stringify(response)).not.toContain(settings.apiKey);
  });

    it.each([
      ['API_KEY_INVALID', 'The OpenAI API key is invalid. Check it in Settings.'],
      ['CREDIT_BALANCE_EXHAUSTED', 'OpenAI API 額度已用完。請到 OpenAI Billing 儲值後再試。'],
      ['SPEND_LIMIT_EXCEEDED', 'OpenAI 專案或組織已達支出上限。請到 OpenAI Limits 調高上限。'],
      ['USAGE_LIMIT_EXCEEDED', 'OpenAI 組織已達使用上限。請到 OpenAI Limits 檢查或申請提高。'],
      ['RATE_LIMITED', 'The OpenAI service is rate-limited. Please try again later.'],
    ['NETWORK_ERROR', 'Could not reach the OpenAI service. Check your connection and try again.'],
    ['TIMEOUT', 'The OpenAI request timed out. Please try again.'],
  ] as const)('returns a safe user-facing message for %s', async (code, message) => {
    const { router } = createRouter({
      run: async () => { throw new LLMError(code, `unsafe details ${settings.apiKey}`); },
    });

    await expect(router.handle({ type: 'RUN_QUERY', request, video: { id: 'video-1', title: 'Video one', url: 'https://www.youtube.com/watch?v=video-1' } })).resolves.toEqual({
      ok: false,
      error: { code, message },
    });
  });

  it('returns the successful result with a clear warning when history auto-save fails', async () => {
    const repository = new MemoryHistoryRepository();
    repository.add = async () => { throw new Error('IndexedDB unavailable'); };
    const { router } = createRouter({ repository });

    await expect(router.handle({ type: 'RUN_QUERY', request, video: { id: 'video-1', title: 'Video one', url: 'https://www.youtube.com/watch?v=video-1' } })).resolves.toEqual({
      ok: true,
      data: {
        result,
        historySaved: false,
        historyWarning: 'Answer completed, but it could not be saved to history.',
      },
    });
  });

  it('delegates history list, favorite, and deletion operations with sanitized results', async () => {
    const repository = new MemoryHistoryRepository();
    await repository.add(historyRecord());
    const { router } = createRouter({ repository });

    await expect(router.handle({ type: 'LIST_HISTORY', filter: { videoId: 'video-1' } })).resolves.toEqual({ ok: true, data: [historyRecord()] });
    await expect(router.handle({ type: 'TOGGLE_FAVORITE', id: 'history-1', isFavorite: true })).resolves.toEqual({ ok: true, data: undefined });
    expect(repository.records).toEqual([historyRecord({ isFavorite: true })]);
    await expect(router.handle({ type: 'DELETE_HISTORY', id: 'history-1' })).resolves.toEqual({ ok: true, data: undefined });
    expect(repository.records).toEqual([]);
  });

  it('saves a key-free supplied history record', async () => {
    const { router, repository } = createRouter();
    const record = historyRecord();

    await expect(router.handle({ type: 'SAVE_HISTORY', record })).resolves.toEqual({ ok: true, data: undefined });

    expect(repository.records).toEqual([record]);
  });

  it('rejects a supplied history record containing apiKey at any depth', async () => {
    const { router, repository } = createRouter();
    const unsafe = {
      ...historyRecord(),
      request: { ...request, metadata: { apiKey: settings.apiKey } },
    } as unknown as HistoryRecord;

    const response = await router.handle({ type: 'SAVE_HISTORY', record: unsafe });

    expect(response).toEqual({ ok: false, error: { code: 'API_KEY_NOT_ALLOWED', message: 'History records must not contain an API key.' } });
    expect(repository.records).toEqual([]);
  });

  it('maps unexpected failures to ROUTER_ERROR without echoing secrets', async () => {
    const settingsStore = new MemorySettingsStore();
    settingsStore.get = async () => { throw new Error(`Storage failed for ${settings.apiKey}`); };
    const { router } = createRouter({ settingsStore });

    const response = await router.handle({ type: 'GET_SETTINGS' });

    expect(response).toEqual({ ok: false, error: { code: 'ROUTER_ERROR', message: 'The request could not be completed.' } });
    expect(JSON.stringify(response)).not.toContain(settings.apiKey);
  });
});
