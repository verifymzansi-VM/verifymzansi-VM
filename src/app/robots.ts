import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  // The staging copy (M0.15b) is built and served with ENVIRONMENT "staging";
  // it must never be crawled. Its Worker also marks every response noindex.
  if (process.env.ENVIRONMENT === "staging") {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

  return {
    rules: [
      {
        userAgent: "*",
        // Link-preview crawlers (WhatsApp/Facebook) obey robots.txt for og:image too.
        allow: ["/", "/api/media/serve/", "/api/share-preview/"],
        disallow: [
          "/admin",
          "/dashboard",
          "/api/",
          "/billing/checkout",
          "/billing/package",
          "/dsar",
        ],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
