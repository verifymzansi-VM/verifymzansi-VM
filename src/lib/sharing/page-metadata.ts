import type { Metadata } from "next";
import { normalizeMediaUrl } from "@/lib/utils/media-url";

const SITE_URL = process.env.NEXT_PUBLIC_APP_URL || "https://verifymzansi.com";

export function publicPageMetadata({
  title,
  description,
  path,
  image,
  previewType,
}: {
  title: string;
  description?: string | null;
  path: string;
  image?: string | null;
  video?: string | null;
  width?: number | null;
  height?: number | null;
  previewType?: "listing" | "business" | "promotion";
}): Metadata {
  const canonical = new URL(path, SITE_URL).href;
  const absoluteMedia = (url: string) => new URL(normalizeMediaUrl(url), SITE_URL).href;
  const match = /^\/(listing|mzansi-business|tourism-events)\/([^/?#]+)/.exec(path);
  // Business pages under Tourism use the business source; event/listing callers specify their source.
  const poster = match
    ? new URL(
        `/api/share-preview/${match[1] === "listing" ? "listing" : match[1] === "mzansi-business" ? "business" : previewType || "promotion"}/${match[2]}`,
        SITE_URL
      ).href
    : image
      ? absoluteMedia(image)
      : new URL("/opengraph-image", SITE_URL).href;
  // The receiving app gets a link card, not the media file or the account holder's avatar.
  const images: { url: string; alt: string; width?: number; height?: number; type?: string }[] = [
    { url: poster, alt: title, ...(match ? { width: 1200, height: 630, type: "image/png" } : {}) },
  ];
  if (image) images.unshift({ url: absoluteMedia(image), alt: title });
  const summary =
    description?.replace(/\s+/g, " ").trim().slice(0, 160) ||
    `Explore ${title}: photos, information and the complete post on VerifyMzansi.`;
  return {
    title,
    description: summary,
    alternates: { canonical },
    openGraph: {
      type: "website",
      title,
      description: summary,
      url: canonical,
      siteName: "VerifyMzansi",
      locale: "en_ZA",
      images,
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: summary,
      images: images.map((entry) => entry.url),
    },
  };
}
