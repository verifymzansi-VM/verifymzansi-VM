import type { MetadataRoute } from "next";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();

  // Static public pages
  const staticPages: MetadataRoute.Sitemap = [
    { url: BASE_URL, lastModified: now, changeFrequency: "daily", priority: 1.0 },
    {
      url: `${BASE_URL}/mzansi-market`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/mzansi-business`,
      lastModified: now,
      changeFrequency: "hourly",
      priority: 0.9,
    },
    { url: `${BASE_URL}/promotions`, lastModified: now, changeFrequency: "hourly", priority: 0.8 },
    {
      url: `${BASE_URL}/promotions/events`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 0.7,
    },
    { url: `${BASE_URL}/advertise`, lastModified: now, changeFrequency: "weekly", priority: 0.8 },
    { url: `${BASE_URL}/pricing`, lastModified: now, changeFrequency: "weekly", priority: 0.7 },
    {
      url: `${BASE_URL}/verify-buyer`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.6,
    },
    { url: `${BASE_URL}/contact`, lastModified: now, changeFrequency: "monthly", priority: 0.5 },
    { url: `${BASE_URL}/privacy`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    { url: `${BASE_URL}/terms`, lastModified: now, changeFrequency: "monthly", priority: 0.3 },
    {
      url: `${BASE_URL}/safety/scam-alerts`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    {
      url: `${BASE_URL}/safety/meeting-checklist`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: 0.4,
    },
    { url: `${BASE_URL}/dsar`, lastModified: now, changeFrequency: "monthly", priority: 0.2 },
  ];

  return staticPages;
}
