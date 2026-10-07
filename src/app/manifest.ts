import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VerifyMzansi",
    short_name: "VerifyMzansi",
    description:
      "VerifyMzansi is a trusted South African platform connecting people with verified businesses, products, services, tourism and events. Discover, connect and do business with confidence.",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f7f4",
    theme_color: "#0b7a55",
    icons: [
      {
        src: "/icons/icon-192.png?v=20260924",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png?v=20260924",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-1024.png?v=20260924",
        sizes: "1024x1024",
        type: "image/png",
      },
      {
        src: "/icons/icon-maskable-192.png?v=20260924",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png?v=20260924",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
