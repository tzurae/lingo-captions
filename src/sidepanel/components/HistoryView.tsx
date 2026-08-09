import { useEffect, useMemo, useRef, useState } from 'react';
import type { HistoryRecord } from '../../domain/types';
import { exportHistory, parseHistoryExport } from '../../storage/history-transfer';
import * as messageClient from '../message-client';

function savedDate(record: HistoryRecord): string {
  const date = new Date(record.createdAt);
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

function reopenUrl(record: HistoryRecord): string | null {
  if (!record.subtitlePosition) return null;
  return `${record.videoUrl}${record.videoUrl.includes('?') ? '&' : '?'}t=${record.subtitlePosition.startMs / 1000}s`;
}

export function HistoryView() {
  const importInputRef = useRef<HTMLInputElement>(null);
  const [records, setRecords] = useState<HistoryRecord[] | null>(null);
  const [videoFilter, setVideoFilter] = useState('');
  const [dateFilter, setDateFilter] = useState('');
  const [favoriteFilter, setFavoriteFilter] = useState('all');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    messageClient.listHistory()
      .then((items) => setRecords([...items].sort((a, b) => b.createdAt - a.createdAt)))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Unable to load history.'));
  }, []);

  const videoOptions = useMemo(() => {
    if (!records) return [];
    return Array.from(new Map(records.map((record) => [record.videoId, record.videoTitle])).entries());
  }, [records]);

  const filteredRecords = useMemo(() => records?.filter((record) => (
    (videoFilter === '' || record.videoId === videoFilter)
    && (dateFilter === '' || savedDate(record) === dateFilter)
    && (favoriteFilter === 'all'
      || (favoriteFilter === 'favorite' && record.isFavorite)
      || (favoriteFilter === 'not-favorite' && !record.isFavorite))
  )), [dateFilter, favoriteFilter, records, videoFilter]);

  async function toggle(record: HistoryRecord) {
    try {
      const isFavorite = !record.isFavorite;
      await messageClient.toggleFavorite(record.id, isFavorite);
      setRecords((items) => items?.map((item) => item.id === record.id ? { ...item, isFavorite } : item) ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to update favorite.'); }
  }

  async function remove(id: string) {
    try {
      await messageClient.deleteHistory(id);
      setRecords((items) => items?.filter((item) => item.id !== id) ?? null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to delete history.'); }
  }

  function download(): void {
    if (!filteredRecords) return;
    try {
      const file = new Blob([exportHistory(filteredRecords)], { type: 'application/json' });
      const url = URL.createObjectURL(file);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'youtube-english-learning-history.json';
      link.click();
      URL.revokeObjectURL(url);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to export history.');
    }
  }

  async function importFile(file: File | undefined): Promise<void> {
    if (!file) return;
    try {
      const imported = parseHistoryExport(await file.text());
      await Promise.all(imported.map((record) => messageClient.saveHistory(record)));
      setRecords((items) => [...(items ?? []), ...imported].sort((a, b) => b.createdAt - a.createdAt));
      setError(null);
      setNotice(`Imported ${imported.length} history record${imported.length === 1 ? '' : 's'}.`);
    } catch (reason) {
      setNotice(null);
      setError(reason instanceof Error ? reason.message : 'Unable to import history.');
    }
  }

  return <section aria-label="History">
    <div>
      <button type="button" onClick={download} disabled={records === null}>匯出 JSON</button>
      <button type="button" onClick={() => importInputRef.current?.click()}>匯入 JSON</button>
      <input ref={importInputRef} aria-label="匯入 JSON" type="file" accept="application/json,.json" onChange={(event) => void importFile(event.target.files?.[0])} hidden />
    </div>
    {records !== null && records.length > 0 && <div aria-label="History filters">
      <label>Video<select aria-label="Filter by video" value={videoFilter} onChange={(event) => setVideoFilter(event.target.value)}>
        <option value="">All videos</option>
        {videoOptions.map(([id, title]) => <option key={id} value={id}>{title}</option>)}
      </select></label>
      <label>Date<input aria-label="Filter by date" type="date" value={dateFilter} onChange={(event) => setDateFilter(event.target.value)} /></label>
      <label>Favorite<select aria-label="Filter by favorite" value={favoriteFilter} onChange={(event) => setFavoriteFilter(event.target.value)}>
        <option value="all">All</option>
        <option value="favorite">Favorites</option>
        <option value="not-favorite">Not favorites</option>
      </select></label>
    </div>}
    {error && <p role="alert">{error}</p>}
    {notice && <p role="status">{notice}</p>}
    {records === null ? <p role="status">Loading history</p> : records.length === 0 ? <p>No saved queries yet.</p> : filteredRecords?.length === 0 ? <p>No history matches the current filters.</p> : <ul>{filteredRecords?.map((record) => {
      const link = reopenUrl(record);
      return <li key={record.id}>
        <strong>{record.request.selectedText}</strong>
        <p>{record.videoTitle}</p>
        <time dateTime={new Date(record.createdAt).toISOString()}>{new Date(record.createdAt).toLocaleString()}</time>
        {link && <a href={link} target="_blank" rel="noreferrer">Open video at saved subtitle time</a>}
        <p>{record.result.answer}</p>
        <p>Model: {record.result.model}{record.result.reasoningEffort && ` · Reasoning effort: ${record.result.reasoningEffort}`}</p>
        <button type="button" aria-label={record.isFavorite ? 'Remove favorite' : 'Add favorite'} onClick={() => void toggle(record)}>{record.isFavorite ? '★' : '☆'}</button>
        <button type="button" aria-label="Delete history record" onClick={() => void remove(record.id)}>Delete</button>
      </li>;
    })}</ul>}
  </section>;
}
