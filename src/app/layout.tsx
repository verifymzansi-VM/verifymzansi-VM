import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { CSRF_HEADER_NAME } from "@/lib/utils/csrf";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { CsrfBootstrap } from "@/components/providers/csrf-bootstrap";
import { PublicRuntimeConfigBridge } from "@/components/providers/public-runtime-config";
import { VideoPlaybackProvider } from "@/contexts/video-playback-context";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { PwaInstallPrompt } from "@/components/pwa-install-prompt";
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
    .catch(() => {});
}
`;

export const metadata: Metadata = {
  title: {
    default: "VerifyMzansi — Promote With Trust",
    template: "%s | VerifyMzansi",
  },
  description:
    "Promote your products, services, and events across South Africa with verification-first visibility that helps customers discover brands with more confidence.",
  keywords: [
    "South Africa",
    "business promotion",
    "brand visibility",
    "verified businesses",
    "digital marketing",
    "advertise your business",
    "Mzansi",
    "trusted visibility",
  ],
  authors: [{ name: "VerifyMzansi" }],
  creator: "VerifyMzansi",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"),
  openGraph: {
    type: "website",
    locale: "en_ZA",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com",
    siteName: "VerifyMzansi",
    title: "VerifyMzansi — Promote With Trust",
    description:
      "Promote your products, services, and events across South Africa with verification-first visibility.",
    images: [
      {
        url: "/opengraph-image",
        width: 1200,
        height: 630,
        alt: "VerifyMzansi — Promote With Trust",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VerifyMzansi — Promote With Trust",
    description:
      "Promote your products, services, and events across South Africa with verification-first visibility.",
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
  const isPlaywrightTestMode = process.env.PLAYWRIGHT_TEST_MODE === "1";

  return (
    <html
      lang="en-ZA"
      suppressHydrationWarning
      data-playwright={isPlaywrightTestMode ? "1" : undefined}
    >
      <head>
        {/* Prevent iOS Safari from auto-detecting phone numbers, dates, emails,
            and addresses — it wraps detected content in <a> tags which causes
            React 19 hydration mismatches ("Something went wrong" crash). */}
        <meta name="format-detection" content="telephone=no, date=no, email=no, address=no" />
        {csrfToken ? <meta name="csrf-token" content={csrfToken} /> : null}
        {/* Early connection to media CDN — saves ~100-200 ms on first media load */}
        <link rel="preconnect" href="https://media.verifymzansi.com" />
        <link rel="dns-prefetch" href="https://media.verifymzansi.com" />
      </head>
      <body className="min-h-screen antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: TURBOPACK_NAME_POLYFILL }} />
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
        <CsrfBootstrap />
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <VideoPlaybackProvider>{children}</VideoPlaybackProvider>
          <Toaster />
          <PwaInstallPrompt />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
        <noscript>
          <div className="mx-auto max-w-[600px] p-8 text-center font-sans">
            <h1>JavaScript Required</h1>
            <p>
              VerifyMzansi requires JavaScript to function. Please enable JavaScript in your browser
              settings and reload the page.
            </p>
            <p className="mt-4 text-sm text-muted-foreground">
              You can still reach us at{" "}
              <a href="mailto:hello@verifymzansi.com" className="text-brand-green underline">
                hello@verifymzansi.com
              </a>{" "}
              or visit our{" "}
              <a href="/privacy" className="text-brand-green underline">
                Privacy Policy
              </a>{" "}
              and{" "}
              <a href="/terms" className="text-brand-green underline">
                Terms of Service
              </a>
              .
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
