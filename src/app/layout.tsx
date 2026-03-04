import type { Metadata, Viewport } from "next";
import { headers } from "next/headers";
import { Plus_Jakarta_Sans, DM_Sans } from "next/font/google";
import { ThemeProvider } from "@/components/providers/theme-provider";
import { Toaster } from "@/components/ui/toaster";
import { ServiceWorkerRegistrar } from "@/components/service-worker-registrar";
import "@/styles/globals.css";

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-display",
  display: "swap",
});

const dmSans = DM_Sans({
  subsets: ["latin"],
  variable: "--font-body",
  display: "swap",
});

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
    "verified sellers",
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
  manifest: "/manifest.json",
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

  return (
    <html lang="en-ZA" suppressHydrationWarning>
      <body className={`${plusJakarta.variable} ${dmSans.variable} min-h-screen antialiased`}>
        {/* Polyfill __name for Turbopack keepNames output in inline scripts */}
        <script
          nonce={nonce}
          dangerouslySetInnerHTML={{
            __html:
              'if(typeof __name==="undefined")var __name=function(f,n){Object.defineProperty(f,"name",{value:n,configurable:!0});return f};',
          }}
        />
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
          <div id="main-content">{children}</div>
          <Toaster />
          <ServiceWorkerRegistrar />
        </ThemeProvider>
      </body>
    </html>
  );
}
