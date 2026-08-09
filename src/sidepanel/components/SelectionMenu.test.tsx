import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { SelectionMenu } from './SelectionMenu';

describe('SelectionMenu', () => {
  it('is hidden for an empty selection', () => {
    render(<SelectionMenu selectedText="" onChooseIntent={vi.fn()} onClose={vi.fn()} />);

    expect(screen.queryByRole('button', { name: '翻譯整句' })).not.toBeInTheDocument();
  });

  it('renders a compact action group with only the first-level learning actions', () => {
    render(<SelectionMenu selectedText="selected words" onChooseIntent={vi.fn()} onClose={vi.fn()} />);

    expect(screen.getByRole('group', { name: 'Selection actions' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '翻譯整句' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '解釋選取文字' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '文法分析' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '更多' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '同義詞／反義詞' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '更自然的英文說法' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '自訂提問' })).not.toBeInTheDocument();
    expect(screen.queryByText('selected words')).not.toBeInTheDocument();
  });

  it('uses the primary translation label and emits its intent without closing the menu', async () => {
    const user = userEvent.setup();
    const onChooseIntent = vi.fn();
    const onClose = vi.fn();
    render(<SelectionMenu selectedText="selected words" onChooseIntent={onChooseIntent} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: '翻譯整句' }));

    expect(onChooseIntent).toHaveBeenCalledWith('translate_sentence');
    expect(onClose).not.toHaveBeenCalled();
  });

  it.each(['同義詞／反義詞', '更自然的英文說法', '自訂提問'])('reveals the remaining action label %s after 更多', async (label) => {
    const user = userEvent.setup();
    render(<SelectionMenu selectedText="selected words" onChooseIntent={vi.fn()} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '更多' }));
    expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
  });

  it('reveals a custom question input before submitting the custom intent', async () => {
    const user = userEvent.setup();
    const onChooseIntent = vi.fn();
    render(<SelectionMenu selectedText="selected words" onChooseIntent={onChooseIntent} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: '自訂提問' }));
    await user.type(screen.getByRole('textbox', { name: 'Custom question' }), 'Why this phrasing?');
    await user.click(screen.getByRole('button', { name: '送出問題' }));

    expect(onChooseIntent).toHaveBeenCalledWith('custom', 'Why this phrasing?');
  });

  it('keeps the custom submit button disabled for a whitespace-only question', async () => {
    const user = userEvent.setup();
    const onChooseIntent = vi.fn();
    render(<SelectionMenu selectedText="selected words" onChooseIntent={onChooseIntent} onClose={vi.fn()} />);

    await user.click(screen.getByRole('button', { name: '更多' }));
    await user.click(screen.getByRole('button', { name: '自訂提問' }));
    const question = screen.getByRole('textbox', { name: 'Custom question' });
    const submit = screen.getByRole('button', { name: '送出問題' });

    expect(submit).toBeDisabled();
    await user.type(question, '   ');
    expect(submit).toBeDisabled();
    await user.click(submit);

    expect(onChooseIntent).not.toHaveBeenCalled();
  });

  it('closes from the explicit close control', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SelectionMenu selectedText="selected words" onChooseIntent={vi.fn()} onClose={onClose} />);

    await user.click(screen.getByRole('button', { name: 'Close selection menu' }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
