"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { CloudOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BrandLogo } from "@/components/shared/brand-logo";
import { StatePanel, StatePanelPage } from "@/components/shared/state-panel";

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
    <div className="flex min-h-screen flex-col bg-hero-mesh">
      <div className="container-page flex h-16 items-center">
        <Link
          href="/"
          aria-label="VerifyMzansi home"
          className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          <BrandLogo size="sm" />
        </Link>
      </div>
      <StatePanelPage>
        <StatePanel
          tone="error"
          icon={<CloudOff />}
          title="Something went wrong"
          description="It's usually temporary. Please try again."
          actions={
            <>
              <Button variant="trust-verified" onClick={retry}>
                Try again
              </Button>
            </>
          }
          showNextSteps
          footnote={
            <details open={debugVisible} className="group">
              <summary className="inline-flex min-h-11 cursor-pointer items-center font-medium text-foreground/80 hover:text-foreground">
                Technical details
              </summary>
              <div className="space-y-1 pb-1">
                {error.digest ? <p>Error reference: {error.digest}</p> : null}
                <p className="break-all">{error.message || "(no message)"}</p>
                {debugVisible ? (
                  <pre
                    className="mt-2 overflow-auto rounded-xl bg-muted p-3 text-left text-xs text-brand-red-700 dark:text-brand-red-300"
                    aria-label="Error details"
                  >
                    {`${error.message}\n${error.stack ?? "(no stack)"}`}
                  </pre>
                ) : null}
              </div>
            </details>
          }
        />
      </StatePanelPage>
    </div>
  );
}
