import type { QueryRequest, QueryResult } from '../domain/types';

export interface LLMClient {
  complete(request: QueryRequest): Promise<QueryResult>;
}
