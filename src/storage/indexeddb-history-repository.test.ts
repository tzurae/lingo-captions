import { beforeEach, describe, expect, it } from 'vitest';
import type { HistoryRecord } from '../domain/types';
import { IndexedDbHistoryRepository } from './indexeddb-history-repository';

const databaseName = 'youtube-english-learning';

function record(overrides: Partial<HistoryRecord> = {}): HistoryRecord {
  return {
    id: 'record-1',
    createdAt: 1_000,
    videoId: 'video-a',
    videoTitle: 'Video A',
    videoUrl: 'https://www.youtube.com/watch?v=video-a',
    request: {
      intent: 'translate_sentence',
      selectedText: 'hello',
      sentence: 'hello world',
      contextBefore: [],
      contextAfter: [],
      outputLanguage: 'Chinese',
      detailLevel: 'normal',
    },
    result: { answer: '你好', model: 'gpt-5.2', createdAt: 1_001 },
    isFavorite: false,
    ...overrides,
  };
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Database deletion was blocked'));
  });
}

function removeHistoryStore(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 2);
    request.onupgradeneeded = () => {
      request.result.deleteObjectStore('history');
    };
    request.onsuccess = () => {
      request.result.close();
      resolve();
    };
    request.onerror = () => reject(request.error);
  });
}

describe('IndexedDbHistoryRepository', () => {
  beforeEach(async () => {
    await deleteDatabase();
  });

  it('adds a record and lists its complete persisted value', async () => {
    const repository = new IndexedDbHistoryRepository();
    const saved = record();

    await repository.add(saved);

    await expect(repository.list()).resolves.toEqual([saved]);
  });

  it('lists records newest first', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record({ id: 'old', createdAt: 100 }));
    await repository.add(record({ id: 'new', createdAt: 200 }));

    const records = await repository.list();

    expect(records.map(({ id }) => id)).toEqual(['new', 'old']);
  });

  it('combines video and favorite filters', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record({ id: 'favorite-for-video', videoId: 'video-a', isFavorite: true }));
    await repository.add(record({ id: 'unfavorite-for-video', videoId: 'video-a', isFavorite: false }));
    await repository.add(record({ id: 'favorite-for-other-video', videoId: 'video-b', isFavorite: true }));

    const records = await repository.list({ videoId: 'video-a', isFavorite: true });

    expect(records.map(({ id }) => id)).toEqual(['favorite-for-video']);
  });

  it('closes its database after a list transaction cannot start', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record());
    await removeHistoryStore();

    await expect(repository.list()).rejects.toThrow();

    await expect(deleteDatabase()).resolves.toBeUndefined();
  });

  it('rejects a duplicate record ID without overwriting the original', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record({ videoTitle: 'Original' }));

    await expect(repository.add(record({ videoTitle: 'Replacement' }))).rejects.toBeDefined();
    await expect(repository.list()).resolves.toMatchObject([{ videoTitle: 'Original' }]);
  });

  it('updates a record favorite state', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record());

    await repository.update('record-1', { isFavorite: true });

    await expect(repository.list()).resolves.toMatchObject([{ id: 'record-1', isFavorite: true }]);
  });

  it('rejects updates for an unknown ID', async () => {
    const repository = new IndexedDbHistoryRepository();

    await expect(repository.update('missing', { isFavorite: true })).rejects.toThrow(
      'History record not found: missing',
    );
  });

  it('removes one record and ignores unknown IDs', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record({ id: 'keep' }));
    await repository.add(record({ id: 'remove' }));

    await repository.remove('remove');
    await repository.remove('missing');

    await expect(repository.list()).resolves.toMatchObject([{ id: 'keep' }]);
  });

  it('clears every record', async () => {
    const repository = new IndexedDbHistoryRepository();
    await repository.add(record({ id: 'first' }));
    await repository.add(record({ id: 'second' }));

    await repository.clear();

    await expect(repository.list()).resolves.toEqual([]);
  });
});
