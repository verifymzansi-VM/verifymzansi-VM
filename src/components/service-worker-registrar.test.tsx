/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupDevServiceWorkers } from "./service-worker-registrar";

describe("cleanupDevServiceWorkers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unregisters stale registrations, clears VerifyMzansi caches, and reloads once", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const deleteCache = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();

    const storage = {
      getItem: vi.fn().mockReturnValue(null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await cleanupDevServiceWorkers({
      serviceWorker: {
        controller: {} as ServiceWorker,
        getRegistrations: vi
          .fn()
          .mockResolvedValue([{ unregister }] as unknown as ServiceWorkerRegistration[]),
      },
      cacheStorage: {
        keys: vi.fn().mockResolvedValue(["verifymzansi-v3-logo-refresh", "other-cache"]),
        delete: deleteCache,
      },
      storage,
      reload,
    });

    expect(unregister).toHaveBeenCalledTimes(1);
    expect(deleteCache).toHaveBeenCalledWith("verifymzansi-v3-logo-refresh");
    expect(deleteCache).not.toHaveBeenCalledWith("other-cache");
    expect(storage.setItem).toHaveBeenCalledWith("vm-dev-sw-cleanup-v1", "1");
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again after cleanup was already attempted", async () => {
    const unregister = vi.fn().mockResolvedValue(true);
    const reload = vi.fn();

    const storage = {
      getItem: vi.fn().mockReturnValue("1"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await cleanupDevServiceWorkers({
      serviceWorker: {
        controller: null,
        getRegistrations: vi
          .fn()
          .mockResolvedValue([{ unregister }] as unknown as ServiceWorkerRegistration[]),
      },
      cacheStorage: {
        keys: vi.fn().mockResolvedValue(["verifymzansi-v3-logo-refresh"]),
        delete: vi.fn().mockResolvedValue(true),
      },
      storage,
      reload,
    });

    expect(reload).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith("vm-dev-sw-cleanup-v1");
  });

  it("clears the cleanup marker when no stale state remains", async () => {
    const reload = vi.fn();

    const storage = {
      getItem: vi.fn().mockReturnValue("1"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };

    await cleanupDevServiceWorkers({
      serviceWorker: {
        controller: null,
        getRegistrations: vi.fn().mockResolvedValue([] as ServiceWorkerRegistration[]),
      },
      cacheStorage: {
        keys: vi.fn().mockResolvedValue([] as string[]),
        delete: vi.fn().mockResolvedValue(true),
      },
      storage,
      reload,
    });

    expect(reload).not.toHaveBeenCalled();
    expect(storage.removeItem).toHaveBeenCalledWith("vm-dev-sw-cleanup-v1");
  });
});

describe("production service worker auth routes", () => {
  it("keeps auth pages network-only so stale cached loading shells are not served", () => {
    const serviceWorkerSource = readFileSync(join(process.cwd(), "public", "sw.js"), "utf8");

    expect(serviceWorkerSource).toContain('"/login"');
    expect(serviceWorkerSource).toContain('"/register"');
    expect(serviceWorkerSource).toContain('"/forgot-password"');
    expect(serviceWorkerSource).toContain('"/reset-password"');
    expect(serviceWorkerSource).toContain("networkOnlyWithOffline(request)");
  });
});
