export function readOwnerTabId(search: string): number | undefined {
  const value = new URLSearchParams(search).get('tabId');
  if (value === null || value.trim() === '') return undefined;
  const tabId = Number(value);
  return Number.isFinite(tabId) && Number.isInteger(tabId) && tabId >= 0 ? tabId : undefined;
}
