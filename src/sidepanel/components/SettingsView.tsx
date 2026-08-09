import {
  Alert,
  Button,
  Card,
  Collapse,
  ColorPicker,
  Form,
  Input,
  InputNumber,
  Select,
  Switch,
  Tag,
} from 'antd';
import { useEffect, useState } from 'react';
import type { PublicSettings, QueryIntentId, Settings } from '../../domain/types';
import { defaultPromptTemplates } from '../../llm/prompt-templates';
import * as messageClient from '../message-client';

type Props = {
  settings: PublicSettings;
  onSaved: (settings: PublicSettings) => void;
};

type SettingsDraft = Omit<Settings, 'apiKey'>;

const intentLabels: Record<QueryIntentId, string> = {
  translate_sentence: '翻譯整句',
  explain_selection: '解釋選取文字',
  grammar: '文法分析',
  synonyms_antonyms: '同義詞／反義詞',
  natural_rewrite: '更自然的英文說法',
  custom: '自訂提問',
};

function createDraft(settings: PublicSettings): SettingsDraft {
  return {
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    outputLanguage: settings.outputLanguage,
    detailLevel: settings.detailLevel,
    contextLines: settings.contextLines,
    fontSize: settings.fontSize,
    textColor: settings.textColor,
    activeCueColor: settings.activeCueColor,
    autoFollowPlayback: settings.autoFollowPlayback,
    prompts: {
      ...settings.prompts,
      intentPrompts: { ...settings.prompts.intentPrompts },
    },
  };
}

