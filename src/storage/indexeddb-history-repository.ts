import type { HistoryRecord } from '../domain/types';
import type { HistoryFilter, HistoryRepository } from './history-repository';

const databaseName = 'youtube-english-learning';
const databaseVersion = 1;
const storeName = 'history';

export class IndexedDbHistoryRepository implements HistoryRepository {
  async add(record: HistoryRecord): Promise<void> {
    const database = await this.openDatabase();
    await this.runWrite(database, (store) => store.add(record));
  }

  async list(filter: HistoryFilter = {}): Promise<HistoryRecord[]> {
    const database = await this.openDatabase();
    try {
      const records = await new Promise<HistoryRecord[]>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readonly');
        const request = transaction.objectStore(storeName).getAll();
        request.onsuccess = () => resolve(request.result as HistoryRecord[]);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      });

      return records
        .filter((record) => filter.videoId === undefined || record.videoId === filter.videoId)
        .filter((record) => filter.isFavorite === undefined || record.isFavorite === filter.isFavorite)
        .sort((left, right) => right.createdAt - left.createdAt);
    } finally {
      database.close();
    }
  }

  async update(id: string, patch: Partial<Pick<HistoryRecord, 'isFavorite'>>): Promise<void> {
    const database = await this.openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        const store = transaction.objectStore(storeName);
        const getRequest = store.get(id);

        getRequest.onerror = () => reject(getRequest.error);
        getRequest.onsuccess = () => {
          const record = getRequest.result as HistoryRecord | undefined;
          if (!record) {
            transaction.abort();
            reject(new Error(`History record not found: ${id}`));
            return;
          }
          store.put({ ...record, ...patch });
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error ?? new Error(`History record not found: ${id}`));
      });
    } finally {
      database.close();
    }
  }

  async remove(id: string): Promise<void> {
    const database = await this.openDatabase();
    await this.runWrite(database, (store) => store.delete(id));
  }

  async clear(): Promise<void> {
    const database = await this.openDatabase();
    await this.runWrite(database, (store) => store.clear());
  }

  private openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);
      request.onupgradeneeded = () => {
        const database = request.result;
        const store = database.createObjectStore(storeName, { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('videoId', 'videoId');
        store.createIndex('isFavorite', 'isFavorite');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async runWrite(
    database: IDBDatabase,
    operation: (store: IDBObjectStore) => IDBRequest,
  ): Promise<void> {
    try {
      await new Promise<void>((resolve, reject) => {
        const transaction = database.transaction(storeName, 'readwrite');
        operation(transaction.objectStore(storeName));
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    } finally {
      database.close();
    }
  }
}
