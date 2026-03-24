export type OfficialSocialPlatform = "facebook" | "youtube" | "x" | "tiktok" | "linkedin";

export interface OfficialSocialLinkConfig {
  facebook?: string;
  youtube?: string;
  x?: string;
  tiktok?: string;
  linkedin?: string;
}

export interface OfficialSocialLink {
  key: OfficialSocialPlatform;
  label: string;
  href: string;
}

const OFFICIAL_SOCIAL_PLATFORM_META: Array<{ key: OfficialSocialPlatform; label: string }> = [
  { key: "facebook", label: "Facebook" },
  { key: "youtube", label: "YouTube" },
  { key: "x", label: "X" },
  { key: "tiktok", label: "TikTok" },
  { key: "linkedin", label: "LinkedIn" },
];

function normalizeUrl(value?: string): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getOfficialSocialLinks(config: OfficialSocialLinkConfig): OfficialSocialLink[] {
  return OFFICIAL_SOCIAL_PLATFORM_META.flatMap(({ key, label }) => {
    const href = normalizeUrl(config[key]);
    return href ? [{ key, label, href }] : [];
  });
}

export function getOfficialSocialSameAs(config: OfficialSocialLinkConfig): string[] {
  return getOfficialSocialLinks(config).map((link) => link.href);
}
