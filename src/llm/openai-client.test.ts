import { describe, expect, it, vi } from 'vitest';
import type { QueryRequest } from '../domain/types';
import { LLMError, OpenAIClient } from './openai-client';

const request: QueryRequest = {
  intent: 'grammar',
  selectedText: 'had been working',
  sentence: 'She had been working all morning.',
  contextBefore: ['She started before sunrise.'],
  contextAfter: ['Now she needs a break.'],
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'normal',
  customQuestion: 'Why is this tense used?',
};

function json<T>(body: T, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('OpenAIClient', () => {
  it('keeps the requested model and reports the model returned by OpenAI', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      model: 'gpt-5.6-luna-2026-07-01',
      output_text: 'A response from the reported model.',
    }));
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.complete(request)).resolves.toMatchObject({
      model: 'gpt-5.6-luna-2026-07-01',
      requestedModel: 'gpt-5.6-luna',
      reasoningEffort: 'low',
    });
  });

  it('sends a labeled Responses API request and parses output_text', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ output_text: 'It is the past perfect continuous.' }));
    const fetchImpl = fetchMock as unknown as typeof fetch;
    const now = vi.spyOn(Date, 'now').mockReturnValue(123456789);
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      fetchImpl,
    });

    const result = await client.complete(request);

    expect(result).toEqual({
      answer: 'It is the past perfect continuous.',
      model: 'gpt-5.6-luna',
      requestedModel: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      createdAt: 123456789,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.openai.com/v1/responses',
      expect.objectContaining({
        method: 'POST',
        headers: {
          Authorization: 'Bearer test-key',
          'Content-Type': 'application/json',
        },
      }),
    );

    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent).toMatchObject({
      model: 'gpt-5.6-luna',
      reasoning: { effort: 'low' },
      store: false,
    });
    expect(sent.instructions).toContain('English learning assistant');
    expect(sent.instructions).toContain('Traditional Chinese');
    expect(sent.instructions).toContain('normal');
    expect(sent.instructions).toContain('selected text as the primary target');
    expect(sent.input).toContain('intent: grammar');
    expect(sent.input).toContain('selectedText: had been working');
    expect(sent.input).toContain('sentence: She had been working all morning.');
    expect(sent.input).toContain('contextBefore: She started before sunrise.');
    expect(sent.input).toContain('contextAfter: Now she needs a break.');
    expect(sent.input).toContain('customQuestion: Why is this tense used?');

    now.mockRestore();
  });

  it('extracts text from a raw Responses API output array after non-message items', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({
      id: 'resp_test',
      object: 'response',
      status: 'completed',
      output: [
        {
          id: 'rs_test',
          type: 'reasoning',
          summary: [],
        },
        {
          id: 'msg_test',
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [
            {
              type: 'output_text',
              text: 'The raw API answer.',
              annotations: [],
              logprobs: [],
            },
          ],
        },
      ],
    }));
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: fetchMock as unknown as typeof fetch,
    });

    await expect(client.complete(request)).resolves.toMatchObject({ answer: 'The raw API answer.' });
  });

  it('delegates complete instructions and input construction to the injected prompt registry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ output_text: 'Injected guidance response.' }));
    const promptRegistry = {
      buildInstructions: vi.fn().mockReturnValue('Configured instructions.'),
      buildInput: vi.fn().mockReturnValue('Configured input.'),
    };
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: fetchMock as unknown as typeof fetch,
      promptRegistry,
    });

    await client.complete(request);

    expect(promptRegistry.buildInstructions).toHaveBeenCalledWith(request);
    expect(promptRegistry.buildInput).toHaveBeenCalledWith(request);
    const sent = JSON.parse(fetchMock.mock.calls[0][1]?.body as string);
    expect(sent).toEqual({
      model: 'gpt-test',
      reasoning: { effort: 'low' },
      store: false,
      instructions: 'Configured instructions.',
      input: 'Configured input.',
    });
  });

  it('aborts a timed-out request and maps it to TIMEOUT', async () => {
    vi.useFakeTimers();
    try {
      const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
      }));
      const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      timeoutMs: 50,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = client.complete(request);
      const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(50);

      await assertion;
      expect(fetchMock.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('keeps the timeout active while parsing a pending response body', async () => {
    vi.useFakeTimers();
    try {
      let requestSignal: AbortSignal | undefined;
      let jsonStarted = false;
      const response = new Response(null, { status: 200 });
      response.json = () => {
        jsonStarted = true;
        return new Promise<never>(() => {});
      };
      const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
        requestSignal = init?.signal as AbortSignal;
        return Promise.resolve(response);
      });
      const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      timeoutMs: 50,
        fetchImpl: fetchMock as unknown as typeof fetch,
      });

      const result = client.complete(request);
      await Promise.resolve();
      await Promise.resolve();
      expect(jsonStarted).toBe(true);

      const assertion = expect(result).rejects.toMatchObject({ code: 'TIMEOUT' });
      await vi.advanceTimersByTimeAsync(50);

      await assertion;
      expect(requestSignal?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('uses a stubbed global fetch when constructed without fetchImpl', async () => {
    const fetchMock = vi.fn().mockResolvedValue(json({ output_text: 'Global fetch response.' }));
    vi.stubGlobal('fetch', fetchMock);

    try {
      const client = new OpenAIClient({ apiKey: 'test-key', model: 'gpt-test', reasoningEffort: 'low' });

      await expect(client.complete(request)).resolves.toEqual({
        answer: 'Global fetch response.',
        model: 'gpt-test',
        requestedModel: 'gpt-test',
        reasoningEffort: 'low',
        createdAt: expect.any(Number),
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'https://api.openai.com/v1/responses',
        expect.objectContaining({ method: 'POST' }),
      );
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('maps a 401 response to API_KEY_INVALID', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({}, 401)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'API_KEY_INVALID' });
  });

  it('maps a 429 response to RATE_LIMITED', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({}, 429)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('distinguishes exhausted API credits from a request rate limit', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({
        error: {
          message: 'You have no credits remaining.',
          type: 'usage_limit_error',
          code: 'credit_balance_exhausted',
          param: null,
        },
      }, 429)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'CREDIT_BALANCE_EXHAUSTED' });
  });

  it.each([
    ['insufficient_quota', 'CREDIT_BALANCE_EXHAUSTED'],
    ['organization_spend_limit_exceeded', 'SPEND_LIMIT_EXCEEDED'],
    ['project_spend_limit_exceeded', 'SPEND_LIMIT_EXCEEDED'],
    ['organization_usage_limit_exceeded', 'USAGE_LIMIT_EXCEEDED'],
  ] as const)('maps OpenAI 429 code %s to %s', async (apiCode, expectedCode) => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({
        error: { message: 'Account limit reached.', type: 'usage_limit_error', code: apiCode, param: null },
      }, 429)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: expectedCode });
  });

  it('uses the OpenAI error type when a 429 response has no error code', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({
        error: { message: 'Quota exceeded.', type: 'insufficient_quota', code: null, param: null },
      }, 429)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'CREDIT_BALANCE_EXHAUSTED' });
  });

  it('maps other non-success responses to OPENAI_REQUEST_FAILED without exposing the API key', async () => {
    const apiKey = 'super-secret-api-key';
    const client = new OpenAIClient({
      apiKey,
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue(json({ error: apiKey }, 500)) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'OPENAI_REQUEST_FAILED' });
    await client.complete(request).catch((error: unknown) => {
      expect(error).toBeInstanceOf(LLMError);
      expect((error as Error).message).not.toContain(apiKey);
    });
  });

  it('maps a rejected fetch to NETWORK_ERROR', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockRejectedValue(new Error('offline')) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });

  it('rejects invalid JSON as LLM_EMPTY_RESPONSE', async () => {
    const client = new OpenAIClient({
      apiKey: 'test-key',
      model: 'gpt-test',
      reasoningEffort: 'low',
      fetchImpl: vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad JSON'); } } as unknown as Response) as unknown as typeof fetch,
    });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'LLM_EMPTY_RESPONSE' });
  });

  it('rejects a successful response with missing or blank output_text as LLM_EMPTY_RESPONSE', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({}))
      .mockResolvedValueOnce(json({ output_text: '   ' })) as unknown as typeof fetch;
    const client = new OpenAIClient({ apiKey: 'test-key', model: 'gpt-test', reasoningEffort: 'low', fetchImpl });

    await expect(client.complete(request)).rejects.toMatchObject({ code: 'LLM_EMPTY_RESPONSE' });
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'LLM_EMPTY_RESPONSE' });
  });
});
