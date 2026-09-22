/**
 * Client instrumentation entrypoint.
 *
 * The Sentry browser SDK (~600 KB uncompressed including Session Replay) is
 * the single largest module in the first-load bundle, which hurts mobile
 * page loads on slow networks. Instead of importing it eagerly here — Next.js
 * bundles this file's static imports into the critical hydration chunks — we:
 *
 * 1. Install tiny early-error listeners immediately so nothing is lost.
 * 2. Dynamically import + initialise Sentry once the browser is idle
 *    (`requestIdleCallback`, with a `setTimeout` fallback for iOS Safari), or
 *    immediately when an early error occurs.
 * 3. Flush the buffered errors into Sentry after init.
 *
 * This keeps full error coverage while moving the Sentry download, parse, and
 * compile cost off the critical rendering path.
 */

import type * as SentryNextjs from "@sentry/nextjs";

type SentryModule = typeof SentryNextjs;

type BufferedError = {
  error: unknown;
  mechanism: "onerror" | "onunhandledrejection";
};

const MAX_BUFFERED_ERRORS = 10;
const SENTRY_IDLE_TIMEOUT_MS = 4000;
const SENTRY_FALLBACK_DELAY_MS = 2000;

const sentryDsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

let sentryModule: SentryModule | null = null;
let sentryLoadPromise: Promise<SentryModule | null> | null = null;
let bufferedErrors: BufferedError[] = [];
let bufferingActive = false;

function bufferError(error: unknown, mechanism: BufferedError["mechanism"]): void {
  if (!bufferingActive || bufferedErrors.length >= MAX_BUFFERED_ERRORS) return;
  bufferedErrors.push({ error, mechanism });
}

function initialiseSentry(Sentry: SentryModule): void {
  let initialised = false;
  try {
    Sentry.init({
      dsn: sentryDsn,

      // Use package version instead of git SHA to avoid leaking commit hashes
      release: `verifymzansi@${process.env.npm_package_version || "1.0.0"}`,

      // Only enable when DSN is configured
      enabled: !!sentryDsn,

      // Performance monitoring — sample 10% of transactions in production
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 1.0,

      // Session replay — capture 1% baseline, 100% on error
      replaysSessionSampleRate: 0.01,
      replaysOnErrorSampleRate: 1.0,

      integrations: (() => {
        try {
          return [Sentry.replayIntegration()];
        } catch {
          return [];
        }
      })(),

      // Scrub PII from breadcrumbs
      beforeBreadcrumb(breadcrumb) {
        if (breadcrumb.category === "xhr" || breadcrumb.category === "fetch") {
          const url = breadcrumb.data?.url as string | undefined;
          if (url && (url.includes("/api/otp") || url.includes("/api/auth"))) {
            breadcrumb.data = { ...breadcrumb.data, url: url.split("?")[0] };
          }
        }
        return breadcrumb;
      },
    });
    initialised = true;
  } catch {
    // Sentry initialisation must never crash the app — degrade silently.
    // iOS Safari may fail due to blob worker restrictions or CSP constraints.
  }

  if (!initialised) {
    // Keep the early-error listeners and buffer installed so a later trigger
    // still has reporting coverage; Sentry's own handlers are not active.
    return;
  }

  // Flush errors captured before the SDK finished loading, then hand error
  // reporting over to Sentry's own global handlers.
  const pending = bufferedErrors;
  bufferedErrors = [];
  bufferingActive = false;
  if (typeof window !== "undefined") {
    window.removeEventListener("error", handleEarlyError);
    window.removeEventListener("unhandledrejection", handleEarlyRejection);
  }
  for (const entry of pending) {
    try {
      if (entry.error instanceof Error) {
        Sentry.captureException(entry.error, {
          mechanism: { type: entry.mechanism, handled: false },
        });
      } else {
        Sentry.captureMessage(`Early ${entry.mechanism}: ${String(entry.error)}`, "error");
      }
    } catch {
      // Never let error reporting crash the app.
    }
  }
}

function ensureSentryLoaded(): Promise<SentryModule | null> {
  // No DSN configured (local dev, e2e) — never download the SDK.
  if (!sentryDsn) return Promise.resolve(null);
  if (sentryModule) return Promise.resolve(sentryModule);
  if (!sentryLoadPromise) {
    sentryLoadPromise = import("@sentry/nextjs")
      .then((mod) => {
        sentryModule = mod;
        initialiseSentry(mod);
        return mod;
      })
      .catch(() => {
        // Dynamic import failed (offline, chunk mismatch after a deploy).
        // Reset so a later trigger (error, navigation, idle) can retry instead
        // of latching onto a permanently failed load.
        sentryLoadPromise = null;
        return null;
      });
  }
  return sentryLoadPromise;
}

function handleEarlyError(event: ErrorEvent): void {
  bufferError(event.error ?? event.message, "onerror");
  // A crash is a strong signal: load Sentry immediately instead of waiting
  // for idle time so the failure is reported even if the user navigates away.
  void ensureSentryLoaded();
}

function handleEarlyRejection(event: PromiseRejectionEvent): void {
  bufferError(event.reason, "onunhandledrejection");
  void ensureSentryLoaded();
}

if (typeof window !== "undefined" && sentryDsn) {
  bufferingActive = true;
  window.addEventListener("error", handleEarlyError);
  window.addEventListener("unhandledrejection", handleEarlyRejection);

  const loadWhenIdle = () => {
    void ensureSentryLoaded();
  };

  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(loadWhenIdle, { timeout: SENTRY_IDLE_TIMEOUT_MS });
  } else if (document.readyState === "complete") {
    // iOS Safari lacks requestIdleCallback — wait for load, then settle.
    window.setTimeout(loadWhenIdle, SENTRY_FALLBACK_DELAY_MS);
  } else {
    window.addEventListener(
      "load",
      () => window.setTimeout(loadWhenIdle, SENTRY_FALLBACK_DELAY_MS),
      { once: true }
    );
  }
}

export function onRouterTransitionStart(
  ...args: Parameters<SentryModule["captureRouterTransitionStart"]>
): void {
  if (sentryModule) {
    sentryModule.captureRouterTransitionStart(...args);
    return;
  }
  void ensureSentryLoaded().then((mod) => {
    mod?.captureRouterTransitionStart(...args);
  });
}
