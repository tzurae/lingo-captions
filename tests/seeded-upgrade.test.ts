import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageRouter } from '../src/background/message-router';
import { initializeTrustedStorageAccess } from '../src/background/storage-access';
import type { HistoryRecord } from '../src/domain/types';
import type { HistoryFilter, HistoryRepository } from '../src/storage/history-repository';
import { IndexedDbHistoryRepository } from '../src/storage/indexeddb-history-repository';
import {
  ChromeStorageSettingsStore,
  type StorageAreaLike,
} from '../src/storage/settings-store';
import {
  v021SeededHistory,
  v021SeededSettings,
} from './fixtures/v0.2.1-seeded-state';

const databaseName = 'youtube-english-learning';
const historyStoreName = 'history';

class SeededStorageArea implements StorageAreaLike {
  private readonly values: Record<string, unknown>;

  constructor(seed: Record<string, unknown>) {
    this.values = structuredClone(seed);
  }

  async get(): Promise<Record<string, unknown>> {
    return structuredClone(this.values);
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, structuredClone(items));
  }

  async remove(keys: string | string[]): Promise<void> {
    const removedKeys = Array.isArray(keys) ? keys : [keys];
    removedKeys.forEach((key) => delete this.values[key]);
  }
}

function deleteDatabase(): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(databaseName);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Seeded upgrade database deletion was blocked'));
  });
}

function seedV021History(record: HistoryRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(historyStoreName, { keyPath: 'id' });
      store.createIndex('createdAt', 'createdAt');
      store.createIndex('videoId', 'videoId');
      store.createIndex('isFavorite', 'isFavorite');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const database = request.result;
      const transaction = database.transaction(historyStoreName, 'readwrite');
      transaction.objectStore(historyStoreName).add(structuredClone(record));
      transaction.oncomplete = () => {
        database.close();
        resolve();
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
      transaction.onabort = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

function unusedHistoryRepository(): HistoryRepository {
  return {
    add: async () => undefined,
    list: async (_filter?: HistoryFilter) => [],
    update: async () => undefined,
    remove: async () => undefined,
    clear: async () => undefined,
  };
}

describe('v0.2.1 seeded upgrade rehearsal', () => {
  beforeEach(deleteDatabase);
  afterEach(deleteDatabase);

  it('preserves API key, settings, and auto-follow inside trusted storage', async () => {
    const storageArea = new SeededStorageArea(v021SeededSettings);
    const settingsStore = new ChromeStorageSettingsStore(storageArea);
    const accessLevels: string[] = [];

    await initializeTrustedStorageAccess({
      setAccessLevel: async ({ accessLevel }) => { accessLevels.push(accessLevel); },
    });

    await expect(settingsStore.get()).resolves.toEqual(v021SeededSettings);
    expect(accessLevels).toEqual(['TRUSTED_CONTEXTS']);

    const router = new MessageRouter({
      settingsStore,
      historyRepository: unusedHistoryRepository(),
      workflowFactory: () => { throw new Error('GET_SETTINGS must not create a workflow'); },
    });
    const response = await router.handle({ type: 'GET_SETTINGS' });

    expect(response).toEqual(expect.objectContaining({
      ok: true,
      data: expect.objectContaining({
        autoFollowPlayback: false,
        fontSize: 22,
        hasApiKey: true,
        apiKeyLastFour: '9876',
      }),
    }));
    expect(JSON.stringify(response)).not.toContain(v021SeededSettings.apiKey);
  });

  it('preserves history, favorite state, and Replay Range from the v0.2.1 object store', async () => {
    await seedV021History(v021SeededHistory);
    const repository = new IndexedDbHistoryRepository();

    await expect(repository.list()).resolves.toEqual([v021SeededHistory]);
    await expect(repository.list({ isFavorite: true })).resolves.toEqual([v021SeededHistory]);
    await expect(repository.list({ videoId: 'legacy-video' })).resolves.toEqual([v021SeededHistory]);
  });
});
