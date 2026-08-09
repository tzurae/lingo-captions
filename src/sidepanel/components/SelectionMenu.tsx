import { listQueryIntents } from '../../domain/query-intents';
import type { QueryIntentId } from '../../domain/types';
import { useState } from 'react';

type Props = {
  selectedText: string;
  onChooseIntent: (intent: QueryIntentId, customQuestion?: string) => void;
  onClose: () => void;
};

const firstLevelIntentIds: QueryIntentId[] = ['translate_sentence', 'explain_selection', 'grammar'];

export function SelectionMenu({ selectedText, onChooseIntent, onClose }: Props) {
  const [customOpen, setCustomOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [question, setQuestion] = useState('');
  if (selectedText.trim() === '') return null;
  const intents = listQueryIntents();
  const firstLevelIntents = intents.filter((intent) => firstLevelIntentIds.includes(intent.id));
  const additionalIntents = intents.filter((intent) => !firstLevelIntentIds.includes(intent.id));
  const chooseIntent = (intent: QueryIntentId, customQuestion?: string) => {
    if (customQuestion === undefined) {
      onChooseIntent(intent);
    } else {
      onChooseIntent(intent, customQuestion);
    }
  };

  return (
    <section role="group" aria-label="Selection actions" className="selection-menu">
      <div className="action-list">
        {firstLevelIntents.map((intent) => (
          <button key={intent.id} type="button" className={intent.primary ? 'primary-action' : undefined} onClick={() => chooseIntent(intent.id)}>
            {intent.label}
          </button>
        ))}
        <button type="button" onClick={() => setMoreOpen(true)} aria-expanded={moreOpen}>更多</button>
        {moreOpen && additionalIntents.map((intent) => (
          <button key={intent.id} type="button" onClick={() => intent.id === 'custom' ? setCustomOpen(true) : chooseIntent(intent.id)}>
            {intent.label}
          </button>
        ))}
      </div>
      {customOpen && (
        <form onSubmit={(event) => { event.preventDefault(); const trimmedQuestion = question.trim(); if (trimmedQuestion === '') return; chooseIntent('custom', trimmedQuestion); }}>
          <label>Custom question<input aria-label="Custom question" value={question} onChange={(event) => setQuestion(event.target.value)} /></label>
          <button type="submit" disabled={question.trim() === ''}>送出問題</button>
        </form>
      )}
      <button type="button" className="selection-menu-close" aria-label="Close selection menu" onClick={onClose}>×</button>
    </section>
  );
}