export function SettingsView({ settings, onSaved }: Props) {
  const [draft, setDraft] = useState<SettingsDraft>(() => createDraft(settings));
  const [hasApiKey, setHasApiKey] = useState(settings.hasApiKey);
  const [apiKeyLastFour, setApiKeyLastFour] = useState(settings.apiKeyLastFour);
  const [replacementKey, setReplacementKey] = useState('');
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    setDraft(createDraft(settings));
    setHasApiKey(settings.hasApiKey);
    setApiKeyLastFour(settings.apiKeyLastFour);
  }, [settings]);

  function update<K extends keyof SettingsDraft>(key: K, value: SettingsDraft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }));
  }

  function updatePrompt(key: 'basePrompt' | 'inputPrompt', value: string): void {
    setDraft((current) => ({
      ...current,
      prompts: { ...current.prompts, [key]: value },
    }));
  }

  function updateIntentPrompt(intent: QueryIntentId, value: string): void {
    setDraft((current) => ({
      ...current,
      prompts: {
        ...current.prompts,
        intentPrompts: { ...current.prompts.intentPrompts, [intent]: value },
      },
    }));
  }

  async function save(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const trimmedReplacementKey = replacementKey.trim();
      const patch: Partial<Settings> = {
        ...draft,
        prompts: {
          ...draft.prompts,
          intentPrompts: { ...draft.prompts.intentPrompts },
        },
        ...(trimmedReplacementKey === '' ? {} : { apiKey: trimmedReplacementKey }),
      };
      const saved = await messageClient.saveSettings(patch);
      setDraft(createDraft(saved));
      setHasApiKey(saved.hasApiKey);
      setApiKeyLastFour(saved.apiKeyLastFour);
      setReplacementKey('');
      onSaved(saved);
      setStatus({ type: 'success', message: '設定已儲存' });
    } catch (reason) {
      setStatus({ type: 'error', message: reason instanceof Error ? reason.message : '無法儲存設定。' });
    } finally {
      setSaving(false);
    }
  }

  async function clearKey(): Promise<void> {
    setSaving(true);
    setStatus(null);
    try {
      const saved = await messageClient.clearApiKey();
      setHasApiKey(saved.hasApiKey);
      setApiKeyLastFour(saved.apiKeyLastFour);
      setReplacementKey('');
      onSaved(saved);
      setStatus({ type: 'success', message: 'API Key 已清除' });
    } catch (reason) {
      setStatus({ type: 'error', message: reason instanceof Error ? reason.message : '無法清除 API Key。' });
    } finally {
      setSaving(false);
    }
  }

  const promptItems = [
    {
      key: 'global-prompts',
      label: '全域與輸入 Prompt',
      children: <div className="prompt-editor-list">
        <Form.Item label="全域基礎 Prompt" htmlFor="base-prompt">
          <Input.TextArea id="base-prompt" aria-label="全域基礎 Prompt" rows={7} value={draft.prompts.basePrompt} onChange={(event) => updatePrompt('basePrompt', event.target.value)} />
        </Form.Item>
        <Form.Item label="輸入內容 Prompt" htmlFor="input-prompt">
          <Input.TextArea id="input-prompt" aria-label="輸入內容 Prompt" rows={7} value={draft.prompts.inputPrompt} onChange={(event) => updatePrompt('inputPrompt', event.target.value)} />
        </Form.Item>
      </div>,
    },
    {
      key: 'intent-prompts',
      label: '各功能 Prompt',
      children: <div className="prompt-editor-list">
        {(Object.keys(intentLabels) as QueryIntentId[]).map((intent) => (
          <Form.Item key={intent} label={`${intentLabels[intent]} Prompt`} htmlFor={`intent-prompt-${intent}`}>
            <Input.TextArea
              id={`intent-prompt-${intent}`}
              aria-label={`${intentLabels[intent]} Prompt`}
              rows={4}
              value={draft.prompts.intentPrompts[intent]}
              onChange={(event) => updateIntentPrompt(intent, event.target.value)}
            />
          </Form.Item>
        ))}
      </div>,
    },
  ];

  return <section aria-label="Settings" className="settings-view">
    <Card title="OpenAI 連線" size="small">
      <div className="settings-card-content">
        <div className="api-key-status" aria-label={hasApiKey && apiKeyLastFour
          ? `OpenAI API Key：已儲存（結尾 ••••${apiKeyLastFour}）`
          : 'OpenAI API Key：尚未儲存'}>
          <span>OpenAI API Key：</span>
          {hasApiKey && apiKeyLastFour
            ? <Tag color="success">已儲存（結尾 ••••{apiKeyLastFour}）</Tag>
            : <Tag>尚未儲存</Tag>}
        </div>
        <Form.Item label="替換 OpenAI API Key" htmlFor="replacement-api-key">
          <Input.Password
            id="replacement-api-key"
            aria-label="替換 OpenAI API Key"
            value={replacementKey}
            placeholder="輸入新的 API Key；留空會保留目前設定"
            onChange={(event) => setReplacementKey(event.target.value)}
          />
        </Form.Item>
        <Form.Item label="OpenAI 模型" htmlFor="openai-model">
          <Select
            id="openai-model"
            aria-label="OpenAI 模型"
            value={draft.model}
            options={[
              { value: 'gpt-5.6-luna', label: 'GPT-5.6 Luna（省成本）' },
              { value: 'gpt-5.6-terra', label: 'GPT-5.6 Terra（平衡）' },
              { value: 'gpt-5.6-sol', label: 'GPT-5.6 Sol（最強）' },
            ]}
            onChange={(value) => update('model', value as Settings['model'])}
          />
        </Form.Item>
        <Form.Item label="推理強度" htmlFor="reasoning-effort">
          <Select
            id="reasoning-effort"
            aria-label="推理強度"
            value={draft.reasoningEffort}
            options={['none', 'low', 'medium', 'high', 'xhigh', 'max'].map((value) => ({ value, label: value }))}
            onChange={(value) => update('reasoningEffort', value as Settings['reasoningEffort'])}
          />
        </Form.Item>
        <Button danger disabled={!hasApiKey || saving} onClick={() => void clearKey()}>清除 API Key</Button>
      </div>
    </Card>

    <Card title="回答設定" size="small">
      <div className="settings-grid">
        <Form.Item label="回答語言" htmlFor="output-language">
          <Input id="output-language" aria-label="回答語言" value={draft.outputLanguage} onChange={(event) => update('outputLanguage', event.target.value)} />
        </Form.Item>
        <Form.Item label="詳細程度" htmlFor="detail-level">
          <Select
            id="detail-level"
            aria-label="詳細程度"
            value={draft.detailLevel}
            options={[
              { value: 'brief', label: '精簡' },
              { value: 'normal', label: '一般' },
              { value: 'detailed', label: '詳細' },
            ]}
            onChange={(value) => update('detailLevel', value as Settings['detailLevel'])}
          />
        </Form.Item>
        <Form.Item label="前後文句數" htmlFor="context-lines">
          <InputNumber id="context-lines" aria-label="前後文句數" min={0} max={5} value={draft.contextLines} onChange={(value) => update('contextLines', value ?? 0)} />
        </Form.Item>
      </div>
    </Card>

    <Card title="AI Prompt" size="small">
      <p className="settings-help">可使用 {'{{outputLanguage}}'}、{'{{detailLevel}}'}、{'{{intentPrompt}}'}、{'{{selectedText}}'} 等變數。</p>
      <Collapse items={promptItems} />
      <Button onClick={() => setDraft((current) => ({
        ...current,
        prompts: { ...defaultPromptTemplates, intentPrompts: { ...defaultPromptTemplates.intentPrompts } },
      }))}>重設所有 Prompt</Button>
    </Card>

    <Card title="字幕外觀與播放" size="small">
      <div className="settings-grid">
        <Form.Item label="字幕字體大小" htmlFor="font-size">
          <InputNumber id="font-size" aria-label="字幕字體大小" min={12} max={32} value={draft.fontSize} onChange={(value) => update('fontSize', value ?? 16)} />
        </Form.Item>
        <Form.Item label="字幕文字顏色">
          <ColorPicker aria-label="字幕文字顏色" value={draft.textColor} onChangeComplete={(color) => update('textColor', color.toHexString())} />
        </Form.Item>
        <Form.Item label="目前字幕背景色">
          <ColorPicker aria-label="目前字幕背景色" value={draft.activeCueColor} onChangeComplete={(color) => update('activeCueColor', color.toHexString())} />
        </Form.Item>
        <Form.Item label="播放時自動跟隨">
          <Switch aria-label="播放時自動跟隨" checked={draft.autoFollowPlayback} onChange={(checked) => update('autoFollowPlayback', checked)} />
        </Form.Item>
      </div>
    </Card>

    {status && <div role="status"><Alert type={status.type} showIcon message={status.message} /></div>}
    <Button type="primary" loading={saving} onClick={() => void save()}>儲存全部設定</Button>
  </section>;
}
