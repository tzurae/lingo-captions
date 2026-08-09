import type { QueryRequest, QueryResult, ReasoningEffort } from '../domain/types';
import type { LLMClient } from './llm-client';
import { DefaultPromptRegistry, type PromptRegistry } from './prompt-registry';

export type OpenAIClientOptions = {
  apiKey: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  fetchImpl?: typeof fetch;
  promptRegistry?: PromptRegistry;
  timeoutMs?: number;
};

export type LLMErrorCode =
  | 'API_KEY_INVALID'
  | 'CREDIT_BALANCE_EXHAUSTED'
  | 'SPEND_LIMIT_EXCEEDED'
  | 'USAGE_LIMIT_EXCEEDED'
  | 'RATE_LIMITED'
  | 'OPENAI_REQUEST_FAILED'
  | 'NETWORK_ERROR'
  | 'LLM_EMPTY_RESPONSE'
  | 'TIMEOUT';

export class LLMError extends Error {
  constructor(public readonly code: LLMErrorCode, message: string) {
    super(message);
    this.name = 'LLMError';
  }
}

const RESPONSES_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_TIMEOUT_MS = 30_000;

type ResponsesPayload = {
  model?: unknown;
  output_text?: unknown;
  output?: unknown;
};

function extractResponseText(payload: ResponsesPayload): string {
  if (typeof payload.output_text === 'string' && payload.output_text.trim() !== '') {
    return payload.output_text.trim();
  }
  if (!Array.isArray(payload.output)) return '';

  const textParts: string[] = [];
  for (const item of payload.output) {
    if (item === null || typeof item !== 'object' || !('type' in item) || item.type !== 'message' || !('content' in item) || !Array.isArray(item.content)) {
      continue;
    }
    for (const content of item.content) {
      if (content !== null
        && typeof content === 'object'
        && 'type' in content
        && content.type === 'output_text'
        && 'text' in content
        && typeof content.text === 'string'
        && content.text.trim() !== '') {
        textParts.push(content.text.trim());
      }
    }
  }
  return textParts.join('\n');
}

export class OpenAIClient implements LLMClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly fetchImpl?: typeof fetch;
  private readonly promptRegistry: PromptRegistry;
  private readonly timeoutMs: number;

  constructor(options: OpenAIClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.reasoningEffort = options.reasoningEffort;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch?.bind(globalThis);
    this.promptRegistry = options.promptRegistry ?? new DefaultPromptRegistry();
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  async complete(request: QueryRequest): Promise<QueryResult> {
    if (this.fetchImpl === undefined) {
      throw new LLMError('NETWORK_ERROR', 'No fetch implementation is configured.');
    }

    let response: Response | undefined;
    const controller = new AbortController();
    let didTimeout = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeoutError = new LLMError('TIMEOUT', 'The OpenAI request timed out.');
    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        didTimeout = true;
        controller.abort();
        reject(timeoutError);
      }, this.timeoutMs);
    });

    try {
      response = await Promise.race([
        this.fetchImpl(RESPONSES_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: this.model,
            reasoning: { effort: this.reasoningEffort },
            store: false,
            instructions: this.promptRegistry.buildInstructions(request),
            input: this.promptRegistry.buildInput(request),
          }),
          signal: controller.signal,
        }),
        timeoutPromise,
      ]);

      if (!response.ok) {
        let apiErrorCode: string | undefined;
        try {
          const errorPayload = await Promise.race([
            response.json() as Promise<{ error?: { code?: unknown; type?: unknown } }>,
            timeoutPromise,
          ]);
          if (typeof errorPayload.error?.code === 'string') {
            apiErrorCode = errorPayload.error.code;
          } else if (typeof errorPayload.error?.type === 'string') {
            apiErrorCode = errorPayload.error.type;
          }
        } catch (error: unknown) {
          if (error === timeoutError || didTimeout) throw timeoutError;
        }
        throw this.mapHttpError(response.status, apiErrorCode);
      }

      let payload: ResponsesPayload;
      try {
        payload = await Promise.race([
          response.json() as Promise<ResponsesPayload>,
          timeoutPromise,
        ]);
      } catch (error: unknown) {
        if (error === timeoutError || didTimeout) {
          throw timeoutError;
        }
        throw new LLMError('LLM_EMPTY_RESPONSE', 'The OpenAI response did not contain readable output.');
      }

      const answer = extractResponseText(payload);
      if (answer === '') {
        throw new LLMError('LLM_EMPTY_RESPONSE', 'The OpenAI response did not contain an answer.');
      }

      return {
        answer,
        model: typeof payload.model === 'string' && payload.model.trim() !== ''
          ? payload.model.trim()
          : this.model,
        requestedModel: this.model,
        reasoningEffort: this.reasoningEffort,
        createdAt: Date.now(),
      };
    } catch (error: unknown) {
      if (error === timeoutError || didTimeout) {
        throw timeoutError;
      }
      if (response === undefined) {
        throw new LLMError('NETWORK_ERROR', 'The OpenAI request could not reach the service.');
      }
      throw error instanceof LLMError
        ? error
        : new LLMError('LLM_EMPTY_RESPONSE', 'The OpenAI response did not contain readable output.');
    } finally {
      if (timeoutId !== undefined) {
        clearTimeout(timeoutId);
      }
    }
  }

  private mapHttpError(status: number, apiErrorCode?: string): LLMError {
    if (status === 401) {
      return new LLMError('API_KEY_INVALID', 'The OpenAI API key was rejected.');
    }
    if (status === 429) {
      if (apiErrorCode === 'credit_balance_exhausted' || apiErrorCode === 'insufficient_quota') {
        return new LLMError('CREDIT_BALANCE_EXHAUSTED', 'The OpenAI API credit balance is exhausted.');
      }
      if (apiErrorCode === 'organization_spend_limit_exceeded' || apiErrorCode === 'project_spend_limit_exceeded') {
        return new LLMError('SPEND_LIMIT_EXCEEDED', 'The OpenAI API spend limit has been reached.');
      }
      if (apiErrorCode === 'organization_usage_limit_exceeded') {
        return new LLMError('USAGE_LIMIT_EXCEEDED', 'The OpenAI API usage limit has been reached.');
      }
      return new LLMError('RATE_LIMITED', 'The OpenAI request was rate limited.');
    }
    return new LLMError('OPENAI_REQUEST_FAILED', `The OpenAI request failed with status ${status}.`);
  }
}
