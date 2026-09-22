"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CHUNK_RECOVERY_SESSION_KEY = "vmz-chunk-recovery-v1";

/**
 * Report to Sentry lazily: a static `@sentry/nextjs` import here pins the
 * ~600 KB monitoring SDK into every page's critical bundle, which hurts
 * mobile load times. The dynamic import is cached once the deferred
 * instrumentation-client init has run, so this is usually instant.
 */
function reportError(error: Error): void {
  void import("@sentry/nextjs")
    .then((Sentry) => Sentry.captureException(error))
    .catch(() => {
      // Monitoring must never break the error boundary itself.
    });
}

function isLikelyChunkLoadError(error: Error) {
  const message = `${error.name ?? ""} ${error.message ?? ""} ${error.stack ?? ""}`.toLowerCase();

  return (
    message.includes("loading chunk") ||
    message.includes("chunkloaderror") ||
    message.includes("/_next/static/chunks/")
  );
}

async function clearDeploymentCaches() {
  const cacheCleanup =
    typeof caches !== "undefined"
      ? caches
          .keys()
          .then((keys) =>
            Promise.allSettled(
              keys.filter((key) => key.startsWith("verifymzansi-")).map((key) => caches.delete(key))
            )
          )
          .catch(() => undefined)
      : Promise.resolve();

  const workerCleanup =
    typeof navigator !== "undefined" && "serviceWorker" in navigator
      ? navigator.serviceWorker
          .getRegistrations()
          .then((registrations) =>
            Promise.allSettled(registrations.map((registration) => registration.unregister()))
          )
          .catch(() => undefined)
      : Promise.resolve();

  await Promise.allSettled([cacheCleanup, workerCleanup]);
}

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [debugVisible] = useState(() => {
    try {
      return (
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("debug") === "1"
      );
    } catch {
      return false;
    }
  });

  useEffect(() => {
    reportError(error);
    console.error("[GlobalError]", error.digest ?? error.message, error.stack);
  }, [error]);

  useEffect(() => {
    if (!isLikelyChunkLoadError(error)) {
      window.sessionStorage.removeItem(CHUNK_RECOVERY_SESSION_KEY);
      return;
    }

    if (window.sessionStorage.getItem(CHUNK_RECOVERY_SESSION_KEY) === "1") {
      return;
    }

    window.sessionStorage.setItem(CHUNK_RECOVERY_SESSION_KEY, "1");
    void clearDeploymentCaches().then(() => {
      window.location.replace(window.location.href);
    });
  }, [error]);

  const retry = () => {
    if (isLikelyChunkLoadError(error)) {
      void clearDeploymentCaches().then(() => {
        window.location.replace(window.location.href);
      });
      return;
    }

    reset();
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-16">
      <div className="hero-panel flex w-full max-w-lg flex-col items-center gap-6 px-6 py-10 text-center sm:px-10">
        <div className="flex h-16 w-16 items-center justify-center rounded-3xl border border-destructive/20 bg-destructive/10 shadow-xs">
          <AlertTriangle className="h-8 w-8 text-destructive" aria-hidden="true" />
        </div>
        <div className="space-y-2 max-w-md">
          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight">
            Something went wrong
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            An unexpected error occurred. Please try again or return to the homepage.
          </p>
          {error.digest && (
            <p className="text-xs text-muted-foreground">Error reference: {error.digest}</p>
          )}
          <p className="text-xs text-muted-foreground/60 break-all">
            {error.message || "(no message)"}
          </p>
          {debugVisible && (
            <pre
              className="mt-2 overflow-auto rounded-xl bg-neutral-100 p-3 text-left text-xs text-red-700 dark:bg-neutral-900 dark:text-red-400"
              aria-label="Error details"
            >
              {error.message}\n{error.stack ?? "(no stack)"}
            </pre>
          )}
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <Button
            variant="outline"
            className="rounded-full"
            onClick={() => window.location.assign(new URL("/", window.location.origin).toString())}
          >
            Go to homepage
          </Button>
          <Button variant="trust-verified" className="rounded-full font-semibold" onClick={retry}>
            Try Again
          </Button>
        </div>
      </div>
    </div>
  );
}
