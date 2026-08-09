import { describe, expect, it } from 'vitest';
import type { Settings } from '../domain/types';
import { defaultPromptTemplates } from '../llm/prompt-templates';
import { ChromeStorageSettingsStore, type StorageAreaLike } from './settings-store';

class MemoryStorageArea implements StorageAreaLike {
  values: Record<string, unknown>;

  constructor(values: Record<string, unknown> = {}) {
    this.values = { ...values };
  }

  async get(): Promise<Record<string, unknown>> {
    return { ...this.values };
  }

  async set(items: Record<string, unknown>): Promise<void> {
    Object.assign(this.values, items);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of Array.isArray(keys) ? keys : [keys]) {
      delete this.values[key];
    }
  }
}

const defaults: Settings = {
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

describe('ChromeStorageSettingsStore', () => {
  it('retains the API key and font size when the store is reconstructed', async () => {
    const storage = new MemoryStorageArea();
    const firstStore = new ChromeStorageSettingsStore(storage);

    await firstStore.update({ apiKey: 'secret-9876', fontSize: 22 });
    const reconstructedStore = new ChromeStorageSettingsStore(storage);

    await expect(reconstructedStore.get()).resolves.toMatchObject({
      apiKey: 'secret-9876',
      fontSize: 22,
    });
  });

  it('rejects an API key save when storage read-back does not contain the supplied key', async () => {
    const storage = new MemoryStorageArea();
    storage.set = async (items) => {
      const { apiKey: _apiKey, ...persistedItems } = items;
      Object.assign(storage.values, persistedItems);
    };
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.update({ apiKey: 'secret-9876', fontSize: 22 }))
      .rejects.toThrow('Settings could not be verified after saving.');
  });

  it('rejects a dropped write even when the supplied value equals a normalized default', async () => {
    const storage = new MemoryStorageArea();
    storage.set = async (items) => {
      const { model: _model, ...persistedItems } = items;
      Object.assign(storage.values, persistedItems);
    };
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.update({ model: 'gpt-5.6-luna' }))
      .rejects.toThrow('Settings could not be verified after saving.');
  });

  it('returns defaults when storage is empty', async () => {
    const store = new ChromeStorageSettingsStore(new MemoryStorageArea());

    await expect(store.get()).resolves.toEqual(defaults);
  });

  it('defaults the global OpenAI controls to Luna with low reasoning', async () => {
    const store = new ChromeStorageSettingsStore(new MemoryStorageArea());

    await expect(store.get()).resolves.toMatchObject({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
    });
  });

  it('preserves valid Sol and max global OpenAI controls', async () => {
    const store = new ChromeStorageSettingsStore(new MemoryStorageArea({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
    }));

    await expect(store.get()).resolves.toMatchObject({
      model: 'gpt-5.6-sol',
      reasoningEffort: 'max',
    });
  });

  it('falls back when stored global OpenAI controls are invalid', async () => {
    const store = new ChromeStorageSettingsStore(new MemoryStorageArea({
      model: 'saved-model',
      reasoningEffort: 'unsupported',
    }));

    await expect(store.get()).resolves.toMatchObject({
      model: 'gpt-5.6-luna',
      reasoningEffort: 'low',
    });
  });

  it('normalizes stale model data and deep-merges a partial intent prompt with every default', async () => {
    const storage = new MemoryStorageArea({
      model: 'saved-model',
      fontSize: 18,
      prompts: { intentPrompts: { grammar: 'Use my grammar instructions.' } },
    });
    const store = new ChromeStorageSettingsStore(storage);

    const settings = await store.update({ contextLines: 3 });

    expect(settings).toEqual({
      ...defaults,
      fontSize: 18,
      contextLines: 3,
      prompts: {
        ...defaultPromptTemplates,
        intentPrompts: {
          ...defaultPromptTemplates.intentPrompts,
          grammar: 'Use my grammar instructions.',
        },
      },
    });
    expect(storage.values).toEqual({
      model: 'saved-model',
      fontSize: 18,
      contextLines: 3,
      prompts: { intentPrompts: { grammar: 'Use my grammar instructions.' } },
    });
  });

  it('persists a complete prompt update without removing unrelated settings', async () => {
    const storage = new MemoryStorageArea({ fontSize: 18 });
    const store = new ChromeStorageSettingsStore(storage);
    const prompts = {
      ...defaultPromptTemplates,
      basePrompt: 'My base {{intentPrompt}}',
    };

    const settings = await store.update({ prompts });

    expect(settings.fontSize).toBe(18);
    expect(settings.prompts).toEqual(prompts);
    expect(storage.values).toEqual({ fontSize: 18, prompts });
  });

  it('clears only the API key', async () => {
    const storage = new MemoryStorageArea({ apiKey: 'secret', model: 'saved-model' });
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.clearApiKey()).resolves.toBeUndefined();

    expect(storage.values).toEqual({ model: 'saved-model' });
  });

  it('propagates storage failures', async () => {
    const storage: StorageAreaLike = {
      get: async () => {
        throw new Error('storage unavailable');
      },
      set: async () => undefined,
      remove: async () => undefined,
    };
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.get()).rejects.toThrow('storage unavailable');
  });

  it('propagates a storage write failure from update', async () => {
    const storage: StorageAreaLike = {
      get: async () => ({}),
      set: async () => {
        throw new Error('write unavailable');
      },
      remove: async () => undefined,
    };
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.update({ fontSize: 18 })).rejects.toThrow('write unavailable');
  });

  it('propagates a storage removal failure from clearApiKey', async () => {
    const storage: StorageAreaLike = {
      get: async () => ({}),
      set: async () => undefined,
      remove: async () => {
        throw new Error('remove unavailable');
      },
    };
    const store = new ChromeStorageSettingsStore(storage);

    await expect(store.clearApiKey()).rejects.toThrow('remove unavailable');
  });
});
