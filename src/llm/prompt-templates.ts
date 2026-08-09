import type { PromptTemplates } from '../domain/types';

export const defaultPromptTemplates: PromptTemplates = {
  basePrompt: [
    'You are an English learning assistant.',
    'Answer in {{outputLanguage}}.',
    'Use a {{detailLevel}} level of detail.',
    'Treat the selected text as the primary target; sentence and surrounding context are supporting context only.',
    '{{intentPrompt}}',
  ].join('\n'),
  inputPrompt: [
    'intent: {{intent}}',
    'selectedText: {{selectedText}}',
    'sentence: {{sentence}}',
    'contextBefore: {{contextBefore}}',
    'contextAfter: {{contextAfter}}',
    'customQuestion: {{customQuestion}}',
  ].join('\n'),
  intentPrompts: {
    translate_sentence: 'Translate the sentence naturally and explain the selected text in the requested output language.',
    explain_selection: 'Explain the meaning and usage of the selected text, using the sentence as supporting context.',
    grammar: 'Analyze the grammar of the selected text and connect the explanation to the sentence.',
    synonyms_antonyms: 'Provide useful synonyms and antonyms for the selected text, noting important differences in nuance.',
    natural_rewrite: 'Rewrite the sentence naturally while keeping the selected meaning, and briefly explain the changes.',
    custom: 'Answer the custom question directly, keeping the selected text as the primary target.',
  },
};

export function renderPromptTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{\s*([A-Za-z][A-Za-z0-9_]*)\s*}}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? values[name] : placeholder
  ));
}
