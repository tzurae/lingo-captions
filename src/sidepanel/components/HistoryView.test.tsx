import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HistoryView } from './HistoryView';
import * as messageClient from '../message-client';

vi.mock('../message-client', () => ({
  deleteHistory: vi.fn(),
  listHistory: vi.fn(),
  saveHistory: vi.fn(),
  toggleFavorite: vi.fn(),
}));

vi.mock('../../storage/history-transfer', () => ({
  exportHistory: vi.fn(),
  parseHistoryExport: vi.fn(),
}));

import { exportHistory, parseHistoryExport } from '../../storage/history-transfer';

const record = {
  id: 'history-1', createdAt: 1, videoId: 'video-1', videoTitle: 'Video one', videoUrl: 'https://youtube.test',
  request: { intent: 'translate_sentence' as const, selectedText: 'phrase', sentence: 'A phrase.', contextBefore: [], contextAfter: [], outputLanguage: '蝜?銝剜?', detailLevel: 'normal' as const },
  result: { answer: 'Answer', model: 'gpt-5.2', createdAt: 1 }, isFavorite: false,
};

const otherRecord = {
  ...record,
  id: 'history-2',
  createdAt: 2,
  videoId: 'video-2',
  videoTitle: 'Video two',
  videoUrl: 'https://youtube.test/watch?v=video-2',
  isFavorite: true,
  subtitlePosition: { startMs: 12_500, endMs: 13_500 },
  result: { answer: 'Another answer', model: 'gpt-5.6-terra', reasoningEffort: 'high' as const, createdAt: 2 },
};

