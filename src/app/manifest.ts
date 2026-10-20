import type { MetadataRoute } from "next";

const ICON_VERSION = "v=20260924";
const SCREENSHOT_VERSION = "v=20261019";

// The only web app manifest. Next links it as /manifest.webmanifest; do not add
// metadata.manifest or a public/manifest.json, or browsers may pick the wrong one.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "VerifyMzansi",
    short_name: "VerifyMzansi",
    description:
      "VerifyMzansi is a trusted South African platform connecting people with verified businesses, products, services, tourism and events. Discover, connect and do business with confidence.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    display_override: ["standalone"],
    background_color: "#f7f7f4",
    theme_color: "#0b7a55",
    lang: "en-ZA",
    dir: "ltr",
    categories: ["shopping", "business", "travel"],
    icons: [
      {
        src: `/icons/icon-192.png?${ICON_VERSION}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-256.png?${ICON_VERSION}`,
        sizes: "256x256",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-512.png?${ICON_VERSION}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-1024.png?${ICON_VERSION}`,
        sizes: "1024x1024",
        type: "image/png",
        purpose: "any",
      },
      {
        src: `/icons/icon-maskable-192.png?${ICON_VERSION}`,
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: `/icons/icon-maskable-512.png?${ICON_VERSION}`,
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
    screenshots: [
      {
        src: `/images/pwa/home-narrow.webp?${SCREENSHOT_VERSION}`,
        sizes: "1080x1920",
        type: "image/webp",
        form_factor: "narrow",
        label: "VerifyMzansi home",
      },
      {
        src: `/images/pwa/market-narrow.webp?${SCREENSHOT_VERSION}`,
        sizes: "1080x1920",
        type: "image/webp",
        form_factor: "narrow",
        label: "Mzansi Market listings",
      },
      {
        src: `/images/pwa/business-narrow.webp?${SCREENSHOT_VERSION}`,
        sizes: "1080x1920",
        type: "image/webp",
        form_factor: "narrow",
        label: "Mzansi Business directory",
      },
      {
        src: `/images/pwa/home-wide.webp?${SCREENSHOT_VERSION}`,
        sizes: "1920x1080",
        type: "image/webp",
        form_factor: "wide",
        label: "VerifyMzansi on desktop",
      },
    ],
    shortcuts: [
      {
        name: "Mzansi Market",
        short_name: "Market",
        url: "/mzansi-market",
        icons: [{ src: `/icons/icon-192.png?${ICON_VERSION}`, sizes: "192x192" }],
      },
      {
        name: "Mzansi Business",
        short_name: "Business",
        url: "/mzansi-business",
        icons: [{ src: `/icons/icon-192.png?${ICON_VERSION}`, sizes: "192x192" }],
      },
      {
        name: "My Dashboard",
        short_name: "Dashboard",
        url: "/dashboard",
        icons: [{ src: `/icons/icon-192.png?${ICON_VERSION}`, sizes: "192x192" }],
      },
    ],
  };
}
