import { describe, expect, it } from 'vitest';
import { exportHistory, parseHistoryExport } from './history-transfer';
import type { HistoryRecord } from '../domain/types';

const record: HistoryRecord = {
  id: 'history-1',
  createdAt: 1_700_000_000_000,
  videoId: 'video-1',
  videoTitle: 'English lesson',
  videoUrl: 'https://www.youtube.com/watch?v=video-1',
  request: {
    intent: 'translate_sentence',
    selectedText: 'look up',
    sentence: 'Please look up the word.',
    contextBefore: ['Please'],
    contextAfter: ['the word.'],
    outputLanguage: 'Chinese',
    detailLevel: 'normal',
  },
  result: { answer: '查詢', model: 'gpt-5.2', createdAt: 1_700_000_000_001 },
  isFavorite: true,
};

const positionedRecord = {
  ...record,
  subtitlePosition: { startMs: 12_500, endMs: 14_000 },
} as HistoryRecord;

describe('history transfer', () => {
  it('exports a versioned envelope without changing complete history records', () => {
    expect(exportHistory([record], 1_700_000_000_100)).toBe(JSON.stringify({
      version: 1,
      exportedAt: 1_700_000_000_100,
      records: [record],
    }));
  });

  it('uses the current time when no export time is supplied', () => {
    const exported = JSON.parse(exportHistory([record])) as { exportedAt: number };
    expect(exported.exportedAt).toEqual(expect.any(Number));
  });

  it('rejects apiKey properties anywhere in an export record', () => {
    const unsafeRecord = { ...record, request: { ...record.request, apiKey: 'secret' } } as HistoryRecord;
    expect(() => exportHistory([unsafeRecord], 1)).toThrow('API_KEY_NOT_ALLOWED');
  });

  it('parses a valid exported record without dropping transfer fields', () => {
    const json = JSON.stringify({ version: 1, exportedAt: 1, records: [record] });
    expect(parseHistoryExport(json)).toEqual([record]);
  });

  it('accepts a legacy record without a reasoning effort', () => {
    const json = JSON.stringify({ version: 1, exportedAt: 1, records: [record] });

    expect(parseHistoryExport(json)).toEqual([record]);
  });

  it('accepts a record with a supported reasoning effort', () => {
    const supportedRecord = { ...record, result: { ...record.result, reasoningEffort: 'xhigh' as const } };
    const json = JSON.stringify({ version: 1, exportedAt: 1, records: [supportedRecord] });

    expect(parseHistoryExport(json)).toEqual([supportedRecord]);
  });

  it('rejects a record with an unsupported reasoning effort', () => {
    const unsupportedRecord = { ...record, result: { ...record.result, reasoningEffort: 'unsupported' } };

    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [unsupportedRecord] }))).toThrow('Invalid history record at index 0');
  });

  it('accepts and preserves a valid subtitle position', () => {
    const json = JSON.stringify({ version: 1, exportedAt: 1, records: [positionedRecord] });

    expect(parseHistoryExport(json)).toEqual([positionedRecord]);
  });

  it.each([
    { startMs: -1, endMs: 1 },
    { startMs: 2_000, endMs: 1_000 },
    { startMs: '1000', endMs: 2_000 },
    { startMs: 1_000 },
  ])('rejects a malformed subtitle position %#', (subtitlePosition) => {
    const malformedRecord = { ...record, subtitlePosition };

    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [malformedRecord] }))).toThrow('Invalid history record at index 0');
  });

  it.each([
    ['not JSON', 'Invalid history export JSON'],
    [JSON.stringify({ version: 2, exportedAt: 1, records: [] }), 'Unsupported history export version'],
    [JSON.stringify({ exportedAt: 1, records: [] }), 'Unsupported history export version'],
    [JSON.stringify({ version: 1, exportedAt: 1 }), 'Invalid history export records'],
    [JSON.stringify({ version: 1, exportedAt: 1, records: {} }), 'Invalid history export records'],
  ])('rejects %s', (json, message) => {
    expect(() => parseHistoryExport(json)).toThrow(message);
  });

  it('rejects an incomplete record with its index', () => {
    const { videoUrl: _videoUrl, ...incompleteRecord } = record;
    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [incompleteRecord] }))).toThrow('Invalid history record at index 0');
  });

  it('rejects a record with an incomplete query request', () => {
    const incompleteRequest = { ...record, request: { selectedText: record.request.selectedText } };
    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [incompleteRequest] }))).toThrow('Invalid history record at index 0');
  });

  it('rejects a record with an unknown query intent', () => {
    const invalidIntentRecord = { ...record, request: { ...record.request, intent: 'unknown-intent' } };

    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [invalidIntentRecord] }))).toThrow('Invalid history record at index 0');
  });

  it('rejects apiKey properties anywhere in an imported record', () => {
    const unsafeRecord = { ...record, result: { ...record.result, apiKey: 'secret' } };
    expect(() => parseHistoryExport(JSON.stringify({ version: 1, exportedAt: 1, records: [unsafeRecord] }))).toThrow('API_KEY_NOT_ALLOWED');
  });
});
