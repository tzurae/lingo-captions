import { describe, expect, it } from 'vitest';
import type { QueryIntentId } from '../domain/types';
import { ConfiguredPromptRegistry } from './prompt-registry';
import { defaultPromptTemplates } from './prompt-templates';

const intentIds: QueryIntentId[] = [
  'translate_sentence',
  'explain_selection',
  'grammar',
  'synonyms_antonyms',
  'natural_rewrite',
  'custom',
];

describe('ConfiguredPromptRegistry', () => {
  it('provides distinct non-empty guidance for every supported query intent', () => {
    const registry = new ConfiguredPromptRegistry(defaultPromptTemplates);
    const guidance = intentIds.map((intent) => registry.buildInstructions({
      intent,
      selectedText: 'target',
      sentence: 'A target sentence.',
      contextBefore: [],
      contextAfter: [],
      outputLanguage: '繁體中文',
      detailLevel: 'normal',
    }));

    expect(guidance.every((value) => value.trim() !== '')).toBe(true);
    expect(new Set(guidance).size).toBe(intentIds.length);
  });
});
