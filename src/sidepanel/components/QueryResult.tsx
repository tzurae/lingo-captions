import { Alert, Button, Card, Spin } from 'antd';
import type { QueryResult as QueryResultValue, ReasoningEffort } from '../../domain/types';

type Props = {
  selectedText: string;
  result?: QueryResultValue | null;
  loading?: boolean;
  requestedModel?: string | null;
  requestedReasoningEffort?: ReasoningEffort | null;
  error?: string | null;
  warning?: string | null;
  onSave?: () => void | Promise<void>;
  onToggleFavorite?: () => void | Promise<void>;
  isSaved?: boolean;
  isFavorite?: boolean;
};

export function QueryResult({
  selectedText,
  result,
  loading = false,
  requestedModel = null,
  requestedReasoningEffort = null,
  error = null,
  warning = null,
  onSave,
  onToggleFavorite,
  isSaved = false,
  isFavorite = false,
}: Props) {
  if (!loading && !error && !warning && !result) return null;
  const completedRequestedModel = result?.requestedModel ?? requestedModel;
  const modelMismatch = result !== null
    && result !== undefined
    && completedRequestedModel !== null
    && completedRequestedModel !== result.model;

  return <div className="assistant-result-stack">
    {loading && <Card size="small" className="assistant-result-card">
      <div role="status" className="assistant-loading"><Spin size="small" /> <span>正在取得回答…</span></div>
      {(requestedModel || requestedReasoningEffort) && <div className="assistant-query-metadata">
        {requestedModel && <p>Requested model: {requestedModel}</p>}
        {requestedReasoningEffort && <p>Effort: {requestedReasoningEffort}</p>}
      </div>}
    </Card>}
    {error && <Alert role="alert" type="error" showIcon message={error} />}
    {warning && <Alert role="status" type="warning" showIcon message={warning} />}
    {result && <Card size="small" className="assistant-result-card">
      <section aria-label="Query result" className="assistant-result-scroll">
        <h2>{selectedText}</h2>
        <p>{result.answer}</p>
        {completedRequestedModel && <p>Requested model: {completedRequestedModel}</p>}
        <p>OpenAI returned model: {result.model}</p>
        {result.reasoningEffort && <p>Reasoning effort: {result.reasoningEffort}</p>}
        {modelMismatch && <Alert
          role="status"
          type="warning"
          showIcon
          message="OpenAI returned a different model than requested."
        />}
      </section>
      <div className="assistant-result-actions">
        <Button size="small" onClick={() => void onSave?.()} disabled={isSaved}>{isSaved ? 'Query saved' : 'Save query'}</Button>
        <Button size="small" onClick={() => void onToggleFavorite?.()} disabled={!isSaved}>{isFavorite ? 'Remove favorite' : 'Add favorite'}</Button>
      </div>
    </Card>}
  </div>;
}
