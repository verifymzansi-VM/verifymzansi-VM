/** @type {import('next').NextConfig} */

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Explicitly inline NEXT_PUBLIC_* vars into the client bundle.
  // Turbopack on Cloudflare may not replace process.env.NEXT_PUBLIC_*
  // at build time; the `env` field forces inlining.
  // Fallback values match wrangler.toml [vars] (all public/client-visible).
  env: {
    NEXT_PUBLIC_SUPABASE_URL:
      process.env.NEXT_PUBLIC_SUPABASE_URL || "https://tnygdgormnofpgjknlhr.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRueWdkZ29ybW5vZnBnamtubGhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzE0OTE3MTYsImV4cCI6MjA4NzA2NzcxNn0.HmPHCahnbYDoT0X8IbCsclCbhg3K2Mr0mlDa8RKFML0",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com",
    NEXT_PUBLIC_TURNSTILE_SITE_KEY:
      process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAACmVXwJ4jmJSu6fX",
    NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL || "https://media.verifymzansi.com",
    // Toggle Cloudflare Image Resizing (/cdn-cgi/image/). Set to "false"
    // if Image Resizing is not enabled on the zone — images will still
    // render but without on-the-fly format/size optimisation.
    NEXT_PUBLIC_CF_IMAGE_RESIZING: process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING || "false",
  },
  images: {
    // Cloudflare Workers/Pages does not support the default Next.js image
    // optimisation endpoint (/_next/image). Instead of disabling optimisation
    // entirely, we use a custom loader that routes through Cloudflare Image
    // Resizing (/cdn-cgi/image/) when available, producing responsive srcSets
    // with proper width/quality/format negotiation on mobile.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.verifymzansi.com",
      },
      {
        protocol: "https",
        hostname: "tnygdgormnofpgjknlhr.supabase.co",
      },
      {
        protocol: "https",
        hostname: "*.r2.cloudflarestorage.com",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "storage.googleapis.com",
      },
    ],
    formats: ["image/avif", "image/webp"],
  },
  serverExternalPackages: ["@aws-sdk/client-s3", "@aws-sdk/s3-request-presigner", "resend"],
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-tabs",
      "@radix-ui/react-toast",
    ],
  },
  async headers() {
    // Security headers (CSP, X-Frame-Options, etc.) are set per-request
    // in src/middleware.ts with a nonce-based CSP. Only cache headers remain here.
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "private, no-store, no-cache, must-revalidate",
          },
        ],
      },

      {
        source: "/images/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400",
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
