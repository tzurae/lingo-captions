import { describe, expect, it } from 'vitest';
import type { QueryRequest } from '../domain/types';
import { NoopEventLog } from './event-log';

const request: QueryRequest = {
  intent: 'translate_sentence',
  selectedText: 'Good morning',
  sentence: 'Good morning, everyone.',
  contextBefore: [],
  contextAfter: [],
  outputLanguage: 'Traditional Chinese',
  detailLevel: 'brief',
};

describe('NoopEventLog', () => {
  it('accepts workflow events without producing a side effect', () => {
    expect(new NoopEventLog().record({ type: 'start', request, at: 1 })).toBeUndefined();
  });
});
