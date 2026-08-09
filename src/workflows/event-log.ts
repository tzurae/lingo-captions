import type { QueryRequest, QueryResult } from '../domain/types';

export type WorkflowEvent =
  | { type: 'start'; request: QueryRequest; at: number }
  | { type: 'success'; request: QueryRequest; result: QueryResult; at: number }
  | { type: 'error'; request: QueryRequest; error: unknown; at: number };

export interface EventLog {
  record(event: WorkflowEvent): void | Promise<void>;
}

export class NoopEventLog implements EventLog {
  record(_event: WorkflowEvent): void {}
}
