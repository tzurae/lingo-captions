import { describe, expect, it } from 'vitest';
import { getQueryIntent, listQueryIntents } from './query-intents';

describe('query intent registry', () => {
  it('returns the six actions in order with their labels and primary flags', () => {
    expect(listQueryIntents()).toEqual([
      { id: 'translate_sentence', label: '翻譯整句', primary: true },
      { id: 'explain_selection', label: '解釋選取文字', primary: false },
      { id: 'grammar', label: '文法分析', primary: false },
      { id: 'synonyms_antonyms', label: '同義詞／反義詞', primary: false },
      { id: 'natural_rewrite', label: '更自然的英文說法', primary: false },
      { id: 'custom', label: '自訂提問', primary: false },
    ]);
  });

  it('returns a matching action by ID', () => {
    expect(getQueryIntent('translate_sentence')).toEqual({
      id: 'translate_sentence',
      label: '翻譯整句',
      primary: true,
    });
  });

  it('throws a clear error for an unknown ID', () => {
    expect(() => getQueryIntent('unknown')).toThrow('Unknown query intent: unknown');
  });
});
