import type { CaptionDiagnostic } from '../../domain/types';

type Props = {
  entries: CaptionDiagnostic[];
};

const detailLabels: Record<string, string> = {
  trackCount: '字幕軌數量',
  languages: '語言',
  httpStatus: 'HTTP 狀態',
  cueCount: '字幕句數',
  source: '來源',
};

function formatDiagnostics(entries: CaptionDiagnostic[]): string {
  return entries.map((entry) => JSON.stringify({
    stage: entry.stage,
    status: entry.status,
    code: entry.code,
    message: entry.message,
    details: entry.details,
  })).join('\n');
}

export function CaptionDiagnostics({ entries }: Props) {
  if (!entries.length) return null;
  const currentStatus = entries.at(-1)?.status;
  const opensAutomatically = currentStatus === 'error' || currentStatus === 'fallback';

  return <details className="caption-diagnostics" open={opensAutomatically}>
    <summary>字幕診斷（{entries.length}）</summary>
    <ol>
      {entries.map((entry, index) => <li key={`${entry.stage}-${entry.code ?? entry.status}-${index}`}>
        <strong>{entry.status === 'error' ? '錯誤' : entry.status === 'fallback' ? 'Fallback' : entry.status === 'success' ? '完成' : '處理中'}</strong>
        <span>{entry.message}</span>
        {entry.code && <code>{entry.code}</code>}
        {entry.details && <dl>
          {Object.entries(entry.details).map(([key, value]) => <div key={key}>
            <dt>{detailLabels[key] ?? key}：</dt>
            <dd>{Array.isArray(value) ? value.join(', ') : value}</dd>
          </div>)}
        </dl>}
      </li>)}
    </ol>
    <button type="button" onClick={() => void navigator.clipboard.writeText(formatDiagnostics(entries)).catch(() => undefined)}>
      複製診斷資訊
    </button>
  </details>;
}
