import type { HistoryRecord } from '../domain/types';

export type HistoryFilter = {
  videoId?: string;
  isFavorite?: boolean;
};

export interface HistoryRepository {
  add(record: HistoryRecord): Promise<void>;
  list(filter?: HistoryFilter): Promise<HistoryRecord[]>;
  update(id: string, patch: Partial<Pick<HistoryRecord, 'isFavorite'>>): Promise<void>;
  remove(id: string): Promise<void>;
  clear(): Promise<void>;
}
