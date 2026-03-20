"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ServiceWorker");
const SERVICE_WORKER_VERSION = "20260312-logo-refresh";
const DEV_SW_CLEANUP_SESSION_KEY = "vm-dev-sw-cleanup-v1";

type CleanupDeps = {
  serviceWorker: Pick<ServiceWorkerContainer, "getRegistrations"> & {
    controller: ServiceWorker | null;
  };
  cacheStorage?: Pick<CacheStorage, "keys" | "delete">;
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  reload: () => void;
};

export async function cleanupDevServiceWorkers({
  serviceWorker,
  cacheStorage,
  storage,
  reload,
}: CleanupDeps): Promise<void> {
  const [registrations, cacheKeys] = await Promise.all([
    serviceWorker.getRegistrations().catch((err) => {
      log.warn("Failed to enumerate service workers", { error: String(err) });
      return [] as ServiceWorkerRegistration[];
    }),
    cacheStorage?.keys().catch((err) => {
      log.warn("Failed to enumerate cache storage", { error: String(err) });
      return [] as string[];
    }) ?? Promise.resolve([] as string[]),
  ]);

  const relevantCacheKeys = cacheKeys.filter((key) => key.startsWith("verifymzansi-"));
  const hadClientState =
    registrations.length > 0 || relevantCacheKeys.length > 0 || serviceWorker.controller !== null;

  await Promise.allSettled(
    registrations.map((registration) =>
      registration.unregister().catch((err) => {
        log.warn("Unregistration failed", { error: String(err) });
        return false;
      })
    )
  );

  if (cacheStorage && relevantCacheKeys.length > 0) {
    await Promise.allSettled(
      relevantCacheKeys.map((key) =>
        cacheStorage.delete(key).catch((err) => {
          log.warn("Cache deletion failed", { error: String(err), key });
          return false;
        })
      )
    );
  }

  const cleanupAttempted = storage.getItem(DEV_SW_CLEANUP_SESSION_KEY) === "1";
  if (hadClientState && !cleanupAttempted) {
    storage.setItem(DEV_SW_CLEANUP_SESSION_KEY, "1");
    reload();
    return;
  }

  if (cleanupAttempted) {
    storage.removeItem(DEV_SW_CLEANUP_SESSION_KEY);
  }
}

/**
 * Registers the service worker on mount (production only).
 * Place this component in the root layout.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.PLAYWRIGHT_TEST_MODE === "1") {
      return;
    }

    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker
          .register(`/sw.js?v=${SERVICE_WORKER_VERSION}`, { updateViaCache: "none" })
          .then((registration) => registration.update())
          .catch((err) => {
            log.warn("Registration failed", { error: String(err) });
          });
      } else {
        void cleanupDevServiceWorkers({
          serviceWorker: navigator.serviceWorker,
          cacheStorage: typeof caches !== "undefined" ? caches : undefined,
          storage: window.sessionStorage,
          reload: () => window.location.reload(),
        });
      }
    }
  }, []);

  return null;
}
