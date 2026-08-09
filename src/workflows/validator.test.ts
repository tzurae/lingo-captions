import { describe, expect, it } from 'vitest';
import type { QueryRequest } from '../domain/types';
import { SelectedTextValidator } from './validator';

const request: QueryRequest = {
  intent: 'translate_sentence',
  selectedText: 'Good morning',
  sentence: 'Good morning, everyone.',
  contextBefore: [],
  contextAfter: [],
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'brief',
};

describe('SelectedTextValidator', () => {
  it('accepts a request with selected text', () => {
    expect(() => new SelectedTextValidator().validate(request)).not.toThrow();
  });

  it('rejects blank selected text before a workflow can call the LLM', () => {
    expect(() => new SelectedTextValidator().validate({ ...request, selectedText: '   ' }))
      .toThrow('Selected text cannot be empty');
  });

  it('rejects an unsupported runtime intent ID', () => {
    const unsupportedRequest = { ...request, intent: 'unsupported_intent' } as unknown as QueryRequest;

    expect(() => new SelectedTextValidator().validate(unsupportedRequest))
      .toThrow('Unsupported query intent: unsupported_intent');
  });

  it('rejects a custom intent with no custom question', () => {
    expect(() => new SelectedTextValidator().validate({ ...request, intent: 'custom' }))
      .toThrow('Custom question cannot be empty');
  });

  it('rejects a custom intent with a whitespace custom question', () => {
    expect(() => new SelectedTextValidator().validate({
      ...request,
      intent: 'custom',
      customQuestion: '   ',
    })).toThrow('Custom question cannot be empty');
  });

  it('accepts a custom intent with a non-blank custom question', () => {
    expect(() => new SelectedTextValidator().validate({
      ...request,
      intent: 'custom',
      customQuestion: 'Why is this phrased this way?',
    })).not.toThrow();
  });
});
