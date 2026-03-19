/** @type {import('next').NextConfig} */
const clientEnv = Object.fromEntries(
  Object.entries({
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY,
    NEXT_PUBLIC_MEDIA_URL: process.env.NEXT_PUBLIC_MEDIA_URL,
    NEXT_PUBLIC_CF_IMAGE_RESIZING: process.env.NEXT_PUBLIC_CF_IMAGE_RESIZING,
  }).filter(([, value]) => typeof value === "string" && value.length > 0)
);

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Explicitly inline NEXT_PUBLIC_* vars into the client bundle.
  // Turbopack on Cloudflare may not replace process.env.NEXT_PUBLIC_*
  // at build time; the `env` field forces inlining without masking missing config.
  env: clientEnv,
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
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
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
    // in src/middleware.ts via the shared proxy-handler nonce/CSP logic.
    // Only cache headers remain here.
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
