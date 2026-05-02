"use client";

import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

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
    Sentry.captureException(error);
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
      <body className="flex min-h-screen items-center justify-center bg-white dark:bg-neutral-950 text-gray-900 dark:text-gray-100">
        <div className="max-w-md text-center px-6">
          <h1 className="text-2xl font-bold mb-4">Something went wrong</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {error.digest && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-4">
              Error reference: {error.digest}
            </p>
          )}
          <div className="flex justify-center gap-3">
            <button
              onClick={() => (window.location.href = "/")}
              className="rounded-md border border-gray-300 dark:border-gray-600 px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
            >
              Go to homepage
            </button>
            <button
              onClick={reset}
              className="rounded-md bg-brand-green px-4 py-2 text-sm font-medium text-white hover:bg-brand-green/90 transition-colors"
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
