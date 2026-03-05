"use client";

import { useEffect } from "react";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("ServiceWorker");

/**
 * Registers the service worker on mount (production only).
 * Place this component in the root layout.
 */
export function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (typeof window !== "undefined" && "serviceWorker" in navigator) {
      if (process.env.NODE_ENV === "production") {
        navigator.serviceWorker.register("/sw.js").catch((err) => {
          log.warn("Registration failed", { error: String(err) });
        });
      } else {
        // In development, unregister any existing service worker
        // to prevent it from serving stale JS/CSS from cache.
        navigator.serviceWorker.getRegistrations().then((registrations) => {
          for (let registration of registrations) {
            registration.unregister().catch((err) => {
              log.warn("Unregistration failed", { error: String(err) });
            });
          }
        });
      }
    }
  }, []);

  return null;
}
