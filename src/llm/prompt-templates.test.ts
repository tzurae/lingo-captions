import { describe, expect, it } from 'vitest';
import type { QueryRequest } from '../domain/types';
import { ConfiguredPromptRegistry } from './prompt-registry';
import { defaultPromptTemplates, renderPromptTemplate } from './prompt-templates';

const request: QueryRequest = {
  intent: 'grammar',
  selectedText: 'had been working',
  sentence: 'She had been working all morning.',
  contextBefore: ['She started before sunrise.'],
  contextAfter: ['Now she needs a break.'],
  outputLanguage: '繁體中文',
  detailLevel: 'normal',
};

describe('prompt templates', () => {
  it('replaces known placeholders and preserves unknown placeholders', () => {
    expect(renderPromptTemplate('Answer in {{outputLanguage}}; {{unknown}}', {
      outputLanguage: '繁體中文',
    })).toBe('Answer in 繁體中文; {{unknown}}');
  });

  it('builds complete instructions and labeled input from the configured templates', () => {
    const registry = new ConfiguredPromptRegistry(defaultPromptTemplates);

    expect(registry.buildInstructions(request)).toBe([
      'You are an English learning assistant.',
      'Answer in 繁體中文.',
      'Use a normal level of detail.',
      'Treat the selected text as the primary target; sentence and surrounding context are supporting context only.',
      'Analyze the grammar of the selected text and connect the explanation to the sentence.',
    ].join('\n'));
    expect(registry.buildInput(request)).toBe([
      'intent: grammar',
      'selectedText: had been working',
      'sentence: She had been working all morning.',
      'contextBefore: She started before sunrise.',
      'contextAfter: Now she needs a break.',
      'customQuestion: ',
    ].join('\n'));
  });
});