describe('HistoryView', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    vi.mocked(messageClient.toggleFavorite).mockResolvedValue(undefined);
    vi.mocked(messageClient.deleteHistory).mockResolvedValue(undefined);
    vi.mocked(messageClient.saveHistory).mockResolvedValue(undefined);
  });

  it('shows an empty state when no history is returned', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([]);
    render(<HistoryView />);

    expect(await screen.findByText('No saved queries yet.')).toBeInTheDocument();
  });

  it('shows the selected model and reasoning effort for new history records', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([otherRecord]);
    render(<HistoryView />);

    expect(await screen.findByText('Model: gpt-5.6-terra · Reasoning effort: high')).toBeInTheDocument();
  });

  it('shows only the model for legacy history records without a reasoning effort', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([record]);
    render(<HistoryView />);

    expect(await screen.findByText('Model: gpt-5.2')).toBeInTheDocument();
    expect(screen.queryByText(/Reasoning effort: low/)).not.toBeInTheDocument();
  });

  it('toggles favorite and removes one displayed record', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.listHistory).mockResolvedValue([record]);
    render(<HistoryView />);
    await screen.findByText('phrase');

    await user.click(screen.getByRole('button', { name: 'Add favorite' }));
    expect(screen.getByRole('button', { name: 'Remove favorite' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Delete history record' }));

    await waitFor(() => expect(screen.getByText('No saved queries yet.')).toBeInTheDocument());
  });

  it('exports displayed history as the named JSON download', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.listHistory).mockResolvedValue([record]);
    vi.mocked(exportHistory).mockReturnValue('{"version":1}');
    const createObjectUrl = vi.fn(() => 'blob:history');
    const click = vi.fn();
    let downloadLink: HTMLAnchorElement | undefined;
    vi.stubGlobal('URL', { createObjectURL: createObjectUrl, revokeObjectURL: vi.fn() });
    vi.spyOn(document, 'createElement').mockImplementation((tagName) => {
      const element = document.createElementNS('http://www.w3.org/1999/xhtml', tagName) as HTMLAnchorElement;
      if (tagName === 'a') {
        downloadLink = element;
        element.click = click;
      }
      return element;
    });
    render(<HistoryView />);
    await screen.findByText('phrase');

    await user.click(screen.getByRole('button', { name: '匯出 JSON' }));

    expect(exportHistory).toHaveBeenCalledWith([record]);
    expect(createObjectUrl).toHaveBeenCalledWith(expect.any(Blob));
    expect(downloadLink?.download).toBe('youtube-english-learning-history.json');
    expect(click).toHaveBeenCalledOnce();
  });

  it('provides a visible 匯入 JSON control for the hidden file input', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([]);
    render(<HistoryView />);

    expect(await screen.findByRole('button', { name: '匯入 JSON' })).toBeInTheDocument();
  });

  it('validates the complete import before saving records and reports its count', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([]);
    vi.mocked(parseHistoryExport).mockReturnValue([record]);
    render(<HistoryView />);
    await screen.findByText('No saved queries yet.');
    const input = screen.getByLabelText('匯入 JSON');
    const file = new File(['{"version":1}'], 'history.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('{"version":1}') });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText('Imported 1 history record.')).toBeInTheDocument();
    expect(parseHistoryExport).toHaveBeenCalledWith('{"version":1}');
    expect(messageClient.saveHistory).toHaveBeenCalledWith(record);
  });

  it('shows a validation error without saving an invalid import', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([]);
    vi.mocked(parseHistoryExport).mockImplementation(() => { throw new Error('API_KEY_NOT_ALLOWED'); });
    render(<HistoryView />);
    await screen.findByText('No saved queries yet.');
    const input = screen.getByLabelText('匯入 JSON');
    const file = new File(['{"version":1}'], 'history.json', { type: 'application/json' });
    Object.defineProperty(file, 'text', { value: vi.fn().mockResolvedValue('{"version":1}') });

    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByRole('alert')).toHaveTextContent('API_KEY_NOT_ALLOWED');
    expect(messageClient.saveHistory).not.toHaveBeenCalled();
  });

  it('shows video metadata and a link to reopen a saved subtitle position', async () => {
    vi.mocked(messageClient.listHistory).mockResolvedValue([otherRecord]);
    render(<HistoryView />);

    expect(await screen.findByText('Video two', { selector: 'p' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open video at saved subtitle time' })).toHaveAttribute(
      'href',
      'https://youtube.test/watch?v=video-2&t=12.5s',
    );
    expect(screen.getByRole('time')).toHaveAttribute('dateTime', new Date(2).toISOString());
  });

  it('filters history by video, date, and favorite state', async () => {
    const user = userEvent.setup();
    vi.mocked(messageClient.listHistory).mockResolvedValue([record, otherRecord]);
    render(<HistoryView />);
    await screen.findByText('Video one', { selector: 'p' });

    await user.selectOptions(screen.getByLabelText('Filter by video'), 'video-2');
    expect(screen.queryByText('A phrase.')).not.toBeInTheDocument();
    expect(screen.getByText('Video two', { selector: 'p' })).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Filter by favorite'), 'favorite');
    expect(screen.getByText('Video two', { selector: 'p' })).toBeInTheDocument();

    await user.clear(screen.getByLabelText('Filter by date'));
    await user.type(screen.getByLabelText('Filter by date'), '1970-01-02');
    expect(await screen.findByText('No history matches the current filters.')).toBeInTheDocument();
  });

  it('filters by the displayed local calendar date across a UTC boundary', async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    try {
      const crossBoundaryRecord = {
        ...record,
        id: 'history-cross-boundary',
        createdAt: Date.UTC(2024, 0, 2, 0, 30),
        request: { ...record.request, selectedText: 'cross-boundary phrase' },
      };
      vi.mocked(messageClient.listHistory).mockResolvedValue([crossBoundaryRecord]);
      render(<HistoryView />);
      await screen.findByText('cross-boundary phrase');

      fireEvent.change(screen.getByLabelText('Filter by date'), { target: { value: '2024-01-01' } });

      expect(screen.getByText('cross-boundary phrase')).toBeInTheDocument();
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
