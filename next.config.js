/** @type {import('next').NextConfig} */
const { withSentryConfig } = require("@sentry/nextjs/config");
const { shouldSkipNextTypecheck } = require("./scripts/lib/next-typecheck-skip.cjs");
// The retired ("source") backend has been removed. A leftover backend setting
// fails the build instead of passing silently.
if (
  process.env.NEXT_PUBLIC_DATA_BACKEND !== undefined &&
  process.env.NEXT_PUBLIC_DATA_BACKEND !== "foundation"
)
  throw new Error("The retired backend has been removed; unset NEXT_PUBLIC_DATA_BACKEND");
// Builds use only the approved London project, or the isolated local test copy.
(function assertApprovedPublicConnection() {
  let targetUrl;
  try {
    targetUrl = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "invalid");
  } catch {
    throw new Error("Foundation builds require the approved public connection");
  }
  const hosted = targetUrl.origin === "https://gntzjtuncsyefujajmjy.supabase.co";
  const local =
    process.env.ENVIRONMENT === "test" &&
    process.env.VERIFYMZANSI_RUNTIME_MODE === "e2e" &&
    targetUrl.protocol === "http:" &&
    targetUrl.hostname === "127.0.0.1" &&
    ["55441", "55443"].includes(targetUrl.port);
  let localApp = false;
  if (local) {
    try {
      const appUrl = new URL(process.env.NEXT_PUBLIC_APP_URL || "invalid");
      localApp = appUrl.protocol === "http:" && appUrl.hostname === "127.0.0.1";
    } catch {
      // Invalid local settings use the same non-disclosing configuration error.
    }
  }
  if (
    (!hosted && !local) ||
    (local && !localApp) ||
    targetUrl.pathname !== "/" ||
    targetUrl.search ||
    targetUrl.hash ||
    targetUrl.username ||
    targetUrl.password ||
    !/^sb_publishable_[A-Za-z0-9_-]+$/.test(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "")
  )
    throw new Error("Foundation builds require the approved public connection");
})();

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
  // Browser-test and bundle-measurement builds in CI may skip Next's own
  // TypeScript pass (lint-type-security already runs tsc on the same commit).
  // Never production builds: see scripts/lib/next-typecheck-skip.cjs.
  typescript: { ignoreBuildErrors: shouldSkipNextTypecheck(process.env) },
  webpack(config, { webpack, isServer }) {
    // Cloudflare (OpenNext) builds leave PDF reading and link-preview drawing
    // to the offload Worker (src/lib/offload/client.ts, M9.9), so pdf.js and
    // @vercel/og stay out of the main Worker. OpenNext sets
    // NEXT_PRIVATE_STANDALONE=true just before it runs `next build` (see
    // scripts/lib/next-typecheck-skip.cjs); Node builds keep doing the work.
    if (isServer && process.env.NEXT_PRIVATE_STANDALONE === "true") {
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(
          /[\\/]src[\\/]lib[\\/]offload[\\/]local\.ts$/,
          require.resolve("./src/lib/offload/local.worker.ts")
        )
      );
    }
    // A patched dependency retains its npm version. Invalidate persistent
    // compiler output when this runtime compatibility patch changes.
    if (config.cache && config.cache.type === "filesystem") {
      config.cache.buildDependencies = {
        ...config.cache.buildDependencies,
        sentryRuntimePatch: [require.resolve("./patches/@sentry__nextjs@10.75.2.patch")],
      };
    }
    return config;
  },
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
    // Cloudflare Workers does not support the default Next.js image
    // optimisation endpoint (/_next/image), and the zone has no Cloudflare
    // Image Resizing. The custom loader maps media to 400/800/1600px variant
    // keys (the media route serves the original when a variant is missing;
    // uploads through the new backend create none yet) and leaves other
    // images at their own URL. Nothing is resized on the fly.
    loader: "custom",
    loaderFile: "./src/lib/image-loader.ts",
    // Only the 400/800/1600px media variants can differ and local assets are
    // not resized, so extra widths only repeat the same file in every srcset.
    deviceSizes: [400, 800, 1600],
    imageSizes: [128, 256],
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
    // Bound parallel build/render workers on developer machines and CI.
    cpus: 2,
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
  async redirects() {
    return [
      {
        // Buyer tokens were retired; the old checker page is gone.
        source: "/verify-buyer",
        destination: "/trust-safety",
        permanent: true,
      },
      {
        source: "/promotions/events",
        destination: "/tourism-events?type=event",
        permanent: true,
      },
      {
        source: "/promotions",
        destination: "/tourism-events",
        permanent: true,
      },
      {
        source: "/promotion/:id",
        destination: "/tourism-events/:id",
        permanent: true,
      },
      {
        source: "/post/create-promotion",
        destination: "/post/create-tourism",
        permanent: true,
      },
      {
        source: "/post/edit-promotion/:id",
        destination: "/post/edit-tourism/:id",
        permanent: true,
      },
      {
        source: "/dashboard/promotions",
        destination: "/dashboard/tourism-events",
        permanent: true,
      },
      {
        source: "/admin/promotions-events",
        destination: "/admin/tourism-events",
        permanent: true,
      },
      // Legacy Business Ads / Mall Shops surfaces removed — forward old links
      // to the unified Mzansi Business area.
      {
        source: "/business-ads",
        destination: "/mzansi-business",
        permanent: true,
      },
      {
        source: "/business-ad/:id",
        destination: "/mzansi-business/:id",
        permanent: true,
      },
      {
        source: "/mall-shops",
        destination: "/mzansi-business?type=mall_store",
        permanent: true,
      },
      {
        source: "/mall-shops/:path*",
        destination: "/mzansi-business?type=mall_store",
        permanent: true,
      },
      {
        source: "/mall-shop/:id",
        destination: "/mzansi-business/:id",
        permanent: true,
      },
      {
        source: "/post/create-business-ad",
        destination: "/post/create-business",
        permanent: true,
      },
      {
        source: "/post/create-mall-shop",
        destination: "/post/create-business",
        permanent: true,
      },
    ];
  },
  async headers() {
    // Full CSP + security headers are applied by the Cloudflare Workers proxy
    // (proxy-handler.ts). Keep only cache-specific headers here so live
    // responses do not emit duplicate security headers from both layers.
    return [
      {
        // Media handlers choose caching from the outcome: immutable objects,
        // short-lived variant fallbacks, and no-store errors. Public anonymous
        // share previews likewise own their success/error cache policy. Framework headers
        // take precedence over handler headers, so exclude that route here.
        source: "/api/:path((?!(?:media/serve/|share-preview/)).*)",
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

  // Use package version instead of git commit SHA to avoid leaking
  // internal build info in the <meta name="baggage"> tag.
  release: {
    name: `verifymzansi@${require("./package.json").version}`,
  },

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
