import type { QueryRequest } from '../domain/types';

const supportedIntentIds = new Set([
  'translate_sentence',
  'explain_selection',
  'grammar',
  'synonyms_antonyms',
  'natural_rewrite',
  'custom',
]);

export interface Validator {
  validate(request: QueryRequest): void | Promise<void>;
}

export class SelectedTextValidator implements Validator {
  validate(request: QueryRequest): void {
    if (request.selectedText.trim() === '') {
      throw new Error('Selected text cannot be empty');
    }

    if (!supportedIntentIds.has(request.intent)) {
      throw new Error(`Unsupported query intent: ${request.intent}`);
    }

    if (request.intent === 'custom' && !request.customQuestion?.trim()) {
      throw new Error('Custom question cannot be empty');
    }
  }
}
