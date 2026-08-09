import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicSettings } from '../../domain/types';
import { defaultPromptTemplates } from '../../llm/prompt-templates';
import { SettingsView } from './SettingsView';
import * as messageClient from '../message-client';

vi.mock('../message-client', () => ({
  clearApiKey: vi.fn(),
  saveSettings: vi.fn(),
}));

const settings: PublicSettings = {
  model: 'gpt-5.6-luna',
  reasoningEffort: 'low',
  outputLanguage: '繁體中文',
  detailLevel: 'normal',
  contextLines: 1,
  fontSize: 16,
  textColor: '#1f2937',
  activeCueColor: '#dbeafe',
  autoFollowPlayback: true,
  prompts: defaultPromptTemplates,
  hasApiKey: true,
  apiKeyLastFour: '1234',
};

describe('SettingsView', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(messageClient.saveSettings).mockResolvedValue(settings);
    vi.mocked(messageClient.clearApiKey).mockResolvedValue({
      ...settings,
      hasApiKey: false,
      apiKeyLastFour: null,
    });
  });

  it('renders four Ant Design cards, one global save action, and the global OpenAI controls', () => {
    render(<SettingsView settings={settings} onSaved={vi.fn()} />);

    expect(screen.getByText('OpenAI 連線')).toBeInTheDocument();
    expect(screen.getByText('回答設定')).toBeInTheDocument();
    expect(screen.getByText('AI Prompt')).toBeInTheDocument();
    expect(screen.getByText('字幕外觀與播放')).toBeInTheDocument();
    expect(document.querySelectorAll('.ant-card')).toHaveLength(4);
    expect(screen.getByRole('button', { name: '儲存全部設定' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'OpenAI 模型' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '推理強度' })).toBeInTheDocument();
  });

  it('shows an unambiguous saved-key suffix without putting the raw key in the form', () => {
    render(<SettingsView settings={settings} onSaved={vi.fn()} />);

    expect(screen.getByLabelText('OpenAI API Key：已儲存（結尾 ••••1234）')).toBeInTheDocument();
    expect(screen.getByLabelText('替換 OpenAI API Key')).toHaveValue('');
    expect(document.body.textContent).not.toContain('sk-example-1234');
  });

  it('keeps prompt editors collapsed until opened and resets them only in the draft', async () => {
    const user = userEvent.setup();
    render(<SettingsView settings={{ ...settings, prompts: { ...defaultPromptTemplates, basePrompt: 'My custom base' } }} onSaved={vi.fn()} />);

    expect(screen.queryByLabelText('全域基礎 Prompt')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /全域與輸入 Prompt/ }));
    expect(screen.getByLabelText('全域基礎 Prompt')).toHaveValue('My custom base');

    await user.click(screen.getByRole('button', { name: '重設所有 Prompt' }));
    expect(screen.getByLabelText('全域基礎 Prompt')).toHaveValue(defaultPromptTemplates.basePrompt);
    expect(messageClient.saveSettings).not.toHaveBeenCalled();
  });

  it('saves one sanitized global patch and reports success', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    vi.mocked(messageClient.saveSettings).mockResolvedValue({
      ...settings,
      apiKeyLastFour: '9876',
    });
    render(<SettingsView settings={settings} onSaved={onSaved} />);

    await user.click(screen.getByRole('combobox', { name: 'OpenAI 模型' }));
    await user.click(screen.getByText('GPT-5.6 Terra（平衡）'));
    await user.click(screen.getByRole('combobox', { name: '推理強度' }));
    await user.click(screen.getByText('high'));
    await user.type(screen.getByLabelText('替換 OpenAI API Key'), 'replacement-9876');
    await user.click(screen.getByRole('button', { name: '儲存全部設定' }));

    await waitFor(() => expect(messageClient.saveSettings).toHaveBeenCalledTimes(1));
    expect(messageClient.saveSettings).toHaveBeenCalledWith(expect.objectContaining({
      apiKey: 'replacement-9876',
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high',
      prompts: defaultPromptTemplates,
    }));
    const patch = vi.mocked(messageClient.saveSettings).mock.calls[0][0];
    expect(patch).not.toHaveProperty('hasApiKey');
    expect(patch).not.toHaveProperty('apiKeyLastFour');
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ apiKeyLastFour: '9876' }));
    expect(await screen.findByRole('status')).toHaveTextContent('設定已儲存');
  });

  it('clears the key and updates the visible status immediately', async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<SettingsView settings={settings} onSaved={onSaved} />);

    await user.click(screen.getByRole('button', { name: '清除 API Key' }));

    await waitFor(() => expect(messageClient.clearApiKey).toHaveBeenCalledOnce());
    expect(onSaved).toHaveBeenCalledWith(expect.objectContaining({ hasApiKey: false, apiKeyLastFour: null }));
    expect(screen.getByLabelText('OpenAI API Key：尚未儲存')).toBeInTheDocument();
  });
});
