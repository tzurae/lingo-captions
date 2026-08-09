import { describe, expect, it } from 'vitest';
import type { QueryRequest, QueryResult } from '../domain/types';
import type { LLMClient } from '../llm/llm-client';
import type { EventLog, WorkflowEvent } from './event-log';
import type { Validator } from './validator';
import { WorkflowRunner } from './workflow-runner';

const request: QueryRequest = {
  intent: 'translate_sentence',
  selectedText: 'Good morning',
  sentence: 'Good morning, everyone.',
  contextBefore: [],
  contextAfter: [],
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'brief',
};

class RecordingClient implements LLMClient {
  calls: QueryRequest[] = [];

  async complete(input: QueryRequest): Promise<QueryResult> {
    this.calls.push(input);
    return { answer: '早安', model: 'test-model', createdAt: 1 };
  }
}

class RecordingEventLog implements EventLog {
  events: WorkflowEvent[] = [];

  record(event: WorkflowEvent): void {
    this.events.push(event);
  }
}

describe('WorkflowRunner', () => {
  it('delegates one valid request to the client and returns its result', async () => {
    const client = new RecordingClient();
    const runner = new WorkflowRunner(client);

    await expect(runner.run(request)).resolves.toEqual({ answer: '早安', model: 'test-model', createdAt: 1 });
    expect(client.calls).toEqual([request]);
  });

  it('rejects empty selected text without calling the client', async () => {
    const client = new RecordingClient();
    const runner = new WorkflowRunner(client);

    await expect(runner.run({ ...request, selectedText: '   ' })).rejects.toThrow('Selected text cannot be empty');
    expect(client.calls).toEqual([]);
  });

  it('exposes a fixed one-step workflow boundary', () => {
    const runner = new WorkflowRunner(new RecordingClient());

    expect(runner.maxSteps).toBe(1);
  });

  it('awaits an injected validator before calling the client', async () => {
    const client = new RecordingClient();
    const seen: QueryRequest[] = [];
    const validator: Validator = {
      validate: async (input) => {
        seen.push(input);
      },
    };
    const runner = new WorkflowRunner(client, { validator });

    await runner.run(request);

    expect(seen).toEqual([request]);
    expect(client.calls).toEqual([request]);
  });

  it('records start and success events around a valid one-step run', async () => {
    const eventLog = new RecordingEventLog();
    const result = { answer: '早安', model: 'test-model', createdAt: 1 };
    const client: LLMClient = { complete: async () => result };
    const runner = new WorkflowRunner(client, { eventLog });

    await expect(runner.run(request)).resolves.toEqual(result);

    expect(eventLog.events).toEqual([
      { type: 'start', request, at: expect.any(Number) },
      { type: 'success', request, result, at: expect.any(Number) },
    ]);
  });

  it('records an error event and skips the client when validation fails', async () => {
    const eventLog = new RecordingEventLog();
    const validationError = new Error('Invalid future-harness request');
    const validator: Validator = { validate: () => { throw validationError; } };
    const client = new RecordingClient();
    const runner = new WorkflowRunner(client, { validator, eventLog });

    await expect(runner.run(request)).rejects.toBe(validationError);

    expect(client.calls).toEqual([]);
    expect(eventLog.events).toEqual([
      { type: 'start', request, at: expect.any(Number) },
      { type: 'error', request, error: validationError, at: expect.any(Number) },
    ]);
  });

  it('records an error event when the client fails', async () => {
    const eventLog = new RecordingEventLog();
    const clientError = new Error('LLM failed');
    const client: LLMClient = { complete: async () => { throw clientError; } };
    const runner = new WorkflowRunner(client, { eventLog });

    await expect(runner.run(request)).rejects.toBe(clientError);

    expect(eventLog.events).toEqual([
      { type: 'start', request, at: expect.any(Number) },
      { type: 'error', request, error: clientError, at: expect.any(Number) },
    ]);
  });
});
