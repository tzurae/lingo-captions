export type StorageAccessApi = {
  setAccessLevel(options: { accessLevel: 'TRUSTED_CONTEXTS' }): Promise<void>;
};

export async function initializeTrustedStorageAccess(storage: StorageAccessApi): Promise<void> {
  try {
    await storage.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
  } catch {
    // Storage hardening must not prevent the service worker from starting.
  }
}
