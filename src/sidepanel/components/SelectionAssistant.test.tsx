import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SelectionAssistant } from './SelectionAssistant';

const initialInnerWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
const initialInnerHeight = Object.getOwnPropertyDescriptor(window, 'innerHeight');
const initialResizeObserver = Object.getOwnPropertyDescriptor(globalThis, 'ResizeObserver');

afterEach(() => {
  vi.restoreAllMocks();
  Object.defineProperty(window, 'innerWidth', initialInnerWidth!);
  Object.defineProperty(window, 'innerHeight', initialInnerHeight!);
  Object.defineProperty(globalThis, 'ResizeObserver', initialResizeObserver!);
});

const result = { answer: '這是浮動卡片中的解答。', model: 'gpt-5.2', createdAt: 1 };

describe('SelectionAssistant', () => {
  it('anchors one wrapper and renders the result card before the persistent action menu', () => {
    render(<SelectionAssistant
      selectedText="selected phrase"
      anchor={{ x: 120, y: 80 }}
      result={result}
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
      onToggleFavorite={vi.fn()}
      isSaved
      isFavorite={false}
    />);

    const assistant = screen.getByRole('dialog', { name: 'English learning assistant' });
    const resultRegion = screen.getByRole('region', { name: 'Query result' });
    const menu = screen.getByRole('group', { name: 'Selection actions' });

    expect(assistant).toHaveStyle({ position: 'fixed' });
    expect(resultRegion).toHaveClass('assistant-result-scroll');
    expect(resultRegion.compareDocumentPosition(menu) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByText('這是浮動卡片中的解答。')).toBeInTheDocument();
  });

  it('recalculates to measured clamped coordinates after a window resize', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      bottom: 40,
      height: 40,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    });

    render(<SelectionAssistant
      selectedText="selected phrase"
      anchor={{ x: 490, y: 100 }}
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
    />);

    fireEvent(window, new Event('resize'));

    expect(screen.getByRole('dialog', { name: 'English learning assistant' }))
      .toHaveStyle({ position: 'fixed', left: '384px', top: '52px' });
  });

  it('remeasures when the favorite label changes without ResizeObserver', () => {
    const anchor = { x: 490, y: 100 };
    let measurement = {
      bottom: 40,
      height: 40,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    };

    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 500 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 300 });
    Object.defineProperty(globalThis, 'ResizeObserver', { configurable: true, value: undefined });
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => measurement);

    const { rerender } = render(<SelectionAssistant
      selectedText="selected phrase"
      anchor={anchor}
      result={result}
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
      isSaved
      isFavorite={false}
    />);

    expect(screen.getByRole('button', { name: 'Add favorite' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'English learning assistant' }))
      .toHaveStyle({ left: '384px', top: '52px' });

    measurement = {
      bottom: 100,
      height: 100,
      left: 0,
      right: 100,
      toJSON: () => ({}),
      top: 0,
      width: 100,
      x: 0,
      y: 0,
    };
    rerender(<SelectionAssistant
      selectedText="selected phrase"
      anchor={anchor}
      result={result}
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
      isSaved
      isFavorite
    />);

    expect(screen.getByRole('button', { name: 'Remove favorite' })).toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'English learning assistant' }))
      .toHaveStyle({ left: '384px', top: '108px' });
  });

  it('shows loading, error, and history warning inside the assistant result area', () => {
    const { rerender } = render(<SelectionAssistant
      selectedText="selected phrase"
      anchor={{ x: 120, y: 80 }}
      loading
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('status')).toHaveTextContent('正在取得回答');

    rerender(<SelectionAssistant
      selectedText="selected phrase"
      anchor={{ x: 120, y: 80 }}
      error="OpenAI request failed."
      warning="回答完成，但無法寫入歷史。"
      onChooseIntent={vi.fn()}
      onClose={vi.fn()}
    />);

    expect(screen.getByRole('alert')).toHaveTextContent('OpenAI request failed.');
    expect(screen.getByText('回答完成，但無法寫入歷史。')).toBeInTheDocument();
  });

  it('preserves Focused Study actions and closes on other outside pointers or Escape', async () => {
    const user = userEvent.setup();
    const onChooseIntent = vi.fn();
    const onClose = vi.fn();
    render(<>
      <button type="button">Outside</button>
      <button type="button" data-focused-study-action="preserve">Replay outside</button>
      <SelectionAssistant
        selectedText="selected phrase"
        anchor={{ x: 120, y: 80 }}
        onChooseIntent={onChooseIntent}
        onClose={onClose}
      />
    </>);

    await user.click(screen.getByRole('button', { name: '翻譯整句' }));
    expect(onChooseIntent).toHaveBeenCalledWith('translate_sentence', undefined);
    expect(onClose).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog', { name: 'English learning assistant' })).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Replay outside' }));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.pointerDown(screen.getByRole('button', { name: 'Outside' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
