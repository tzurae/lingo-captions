import type { QueryRequest, QueryResult } from '../domain/types';
import type { LLMClient } from '../llm/llm-client';
import { NoopEventLog, type EventLog } from './event-log';
import { SelectedTextValidator, type Validator } from './validator';

export type WorkflowRunnerOptions = {
  validator?: Validator;
  eventLog?: EventLog;
};

export class WorkflowRunner {
  readonly maxSteps = 1;
  private readonly validator: Validator;
  private readonly eventLog: EventLog;

  constructor(private readonly client: LLMClient, options: WorkflowRunnerOptions = {}) {
    this.validator = options.validator ?? new SelectedTextValidator();
    this.eventLog = options.eventLog ?? new NoopEventLog();
  }

  async run(request: QueryRequest): Promise<QueryResult> {
    await this.eventLog.record({ type: 'start', request, at: Date.now() });

    try {
      await this.validator.validate(request);
      const result = await this.client.complete(request);
      await this.eventLog.record({ type: 'success', request, result, at: Date.now() });
      return result;
    } catch (error: unknown) {
      await this.eventLog.record({ type: 'error', request, error, at: Date.now() });
      throw error;
    }
  }
}
