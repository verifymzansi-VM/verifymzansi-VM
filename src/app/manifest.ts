import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "VerifyMzansi",
    short_name: "VerifyMzansi",
    description: "Promote products, services, tourism experiences, and events across South Africa.",
    start_url: "/",
    display: "standalone",
    background_color: "#faf8f5",
    theme_color: "#007749",
    icons: [
      {
        src: "/icons/icon-192.png?v=10",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png?v=10",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/icons/icon-1024.png?v=10",
        sizes: "1024x1024",
        type: "image/png",
      },
    ],
  };
}
