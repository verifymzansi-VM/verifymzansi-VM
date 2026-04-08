import * as Sentry from "@sentry/nextjs";

try {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,

    // Use package version instead of git SHA to avoid leaking commit hashes
    release: `verifymzansi@${process.env.npm_package_version || "1.0.0"}`,

    // Only enable when DSN is configured
    enabled: !!process.env.NEXT_PUBLIC_SENTRY_DSN,

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
} catch {
  // Sentry initialisation must never crash the app — degrade silently.
  // iOS Safari may fail due to blob worker restrictions or CSP constraints.
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
