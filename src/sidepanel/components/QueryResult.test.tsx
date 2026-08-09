import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { QueryResult } from './QueryResult';

describe('QueryResult', () => {
  it('shows the requested model and effort while the query is running', () => {
    render(<QueryResult
      selectedText="a selected phrase"
      loading
      requestedModel="gpt-5.6-luna"
      requestedReasoningEffort="low"
    />);

    expect(screen.getByText('Requested model: gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('Effort: low')).toBeInTheDocument();
  });

  it('shows the OpenAI returned model and warns when it differs from the requested model', () => {
    render(<QueryResult selectedText="a selected phrase" result={{
      answer: 'An explanation.',
      model: 'gpt-5.6-luna-2026-07-01',
      requestedModel: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      createdAt: 1,
    }} />);

    expect(screen.getByText('Requested model: gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('OpenAI returned model: gpt-5.6-luna-2026-07-01')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('OpenAI returned a different model');
  });

  it('renders no placeholder before a query has started', () => {
    const { container } = render(<QueryResult selectedText="a selected phrase" />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByText(/No query result/i)).not.toBeInTheDocument();
  });

  it('renders the selected text, answer, model, and reasoning effort without an API key', () => {
    render(<QueryResult selectedText="a selected phrase" result={{
      answer: 'An explanation.',
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
      createdAt: 1,
    }} />);

    expect(screen.getByText('a selected phrase')).toBeInTheDocument();
    expect(screen.getByText('An explanation.')).toBeInTheDocument();
    expect(screen.getByText('OpenAI returned model: gpt-5.6-luna')).toBeInTheDocument();
    expect(screen.getByText('Reasoning effort: low')).toBeInTheDocument();
    expect(screen.queryByText(/sk-secret/i)).not.toBeInTheDocument();
  });

  it('offers accessible save and favorite actions for a completed result', async () => {
    const user = userEvent.setup();
    const onSave = vi.fn();
    const onToggleFavorite = vi.fn();
    render(<QueryResult selectedText="a selected phrase" result={{ answer: 'An explanation.', model: 'gpt-5.2', createdAt: 1 }} onSave={onSave} onToggleFavorite={onToggleFavorite} isFavorite={false} />);

    await user.click(screen.getByRole('button', { name: 'Save query' }));

    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Add favorite' })).toBeDisabled();
  });

  it('emits a favorite toggle after a result has been saved', async () => {
    const user = userEvent.setup();
    const onToggleFavorite = vi.fn();
    render(<QueryResult selectedText="a selected phrase" result={{ answer: 'An explanation.', model: 'gpt-5.2', createdAt: 1 }} onToggleFavorite={onToggleFavorite} isSaved />);

    await user.click(screen.getByRole('button', { name: 'Add favorite' }));

    expect(onToggleFavorite).toHaveBeenCalledOnce();
  });
});
