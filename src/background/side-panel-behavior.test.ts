import { describe, expect, it, vi } from 'vitest';
import { registerTabSpecificSidePanel } from './side-panel-behavior';

type Tab = { id?: number };
type ActivatedInfo = { tabId: number };

function createChromeApis(currentTabs: Tab[] = [{ id: 42 }]) {
  let createdListener: ((tab: Tab) => void) | undefined;
  let activatedListener: ((info: ActivatedInfo) => void) | undefined;
  const calls: string[] = [];

  const sidePanel = {
    setPanelBehavior: vi.fn(async ({ openPanelOnActionClick }: { openPanelOnActionClick: boolean }) => {
      calls.push(`behavior:${openPanelOnActionClick}`);
    }),
    setOptions: vi.fn(async (options: { tabId?: number; path?: string; enabled: boolean }) => {
      calls.push(options.tabId === undefined ? 'global-panel-disabled' : `tab-panel:${options.tabId}`);
    }),
  };
  const action = {
    disable: vi.fn(async (tabId?: number) => {
      calls.push(tabId === undefined ? 'action-disabled' : `tab-action-disabled:${tabId}`);
    }),
    enable: vi.fn(async (tabId?: number) => {
      calls.push(tabId === undefined ? 'action-enabled' : `tab-action-enabled:${tabId}`);
    }),
  };
  const tabs = {
    query: vi.fn(async () => currentTabs),
    onCreated: {
      addListener: vi.fn((listener: (tab: Tab) => void) => { createdListener = listener; }),
    },
    onActivated: {
      addListener: vi.fn((listener: (info: ActivatedInfo) => void) => { activatedListener = listener; }),
    },
  };

  return {
    sidePanel,
    action,
    tabs,
    calls,
    getCreatedListener: () => createdListener,
    getActivatedListener: () => activatedListener,
  };
}

describe('tab-specific side panel registration', () => {
  it('preconfigures current tabs before enabling Chrome native action-to-panel behavior', async () => {
    const apis = createChromeApis([{ id: 42 }, {}, { id: 7 }]);

    const initialization = registerTabSpecificSidePanel(apis);

    expect(apis.tabs.onCreated.addListener).toHaveBeenCalledOnce();
    expect(apis.tabs.onActivated.addListener).toHaveBeenCalledOnce();
    await initialization;

    expect(apis.sidePanel.setOptions).toHaveBeenCalledWith({ enabled: false });
    expect(apis.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 42,
      path: 'src/sidepanel/index.html?tabId=42',
      enabled: true,
    });
    expect(apis.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 7,
      path: 'src/sidepanel/index.html?tabId=7',
      enabled: true,
    });
    expect(apis.sidePanel.setPanelBehavior).toHaveBeenCalledOnce();
    expect(apis.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
    expect(apis.calls).toEqual([
      'action-disabled',
      'global-panel-disabled',
      'tab-action-disabled:42',
      'tab-panel:42',
      'tab-action-enabled:42',
      'tab-action-disabled:7',
      'tab-panel:7',
      'tab-action-enabled:7',
      'behavior:true',
    ]);
  });

  it('preconfigures a newly created tab before enabling its action', async () => {
    const apis = createChromeApis([]);
    await registerTabSpecificSidePanel(apis);
    apis.calls.length = 0;

    apis.getCreatedListener()?.({ id: 99 });

    await vi.waitFor(() => expect(apis.action.enable).toHaveBeenCalledWith(99));
    expect(apis.calls).toEqual([
      'tab-action-disabled:99',
      'tab-panel:99',
      'tab-action-enabled:99',
    ]);
  });

  it('preconfigures an activated tab that was not present during initialization', async () => {
    const apis = createChromeApis([]);
    await registerTabSpecificSidePanel(apis);
    apis.calls.length = 0;

    apis.getActivatedListener()?.({ tabId: 88 });

    await vi.waitFor(() => expect(apis.action.enable).toHaveBeenCalledWith(88));
    expect(apis.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 88,
      path: 'src/sidepanel/index.html?tabId=88',
      enabled: true,
    });
  });

  it('keeps a tab action disabled when tab-specific configuration fails', async () => {
    const apis = createChromeApis([]);
    await registerTabSpecificSidePanel(apis);
    apis.sidePanel.setOptions.mockRejectedValueOnce(new Error('configuration failed'));

    apis.getCreatedListener()?.({ id: 101 });

    await vi.waitFor(() => expect(apis.sidePanel.setOptions).toHaveBeenCalledWith({
      tabId: 101,
      path: 'src/sidepanel/index.html?tabId=101',
      enabled: true,
    }));
    expect(apis.action.enable).not.toHaveBeenCalledWith(101);
  });

  it('ignores tabs without an integer id', async () => {
    const apis = createChromeApis([]);
    await registerTabSpecificSidePanel(apis);
    apis.sidePanel.setOptions.mockClear();

    apis.getCreatedListener()?.({});
    apis.getCreatedListener()?.({ id: 1.5 });
    await Promise.resolve();

    expect(apis.sidePanel.setOptions).not.toHaveBeenCalled();
  });
});
