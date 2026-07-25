"use client";

import { useEffect, useState } from "react";
import * as Sentry from "@sentry/nextjs";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";

const CHUNK_RECOVERY_SESSION_KEY = "vmz-chunk-recovery-v1";

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
    Sentry.captureException(error);
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
    <div className="flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-destructive/10">
        <AlertTriangle className="h-7 w-7 text-destructive" />
      </div>
      <div className="space-y-2 max-w-md">
        <h1 className="text-lg sm:text-xl font-display font-bold">Something went wrong</h1>
        <p className="text-sm text-muted-foreground">
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
            className="mt-2 overflow-auto rounded-lg bg-neutral-100 p-3 text-left text-xs text-red-700 dark:bg-neutral-900 dark:text-red-400"
            aria-label="Error details"
          >
            {error.message}\n{error.stack ?? "(no stack)"}
          </pre>
        )}
      </div>
      <div className="flex gap-3">
        <Button variant="outline" onClick={() => (window.location.href = "/")}>
          Go to homepage
        </Button>
        <Button onClick={retry}>Try Again</Button>
      </div>
    </div>
  );
}
