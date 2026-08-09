import { listQueryIntents } from '../domain/query-intents';
import type { HistoryRecord, QueryIntentId, ReasoningEffort, SubtitlePosition } from '../domain/types';

export type HistoryExport = {
  version: 1;
  exportedAt: number;
  records: HistoryRecord[];
};

function containsApiKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsApiKey);
  if (value !== null && typeof value === 'object') {
    return Object.entries(value).some(([key, item]) => key === 'apiKey' || containsApiKey(item));
  }
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isQueryIntentId(value: unknown): value is QueryIntentId {
  return typeof value === 'string' && listQueryIntents().some((intent) => intent.id === value);
}

function isReasoningEffort(value: unknown): value is ReasoningEffort {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max';
}

function isRequest(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  return isQueryIntentId(value.intent)
    && typeof value.selectedText === 'string'
    && typeof value.sentence === 'string'
    && Array.isArray(value.contextBefore) && value.contextBefore.every((item) => typeof item === 'string')
    && Array.isArray(value.contextAfter) && value.contextAfter.every((item) => typeof item === 'string')
    && typeof value.outputLanguage === 'string'
    && (value.detailLevel === 'brief' || value.detailLevel === 'normal' || value.detailLevel === 'detailed')
    && (value.customQuestion === undefined || typeof value.customQuestion === 'string');
}

function isResult(value: unknown): boolean {
  return isPlainObject(value)
    && typeof value.answer === 'string'
    && typeof value.model === 'string'
    && (value.reasoningEffort === undefined || isReasoningEffort(value.reasoningEffort))
    && typeof value.createdAt === 'number';
}

function isSubtitlePosition(value: unknown): value is SubtitlePosition {
  if (!isPlainObject(value)) return false;
  return typeof value.startMs === 'number'
    && Number.isFinite(value.startMs)
    && value.startMs >= 0
    && typeof value.endMs === 'number'
    && Number.isFinite(value.endMs)
    && value.endMs >= value.startMs;
}

function isRecord(value: unknown): value is HistoryRecord {
  if (!isPlainObject(value)) return false;
  const record = value;
  return typeof record.id === 'string'
    && typeof record.createdAt === 'number'
    && typeof record.videoId === 'string'
    && typeof record.videoTitle === 'string'
    && typeof record.videoUrl === 'string'
    && isRequest(record.request)
    && isResult(record.result)
    && typeof record.isFavorite === 'boolean'
    && (record.subtitlePosition === undefined || isSubtitlePosition(record.subtitlePosition));
}

function assertNoApiKeys(records: unknown[]): void {
  if (records.some(containsApiKey)) throw new Error('API_KEY_NOT_ALLOWED');
}

export function exportHistory(records: HistoryRecord[], exportedAt = Date.now()): string {
  assertNoApiKeys(records);
  records.forEach((record, index) => {
    if (!isRecord(record)) throw new Error(`Invalid history record at index ${index}`);
  });
  const historyExport: HistoryExport = { version: 1, exportedAt, records };
  return JSON.stringify(historyExport);
}

export function parseHistoryExport(json: string): HistoryRecord[] {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    throw new Error('Invalid history export JSON');
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unsupported history export version');
  const historyExport = value as Partial<HistoryExport>;
  if (historyExport.version !== 1) throw new Error('Unsupported history export version');
  if (!Array.isArray(historyExport.records)) throw new Error('Invalid history export records');
  assertNoApiKeys(historyExport.records);
  historyExport.records.forEach((record, index) => {
    if (!isRecord(record)) throw new Error(`Invalid history record at index ${index}`);
  });
  return historyExport.records;
}
