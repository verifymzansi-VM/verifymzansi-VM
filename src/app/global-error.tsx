"use client";

import { useEffect } from "react";
import { CloudOff } from "lucide-react";
import { SUPPORT_CONTACT_EMAIL } from "@/lib/contact-email";
// The root layout (and its stylesheet) is not rendered when this boundary is.
import "@/styles/globals.css";

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

/**
 * Global error boundary — catches errors thrown by the root layout itself.
 * Must include its own <html> and <body> tags since the root layout may
 * be unavailable when this renders.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    reportError(error);
    // Log error with structured data so monitoring tools (Cloudflare, Sentry, etc.) can ingest it.
    // Strip stack traces in production to avoid leaking internal paths in the browser console.
    console.error("[GlobalError]", {
      message: error.message,
      digest: error.digest,
      ...(process.env.NODE_ENV !== "production" && { stack: error.stack }),
    });
  }, [error]);
  return (
    <html lang="en">
      <body className="flex min-h-screen items-center justify-center bg-background px-4 py-12 font-body text-foreground antialiased">
        <main id="main-content" className="w-full max-w-md">
          <div className="hero-panel px-6 py-10 text-center sm:px-10">
            <div
              aria-hidden="true"
              className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-red/10 text-brand-red-700"
            >
              <CloudOff className="h-7 w-7" />
            </div>
            <h1 className="mt-5 font-display text-2xl font-bold tracking-tight">
              Something went wrong
            </h1>
            <p className="mt-2 text-[15px] leading-6 text-muted-foreground">
              It&apos;s usually temporary. Please try again.
            </p>
            <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
              <button
                type="button"
                onClick={reset}
                className="inline-flex h-11 items-center justify-center rounded-full bg-brand-green-600 px-6 text-sm font-semibold text-white transition-colors hover:bg-brand-green-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              >
                Try again
              </button>
            </div>
            <p className="mt-6 text-sm text-muted-foreground">
              Need help?{" "}
              <a
                href={`mailto:${SUPPORT_CONTACT_EMAIL}`}
                className="font-semibold text-brand-green-700 underline underline-offset-4"
              >
                Email support
              </a>
            </p>
            {error.digest && (
              <p className="mt-2 text-xs text-muted-foreground">Error reference: {error.digest}</p>
            )}
          </div>
        </main>
      </body>
    </html>
  );
}
