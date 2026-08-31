import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { QueryIntentId, QueryResult as QueryResultValue, ReasoningEffort } from '../../domain/types';
import { calculateAssistantPosition } from '../assistant-position';
import { QueryResult } from './QueryResult';
import { SelectionMenu } from './SelectionMenu';

type Props = {
  selectedText: string;
  anchor: { x: number; y: number };
  result?: QueryResultValue | null;
  loading?: boolean;
  requestedModel?: string | null;
  requestedReasoningEffort?: ReasoningEffort | null;
  error?: string | null;
  warning?: string | null;
  onChooseIntent: (intent: QueryIntentId, customQuestion?: string) => void;
  onClose: () => void;
  onSave?: () => void | Promise<void>;
  onToggleFavorite?: () => void | Promise<void>;
  isSaved?: boolean;
  isFavorite?: boolean;
};

export function SelectionAssistant({
  selectedText,
  anchor,
  result = null,
  loading = false,
  requestedModel = null,
  requestedReasoningEffort = null,
  error = null,
  warning = null,
  onChooseIntent,
  onClose,
  onSave,
  onToggleFavorite,
  isSaved = false,
  isFavorite = false,
}: Props) {
  const assistantRef = useRef<HTMLElement | null>(null);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });

  useLayoutEffect(() => {
    const assistant = assistantRef.current;
    if (!assistant) return;

    const updatePosition = () => {
      const currentAssistant = assistantRef.current;
      if (!currentAssistant) return;

      const bounds = currentAssistant.getBoundingClientRect();
      const nextPosition = calculateAssistantPosition(
        anchor,
        { width: bounds.width, height: bounds.height },
        { width: window.innerWidth, height: window.innerHeight },
      );

      setPosition(current => current.left === nextPosition.left && current.top === nextPosition.top
        ? current
        : { left: nextPosition.left, top: nextPosition.top });
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    window.addEventListener('scroll', updatePosition, true);

    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(updatePosition);
    resizeObserver?.observe(assistant);

    return () => {
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
      resizeObserver?.disconnect();
    };
  }, [anchor, selectedText, result, loading, error, warning, isSaved, isFavorite]);

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      if (event.target instanceof Element
        && event.target.closest('[data-focused-study-action="preserve"]')) return;
      if (event.target instanceof Node && !assistantRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener('keydown', closeOnEscape);
    document.addEventListener('pointerdown', closeOnOutsidePointer);
    return () => {
      document.removeEventListener('keydown', closeOnEscape);
      document.removeEventListener('pointerdown', closeOnOutsidePointer);
    };
  }, [onClose]);

  if (selectedText.trim() === '') return null;

  return <section
    ref={assistantRef}
    role="dialog"
    aria-label="English learning assistant"
    className="selection-assistant"
    style={{ position: 'fixed', left: position.left, top: position.top }}
  >
    <QueryResult
      selectedText={selectedText}
      result={result}
      loading={loading}
      requestedModel={requestedModel}
      requestedReasoningEffort={requestedReasoningEffort}
      error={error}
      warning={warning}
      onSave={onSave}
      onToggleFavorite={onToggleFavorite}
      isSaved={isSaved}
      isFavorite={isFavorite}
    />
    <SelectionMenu
      selectedText={selectedText}
      onChooseIntent={(intent, question) => onChooseIntent(intent, question)}
      onClose={onClose}
    />
  </section>;
}
