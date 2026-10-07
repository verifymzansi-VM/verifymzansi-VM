import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

  return {
    rules: [
      {
        userAgent: "*",
        // Link-preview crawlers (WhatsApp/Facebook) obey robots.txt for og:image too.
        allow: ["/", "/api/media/serve/", "/api/share-preview/"],
        disallow: ["/admin", "/dashboard", "/api/", "/billing/checkout", "/dsar"],
      },
    ],
    sitemap: `${baseUrl}/sitemap.xml`,
  };
}
