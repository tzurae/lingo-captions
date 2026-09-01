import type { HistoryRecord, Settings } from '../../src/domain/types';

export const v021SeededSettings = {
  apiKey: 'sk-v021-upgrade-secret-9876',
  model: 'gpt-5.6-terra',
  reasoningEffort: 'high',
  outputLanguage: '日本語',
  detailLevel: 'detailed',
  contextLines: 3,
  fontSize: 22,
  textColor: '#102030',
  activeCueColor: '#d0e0f0',
  autoFollowPlayback: false,
  prompts: {
    basePrompt: 'Legacy base prompt',
    inputPrompt: 'Legacy input prompt',
    intentPrompts: {
      translate_sentence: 'Legacy translation prompt',
      explain_selection: 'Legacy explanation prompt',
      grammar: 'Legacy grammar prompt',
      synonyms_antonyms: 'Legacy vocabulary prompt',
      natural_rewrite: 'Legacy rewrite prompt',
      custom: 'Legacy custom prompt',
    },
  },
} satisfies Settings;

export const v021SeededHistory = {
  id: 'v021-history-favorite',
  createdAt: 1_754_000_000_000,
  videoId: 'legacy-video',
  videoTitle: 'Legacy caption lesson',
  videoUrl: 'https://www.youtube.com/watch?v=legacy-video',
  request: {
    intent: 'explain_selection',
    selectedText: 'kept across upgrade',
    sentence: 'This Study Sentence is kept across upgrade.',
    contextBefore: ['Legacy context before.'],
    contextAfter: ['Legacy context after.'],
    outputLanguage: '日本語',
    detailLevel: 'detailed',
  },
  result: {
    answer: 'Legacy saved answer',
    model: 'gpt-5.6-terra',
    requestedModel: 'gpt-5.6-terra',
    reasoningEffort: 'high',
    createdAt: 1_754_000_000_100,
  },
  isFavorite: true,
  subtitlePosition: { startMs: 12_500, endMs: 14_000 },
} satisfies HistoryRecord;
