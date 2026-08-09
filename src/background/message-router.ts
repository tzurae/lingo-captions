import type { HistoryRepository } from '../storage/history-repository';
import type { SettingsStore } from '../storage/settings-store';
import type { HistoryRecord, PublicSettings, RequestMessage, ResponseMessage, Settings } from '../domain/types';
import { LLMError } from '../llm/openai-client';
import type { WorkflowRunner } from '../workflows/workflow-runner';

const llmErrorMessages: Record<string, string> = {
  API_KEY_INVALID: 'The OpenAI API key is invalid. Check it in Settings.',
  CREDIT_BALANCE_EXHAUSTED: 'OpenAI API 額度已用完。請到 OpenAI Billing 儲值後再試。',
  SPEND_LIMIT_EXCEEDED: 'OpenAI 專案或組織已達支出上限。請到 OpenAI Limits 調高上限。',
  USAGE_LIMIT_EXCEEDED: 'OpenAI 組織已達使用上限。請到 OpenAI Limits 檢查或申請提高。',
  RATE_LIMITED: 'The OpenAI service is rate-limited. Please try again later.',
  NETWORK_ERROR: 'Could not reach the OpenAI service. Check your connection and try again.',
  TIMEOUT: 'The OpenAI request timed out. Please try again.',
  OPENAI_REQUEST_FAILED: 'The OpenAI service could not complete the request.',
  LLM_EMPTY_RESPONSE: 'The language model returned no answer.',
};

export type RouterDependencies = {
  settingsStore: SettingsStore;
  historyRepository: HistoryRepository;
  workflowFactory: (settings: Settings) => WorkflowRunner;
  idFactory?: () => string;
  now?: () => number;
};

function sanitize<T>(value: T): T {
  if (Array.isArray(value)) return value.map(sanitize) as T;
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== 'apiKey').map(([key, item]) => [key, sanitize(item)]),
    ) as T;
  }
  return value;
}

function sanitizeSettings(settings: Settings): PublicSettings {
  const { apiKey, ...publicSettings } = settings;
  const trimmedApiKey = apiKey.trim();
  return {
    ...publicSettings,
    hasApiKey: trimmedApiKey !== '',
    apiKeyLastFour: trimmedApiKey === '' ? null : trimmedApiKey.slice(-4),
  };
}

function containsApiKey(record: HistoryRecord): boolean {
  return JSON.stringify(record).includes('"apiKey"');
}

function defaultId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export class MessageRouter {
  private readonly idFactory: () => string;
  private readonly now: () => number;

  constructor(private readonly dependencies: RouterDependencies) {
    this.idFactory = dependencies.idFactory ?? defaultId;
    this.now = dependencies.now ?? Date.now;
  }

  async handle(message: RequestMessage): Promise<ResponseMessage> {
    try {
      switch (message.type) {
        case 'GET_SETTINGS':
          return this.success(sanitizeSettings(await this.dependencies.settingsStore.get()));
        case 'SAVE_SETTINGS':
          return this.success(sanitizeSettings(await this.dependencies.settingsStore.update(message.patch)));
        case 'RUN_QUERY':
          return await this.runQuery(message);
        case 'SAVE_HISTORY':
          if (containsApiKey(message.record)) return this.failure('API_KEY_NOT_ALLOWED', 'History records must not contain an API key.');
          await this.dependencies.historyRepository.add(message.record);
          return this.success(undefined);
        case 'LIST_HISTORY':
          return this.success(sanitize(await this.dependencies.historyRepository.list(message.filter)));
        case 'DELETE_HISTORY':
          await this.dependencies.historyRepository.remove(message.id);
          return this.success(undefined);
        case 'TOGGLE_FAVORITE':
          await this.dependencies.historyRepository.update(message.id, { isFavorite: message.isFavorite });
          return this.success(undefined);
      }
    } catch (error) {
      if (error instanceof LLMError) return this.failure(error.code, llmErrorMessages[error.code] ?? 'The language model request failed.');
      return this.failure('ROUTER_ERROR', 'The request could not be completed.');
    }
  }

  private async runQuery(message: Extract<RequestMessage, { type: 'RUN_QUERY' }>): Promise<ResponseMessage> {
    const settings = await this.dependencies.settingsStore.get();
    if (settings.apiKey.trim() === '') return this.failure('API_KEY_MISSING', 'An OpenAI API key is required.');

    const result = await this.dependencies.workflowFactory(settings).run(message.request);
    const history = {
      id: this.idFactory(),
      createdAt: this.now(),
      videoId: message.video.id,
      videoTitle: message.video.title,
      videoUrl: message.video.url,
      request: message.request,
      result,
      isFavorite: false,
      ...(message.video.subtitlePosition === undefined ? {} : { subtitlePosition: message.video.subtitlePosition }),
    };
    try {
      await this.dependencies.historyRepository.add(history);
    } catch {
      return this.success({
        result,
        historySaved: false,
        historyWarning: 'Answer completed, but it could not be saved to history.',
      });
    }
    return this.success(sanitize({ result, history, historySaved: true }));
  }

  private success(data: unknown): ResponseMessage {
    return { ok: true, data };
  }

  private failure(code: string, message: string): ResponseMessage {
    return { ok: false, error: { code, message } };
  }
}
