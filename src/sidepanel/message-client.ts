import type { HistoryRecord, PublicSettings, QueryRequest, RequestMessage, ResponseMessage, RunQueryResponse, Settings } from '../domain/types';

export class MessageClientError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = 'MessageClientError';
  }
}

async function send<T>(message: RequestMessage): Promise<T> {
  const response = await chrome.runtime.sendMessage(message) as ResponseMessage;
  if (!response.ok) throw new MessageClientError(response.error.code, response.error.message);
  return response.data as T;
}

export function getSettings(): Promise<PublicSettings> {
  return send<PublicSettings>({ type: 'GET_SETTINGS' });
}

export function saveSettings(patch: Partial<Settings>): Promise<PublicSettings> {
  return send<PublicSettings>({ type: 'SAVE_SETTINGS', patch });
}

export function clearApiKey(): Promise<PublicSettings> {
  return saveSettings({ apiKey: '' });
}

export function runQuery(request: QueryRequest, video: { id: string; title: string; url: string }): Promise<RunQueryResponse> {
  return send<RunQueryResponse>({ type: 'RUN_QUERY', request, video });
}

export function saveHistory(record: HistoryRecord): Promise<void> {
  return send<void>({ type: 'SAVE_HISTORY', record });
}

export function listHistory(): Promise<HistoryRecord[]> {
  return send<HistoryRecord[]>({ type: 'LIST_HISTORY' });
}

export function deleteHistory(id: string): Promise<void> {
  return send<void>({ type: 'DELETE_HISTORY', id });
}

export function toggleFavorite(id: string, isFavorite: boolean): Promise<void> {
  return send<void>({ type: 'TOGGLE_FAVORITE', id, isFavorite });
}
