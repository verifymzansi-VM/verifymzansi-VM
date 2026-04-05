/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs");

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

const sharpServerExternalPackages = [
  "sharp",
  "@img/sharp-linux-x64",
  "@img/sharp-linuxmusl-x64",
  "@img/sharp-linux-arm64",
  "@img/sharp-linuxmusl-arm64",
  "@img/sharp-win32-x64",
  "@img/sharp-darwin-x64",
  "@img/sharp-darwin-arm64",
];

const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Keep native sharp packages external so OpenNext/esbuild does not
  // attempt to resolve hashed sharp bundle specifiers on Cloudflare.
  serverExternalPackages: sharpServerExternalPackages,
  // Disable the Next.js devtools indicator so localhost matches production
  // without the floating `N` badge and bottom drawer dimming the page.
  devIndicators: false,
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
    // Full CSP with nonce is applied by the Cloudflare Workers proxy
    // (proxy-handler.ts). The headers below are defense-in-depth: they
    // protect against direct-origin access (DNS leak, staging, etc.).
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Allow camera access on the verification page for selfie / ID capture
        source: "/verification",
        headers: [
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
        ],
      },
      {
        // Media proxy serves R2 objects with long-lived immutable headers;
        // exclude it from the generic no-cache rule so browsers and CDN can
        // cache video responses served through the proxy.
        source: "/api/media/serve/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
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

module.exports = withSentryConfig(nextConfig, {
  // Suppress source map upload warnings when SENTRY_AUTH_TOKEN is not set
  silent: !process.env.SENTRY_AUTH_TOKEN,

  // Upload source maps for better stack traces
  widenClientFileUpload: true,

  webpack: {
    treeshake: {
      removeDebugLogging: true,
    },
  },

  // Hide source maps from users
  hideSourceMaps: true,

  // Automatically tree-shake Sentry logger statements to reduce bundle size
  disableServerWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
  disableClientWebpackPlugin: !process.env.SENTRY_AUTH_TOKEN,
});
