import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Inter, Sora } from "next/font/google";
import { CSRF_HEADER_NAME } from "@/lib/utils/csrf";

const fontDisplay = Sora({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
  fallback: ["Segoe UI", "Trebuchet MS", "system-ui", "sans-serif"],
});

const fontBody = Inter({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
  fallback: ["Segoe UI", "system-ui", "sans-serif"],
});
import { ThemeProvider } from "@/components/providers/theme-provider";
import { PublicRuntimeConfigBridge } from "@/components/providers/public-runtime-config";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
import { DesktopPageShell } from "@/components/layout/desktop-page-shell";
import { HELLO_CONTACT_EMAIL } from "@/lib/contact-email";
import { VERIFY_MZANSI_SITE_DESCRIPTION } from "@/lib/seo/public-categories";
import "@/styles/globals.css";

const TURBOPACK_NAME_POLYFILL =
  'if(typeof globalThis.__name!=="function"){globalThis.__name=function(fn,name){Object.defineProperty(fn,"name",{value:name,configurable:true});return fn;};}var __name=globalThis.__name;';

const DEV_SW_CACHE_RESET = `
if (typeof window !== "undefined" && "serviceWorker" in navigator) {
  const cleanupKey = "vm-dev-inline-sw-reset-v1";
  const cleanupAttempted = window.sessionStorage.getItem(cleanupKey) === "1";
  Promise.all([
    navigator.serviceWorker.getRegistrations().catch(() => []),
    typeof caches !== "undefined" ? caches.keys().catch(() => []) : Promise.resolve([]),
  ])
    .then(async ([registrations, cacheKeys]) => {
      const relevantCacheKeys = cacheKeys.filter((key) => key.startsWith("verifymzansi-"));
      const hadStaleState =
        registrations.length > 0 || relevantCacheKeys.length > 0 || navigator.serviceWorker.controller;

      await Promise.allSettled(registrations.map((registration) => registration.unregister()));

      if (typeof caches !== "undefined") {
        await Promise.allSettled(relevantCacheKeys.map((key) => caches.delete(key)));
      }

      if (hadStaleState && !cleanupAttempted) {
        window.sessionStorage.setItem(cleanupKey, "1");
        window.location.reload();
        return;
      }

      if (cleanupAttempted) {
        window.sessionStorage.removeItem(cleanupKey);
      }
    })
    .catch((err) => {
      console.warn("[VerifyMzansi] Dev service-worker cleanup failed", err);
    });
}
`;

const AUTH_SW_CACHE_RESET = `
(function () {
  if (typeof window === "undefined") return;

  var marker = "vmzAuthCacheReset";
  var url = new URL(window.location.href);
  var markerPresent = url.searchParams.get(marker) === "1";

  if (markerPresent) {
    url.searchParams.delete(marker);
    window.history.replaceState({}, "", url.pathname + url.search + url.hash);
    return;
  }

  var clearCaches =
    typeof caches !== "undefined"
      ? caches
          .keys()
          .then(function (keys) {
            return Promise.allSettled(
              keys
                .filter(function (key) {
                  return key.indexOf("verifymzansi-") === 0;
                })
                .map(function (key) {
                  return caches.delete(key);
                })
            );
          })
          .catch(function () {})
      : Promise.resolve();

  var clearWorkers =
    "serviceWorker" in navigator
      ? navigator.serviceWorker
          .getRegistrations()
          .then(function (registrations) {
            return Promise.allSettled(
              registrations.map(function (registration) {
                return registration.unregister();
              })
            );
          })
          .catch(function () {})
      : Promise.resolve();

  Promise.allSettled([clearCaches, clearWorkers]).then(function () {
    url.searchParams.set(marker, "1");
    window.location.replace(url.toString());
  });
})();
`;

export const metadata: Metadata = {
  title: {
    default: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
    template: "%s | VerifyMzansi",
  },
  description: VERIFY_MZANSI_SITE_DESCRIPTION,
  keywords: [
    "South Africa",
    "verified marketplace",
    "classified ads",
    "business directory",
    "business profiles",
    "tourism destinations",
    "events in South Africa",
    "accommodation",
    "local services",
    "Mzansi",
    "VerifyMzansi",
  ],
  authors: [{ name: "VerifyMzansi" }],
  creator: "VerifyMzansi",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"),
  openGraph: {
    type: "website",
    locale: "en_ZA",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com",
    siteName: "VerifyMzansi",
    title: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
    description: VERIFY_MZANSI_SITE_DESCRIPTION,
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VerifyMzansi - Mzansi Market, Mzansi Business, Tourism and Events",
    description: VERIFY_MZANSI_SITE_DESCRIPTION,
    images: ["/twitter-image"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=10", sizes: "32x32", type: "image/x-icon" },
      { url: "/icons/icon-16.png?v=10", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-192.png?v=10", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png?v=10", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png?v=10",
  },
  manifest: "/manifest.json?v=10",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf8f5" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1714" },
  ],
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const hdrs = await headers();
  const nonce = hdrs.get("x-nonce") ?? undefined;
  const csrfToken = hdrs.get(CSRF_HEADER_NAME) ?? undefined;
  const currentPathname = hdrs.get("x-current-pathname") ?? "";
  const shouldResetAuthCache =
    currentPathname === "/login" ||
    currentPathname === "/register" ||
    currentPathname === "/forgot-password" ||
    currentPathname === "/reset-password" ||
    currentPathname.startsWith("/auth/");
  const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";

  return (
    <html
      lang="en-ZA"
      suppressHydrationWarning
      data-playwright={isPlaywrightTestMode ? "1" : undefined}
      className={`${fontDisplay.variable} ${fontBody.variable}`}
    >
      <head>
        {/* Prevent iOS Safari from auto-detecting phone numbers, dates, emails,
            and addresses — it wraps detected content in <a> tags which causes
            React 19 hydration mismatches ("Something went wrong" crash). */}
        <meta name="format-detection" content="telephone=no, date=no, email=no, address=no" />
        {csrfToken ? <meta name="csrf-token" content={csrfToken} /> : null}
      </head>
      <body className="min-h-screen antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: TURBOPACK_NAME_POLYFILL }} />
        {shouldResetAuthCache ? (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: AUTH_SW_CACHE_RESET }} />
        ) : null}
        {process.env.NODE_ENV === "development" ? (
          <script nonce={nonce} dangerouslySetInnerHTML={{ __html: DEV_SW_CACHE_RESET }} />
        ) : null}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          Skip to main content
        </a>
        <PublicRuntimeConfigBridge />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <DesktopPageShell>
            <VideoPlaybackProvider>{children}</VideoPlaybackProvider>
            <Toaster />
            <PwaInstallPrompt />
            <ServiceWorkerRegistrar />
          </DesktopPageShell>
        </ThemeProvider>
        <noscript>
          <div className="mx-auto max-w-[600px] p-8 text-center font-sans">
            <h1>Interactive Features Need JavaScript</h1>
            <p>
              You can read public trust, legal, privacy, and safety pages without signing in.
              Posting, verification, payments, dashboards, and reports need JavaScript enabled.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              For help, contact{" "}
              <a href={`mailto:${HELLO_CONTACT_EMAIL}`} className="text-brand-green underline">
                {HELLO_CONTACT_EMAIL}
              </a>{" "}
              or open{" "}
              <a href="/trust-safety" className="text-brand-green underline">
                Trust & Safety
              </a>
              ,{" "}
              <a href="/privacy" className="text-brand-green underline">
                Privacy
              </a>{" "}
              or{" "}
              <a href="/terms" className="text-brand-green underline">
                Terms
              </a>
              .
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
