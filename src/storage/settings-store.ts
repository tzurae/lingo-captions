import type { OpenAIModel, ReasoningEffort, Settings } from '../domain/types';
import { defaultPromptTemplates } from '../llm/prompt-templates';

export type StorageAreaLike = {
  get(keys?: string[] | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
};

export interface SettingsStore {
  get(): Promise<Settings>;
  update(patch: Partial<Settings>): Promise<Settings>;
  clearApiKey(): Promise<void>;
}

export const defaultSettings: Settings = {
  apiKey: '',
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
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function containsPatchValue(actual: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) {
    return Array.isArray(actual)
      && actual.length === expected.length
      && expected.every((item, index) => containsPatchValue(actual[index], item));
  }
  if (isRecord(expected)) {
    return isRecord(actual)
      && Object.entries(expected).every(([key, value]) => containsPatchValue(actual[key], value));
  }
  return Object.is(actual, expected);
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberValue(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function openAIModelValue(value: unknown): OpenAIModel {
  return value === 'gpt-5.6-luna' || value === 'gpt-5.6-terra' || value === 'gpt-5.6-sol'
    ? value
    : defaultSettings.model;
}

function reasoningEffortValue(value: unknown): ReasoningEffort {
  return value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh' || value === 'max'
    ? value
    : defaultSettings.reasoningEffort;
}

function normalizeSettings(stored: Record<string, unknown>): Settings {
  const storedPrompts = isRecord(stored.prompts) ? stored.prompts : {};
  const storedIntentPrompts = isRecord(storedPrompts.intentPrompts) ? storedPrompts.intentPrompts : {};
  const intentPrompts = { ...defaultPromptTemplates.intentPrompts };

  for (const intent of Object.keys(intentPrompts) as Array<keyof typeof intentPrompts>) {
    if (typeof storedIntentPrompts[intent] === 'string') {
      intentPrompts[intent] = storedIntentPrompts[intent];
    }
  }

  const detailLevel = stored.detailLevel === 'brief' || stored.detailLevel === 'normal' || stored.detailLevel === 'detailed'
    ? stored.detailLevel
    : defaultSettings.detailLevel;

  return {
    apiKey: stringValue(stored.apiKey, defaultSettings.apiKey),
    model: openAIModelValue(stored.model),
    reasoningEffort: reasoningEffortValue(stored.reasoningEffort),
    outputLanguage: stringValue(stored.outputLanguage, defaultSettings.outputLanguage),
    detailLevel,
    contextLines: numberValue(stored.contextLines, defaultSettings.contextLines),
    fontSize: numberValue(stored.fontSize, defaultSettings.fontSize),
    textColor: stringValue(stored.textColor, defaultSettings.textColor),
    activeCueColor: stringValue(stored.activeCueColor, defaultSettings.activeCueColor),
    autoFollowPlayback: typeof stored.autoFollowPlayback === 'boolean'
      ? stored.autoFollowPlayback
      : defaultSettings.autoFollowPlayback,
    prompts: {
      basePrompt: stringValue(storedPrompts.basePrompt, defaultPromptTemplates.basePrompt),
      inputPrompt: stringValue(storedPrompts.inputPrompt, defaultPromptTemplates.inputPrompt),
      intentPrompts,
    },
  };
}

export class ChromeStorageSettingsStore implements SettingsStore {
  constructor(private readonly storageArea: StorageAreaLike) {}

  async get(): Promise<Settings> {
    const stored = await this.storageArea.get();
    return normalizeSettings(stored);
  }

  async update(patch: Partial<Settings>): Promise<Settings> {
    await this.storageArea.set(patch);
    const stored = await this.storageArea.get();
    if (!containsPatchValue(stored, patch)) {
      throw new Error('Settings could not be verified after saving.');
    }
    return normalizeSettings(stored);
  }

  async clearApiKey(): Promise<void> {
    await this.storageArea.remove('apiKey');
  }
}
