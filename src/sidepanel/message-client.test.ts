import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HistoryRecord, QueryRequest } from '../domain/types';
import { MessageClientError, runQuery, saveHistory } from './message-client';

const record: HistoryRecord = {
  id: 'history-1', createdAt: 1, videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test',
  request: { intent: 'translate_sentence', selectedText: 'phrase', sentence: 'A phrase.', contextBefore: [], contextAfter: [], outputLanguage: '繁體中文', detailLevel: 'normal' },
  result: { answer: 'Answer', model: 'gpt-5.2', createdAt: 1 }, isFavorite: false,
};

describe('saveHistory', () => {
  const sendMessage = vi.fn();

  beforeEach(() => {
    sendMessage.mockResolvedValue({ ok: true, data: undefined });
    Object.assign(globalThis, { chrome: { runtime: { sendMessage } } });
  });

  it('sends a typed SAVE_HISTORY request', async () => {
    await expect(saveHistory(record)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledWith({ type: 'SAVE_HISTORY', record });
  });

  it('returns the result with its auto-saved history record', async () => {
    const request: QueryRequest = record.request;
    const response = { result: record.result, history: record, historySaved: true };
    sendMessage.mockResolvedValueOnce({ ok: true, data: response });

    await expect(runQuery(request, { id: record.videoId, title: record.videoTitle, url: record.videoUrl })).resolves.toEqual(response);

    expect(sendMessage).toHaveBeenCalledWith({ type: 'RUN_QUERY', request, video: { id: record.videoId, title: record.videoTitle, url: record.videoUrl } });
  });

  it('exposes an error code without exposing any unsafe error details', async () => {
    sendMessage.mockResolvedValueOnce({ ok: false, error: { code: 'RATE_LIMITED', message: 'Please try again later.' } });

    const error = await runQuery(record.request, { id: record.videoId, title: record.videoTitle, url: record.videoUrl }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(MessageClientError);
    expect(error).toMatchObject({ code: 'RATE_LIMITED', message: 'Please try again later.' });
  });
});
