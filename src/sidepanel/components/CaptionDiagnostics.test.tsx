import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { CaptionDiagnostics } from './CaptionDiagnostics';

describe('CaptionDiagnostics', () => {
  it('opens automatically for a caption pipeline error and copies safe details', async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

    render(<CaptionDiagnostics entries={[{
      stage: 'timedtext-download',
      status: 'error',
      code: 'CAPTION_FETCH_FAILED',
      message: '字幕下載失敗（HTTP 403）。',
      details: { httpStatus: 403 },
    }]} />);

    expect(screen.getByText('字幕下載失敗（HTTP 403）。')).toBeVisible();
    expect(screen.getByText('HTTP 狀態：')).toBeInTheDocument();
    expect(screen.getByText('403')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '複製診斷資訊' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('CAPTION_FETCH_FAILED'));
  });

  it('stays collapsed when the pipeline succeeds', () => {
    render(<CaptionDiagnostics entries={[{
      stage: 'ready',
      status: 'success',
      message: '已取得完整英文字幕，共 20 句。',
      details: { cueCount: 20, source: 'timedtext' },
    }]} />);

    expect(screen.getByText('字幕診斷（1）').closest('details')).not.toHaveAttribute('open');
  });

  it('opens from the current status rather than a recovered historical error', () => {
    const recoveredEntries = [
      { stage: 'timedtext-parse' as const, status: 'error' as const, message: '完整字幕解析失敗。' },
      { stage: 'ready' as const, status: 'success' as const, message: '完整字幕已可用。' },
    ];
    const { rerender } = render(<CaptionDiagnostics entries={recoveredEntries} />);

    expect(screen.getByText('字幕診斷（2）').closest('details')).not.toHaveAttribute('open');

    rerender(<CaptionDiagnostics entries={[...recoveredEntries, {
      stage: 'timedtext-download',
      status: 'error',
      message: '目前字幕抓取失敗。',
    }]} />);

    expect(screen.getByText('字幕診斷（3）').closest('details')).toHaveAttribute('open');
  });
});
