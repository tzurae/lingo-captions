import { describe, expect, it, vi } from 'vitest';
import { initializeTrustedStorageAccess } from './storage-access';

describe('initializeTrustedStorageAccess', () => {
  it('restricts local storage to trusted extension contexts', async () => {
    const storage = {
      setAccessLevel: vi.fn().mockResolvedValue(undefined),
    };

    await initializeTrustedStorageAccess(storage);

    expect(storage.setAccessLevel).toHaveBeenCalledOnce();
    expect(storage.setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
  });

  it('contains initialization failures so the service worker remains alive', async () => {
    const failure = new Error('storage access unavailable');
    const storage = {
      setAccessLevel: vi.fn().mockRejectedValue(failure),
    };

    await expect(initializeTrustedStorageAccess(storage)).resolves.toBeUndefined();
  });
});
