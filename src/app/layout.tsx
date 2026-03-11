import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import { MobilePostSticker } from "@/components/layout/mobile-post-sticker";
import "@/styles/globals.css";

export const metadata: Metadata = {
  title: {
    default: "VerifyMzansi — SA's Trusted Marketplace",
    template: "%s | VerifyMzansi",
  },
  description:
    "Buy & sell with people you can trust. South Africa's verification-first marketplace for classifieds, shops, and business services.",
  keywords: [
    "South Africa",
    "marketplace",
    "classifieds",
    "verified accounts",
    "buy and sell",
    "Mzansi",
    "trusted marketplace",
  ],
  authors: [{ name: "VerifyMzansi" }],
  creator: "VerifyMzansi",
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com"),
  openGraph: {
    type: "website",
    locale: "en_ZA",
    url: process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com",
    siteName: "VerifyMzansi",
    title: "VerifyMzansi — SA's Trusted Marketplace",
    description:
      "Buy & sell with people you can trust. South Africa's verification-first marketplace.",
    images: [
      {
        url: "/images/logo.png",
        width: 512,
        height: 512,
        alt: "VerifyMzansi — SA's Trusted Marketplace",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "VerifyMzansi — SA's Trusted Marketplace",
    description:
      "Buy & sell with people you can trust. South Africa's verification-first marketplace.",
    images: ["/images/logo.png"],
  },
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: [
      { url: "/favicon.ico?v=7", sizes: "32x32", type: "image/x-icon" },
      { url: "/icons/icon-16.png?v=7", sizes: "16x16", type: "image/png" },
      { url: "/icons/icon-32.png?v=7", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png?v=7", sizes: "192x192", type: "image/png" },
    ],
    apple: "/icons/icon-192.png?v=7",
  },
  manifest: "/manifest.json?v=7",
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
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const turbopackNamePolyfill =
    'if(typeof __name!=="function"){window.__name=function(fn,name){Object.defineProperty(fn,"name",{value:name,configurable:true});return fn;};}';

  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
        <script nonce={nonce} dangerouslySetInnerHTML={{ __html: turbopackNamePolyfill }} />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:absolute focus:z-[100] focus:top-2 focus:left-2 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground focus:outline-none"
        >
          Skip to main content
        </a>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
          nonce={nonce}
        >
          <main id="main-content">{children}</main>
          <MobilePostSticker />
          <Toaster />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
        <noscript>
          <div
            style={{ padding: "2rem", textAlign: "center", fontFamily: "system-ui, sans-serif" }}
          >
            <h1>JavaScript Required</h1>
            <p>
              VerifyMzansi requires JavaScript to function. Please enable JavaScript in your browser
              settings and reload the page.
            </p>
          </div>
        </noscript>
      </body>
    </html>
  );
}
