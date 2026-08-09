import type { RequestMessage } from '../domain/types';
import { OpenAIClient } from '../llm/openai-client';
import { ConfiguredPromptRegistry } from '../llm/prompt-registry';
import { IndexedDbHistoryRepository } from '../storage/indexeddb-history-repository';
import { ChromeStorageSettingsStore } from '../storage/settings-store';
import { WorkflowRunner } from '../workflows/workflow-runner';
import { MessageRouter } from './message-router';
import { registerTabSpecificSidePanel } from './side-panel-behavior';
import { initializeTrustedStorageAccess } from './storage-access';

void initializeTrustedStorageAccess(chrome.storage.local);

const settingsStore = new ChromeStorageSettingsStore(chrome.storage.local);
const historyRepository = new IndexedDbHistoryRepository();
const router = new MessageRouter({
  settingsStore,
  historyRepository,
  workflowFactory: (settings) => new WorkflowRunner(new OpenAIClient({
    apiKey: settings.apiKey,
    model: settings.model,
    reasoningEffort: settings.reasoningEffort,
    promptRegistry: new ConfiguredPromptRegistry(settings.prompts),
  })),
});

if (
  typeof chrome.sidePanel?.setPanelBehavior === 'function'
  && typeof chrome.sidePanel.setOptions === 'function'
  && typeof chrome.action?.disable === 'function'
  && typeof chrome.action.enable === 'function'
  && typeof chrome.tabs?.query === 'function'
) {
  void registerTabSpecificSidePanel({
    sidePanel: chrome.sidePanel,
    action: chrome.action,
    tabs: chrome.tabs,
  }).catch(() => undefined);
}

chrome.runtime.onMessage.addListener((message: RequestMessage, _sender, sendResponse) => {
  void router.handle(message).then(sendResponse);
  return true;
});
