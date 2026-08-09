import type { QueryIntent, QueryIntentId } from './types';

const QUERY_INTENTS: QueryIntent[] = [
  { id: 'translate_sentence', label: '翻譯整句', primary: true },
  { id: 'explain_selection', label: '解釋選取文字', primary: false },
  { id: 'grammar', label: '文法分析', primary: false },
  { id: 'synonyms_antonyms', label: '同義詞／反義詞', primary: false },
  { id: 'natural_rewrite', label: '更自然的英文說法', primary: false },
  { id: 'custom', label: '自訂提問', primary: false },
];

export function listQueryIntents(): QueryIntent[] {
  return QUERY_INTENTS;
}

export function getQueryIntent(id: string): QueryIntent {
  const intent = QUERY_INTENTS.find((item) => item.id === id);
  if (!intent) {
    throw new Error(`Unknown query intent: ${id}`);
  }
  return intent;
}
