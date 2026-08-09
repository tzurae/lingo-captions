export type SidePanelApi = {
  setPanelBehavior(options: { openPanelOnActionClick: boolean }): Promise<void>;
  setOptions(options: { tabId?: number; path?: string; enabled: boolean }): Promise<void>;
};

export type ActionApi = {
  disable(tabId?: number): Promise<void>;
  enable(tabId?: number): Promise<void>;
};

export type TabsApi = {
  query(queryInfo: Record<string, never>): Promise<Array<{ id?: number }>>;
  onCreated: {
    addListener(listener: (tab: { id?: number }) => void): void;
  };
  onActivated: {
    addListener(listener: (activeInfo: { tabId: number }) => void): void;
  };
};

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

export function registerTabSpecificSidePanel({
  sidePanel,
  action,
  tabs,
}: {
  sidePanel: SidePanelApi;
  action: ActionApi;
  tabs: TabsApi;
}): Promise<void> {
  const configureTab = async (tabId: number): Promise<void> => {
    await action.disable(tabId);
    await sidePanel.setOptions({
      tabId,
      path: `src/sidepanel/index.html?tabId=${tabId}`,
      enabled: true,
    });
    await action.enable(tabId);
  };

  tabs.onCreated.addListener((tab) => {
    if (!isTabId(tab.id)) return;
    void configureTab(tab.id).catch(() => undefined);
  });
  tabs.onActivated.addListener((activeInfo) => {
    if (!isTabId(activeInfo.tabId)) return;
    void configureTab(activeInfo.tabId).catch(() => undefined);
  });

  return action.disable()
    .then(() => sidePanel.setOptions({ enabled: false }))
    .then(() => tabs.query({}))
    .then(async (currentTabs) => {
      for (const tab of currentTabs) {
        if (isTabId(tab.id)) await configureTab(tab.id);
      }
    })
    .then(() => sidePanel.setPanelBehavior({ openPanelOnActionClick: true }));
}
