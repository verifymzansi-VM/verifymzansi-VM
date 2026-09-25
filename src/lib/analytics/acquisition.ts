/** First-touch acquisition cookie (referral code, UTM, landing page). */
export const ACQUISITION_COOKIE = "vm_acq";
export const ACQUISITION_MAX_AGE_SECONDS = 60 * 60 * 24 * 30;

export interface AcquisitionTouch {
  partnerCode?: string;
  organisationSlug?: string;
  campaignId?: string;
  source?: "SOCIAL" | "PAID_CAMPAIGN" | "ORGANIC";
  landingPath?: string;
  referrerHost?: string;
  utm?: Record<string, string>;
  firstTouchAt?: string;
}

const CODE = /^[A-Za-z0-9]{4,16}$/;
const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UTM_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"] as const;

function sourceFor(medium: string | undefined, referrerHost: string | undefined) {
  if (medium && /cpc|paid|ads?|display/i.test(medium)) return "PAID_CAMPAIGN" as const;
  if (medium && /social/i.test(medium)) return "SOCIAL" as const;
  if (
    referrerHost &&
    /facebook|instagram|tiktok|twitter|x\.com|linkedin|whatsapp/.test(referrerHost)
  )
    return "SOCIAL" as const;
  if (referrerHost && /google|bing|duckduckgo|yahoo/.test(referrerHost)) return "ORGANIC" as const;
  return undefined;
}

/** Build a touch from the current URL; null when there is nothing worth recording. */
export function buildAcquisitionTouch(
  search: string,
  pathname: string,
  referrer: string,
  now = new Date()
): AcquisitionTouch | null {
  const params = new URLSearchParams(search);
  const ref = params.get("ref")?.trim();
  const org = params.get("org")?.trim().toLowerCase();
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    const value = params.get(key)?.trim();
    if (value) utm[key] = value.slice(0, 80);
  }
  let referrerHost: string | undefined;
  try {
    referrerHost = referrer ? new URL(referrer).hostname.slice(0, 200) : undefined;
  } catch {
    referrerHost = undefined;
  }
  const source = sourceFor(utm.utm_medium, referrerHost);
  const partnerCode = ref && CODE.test(ref) ? ref.toUpperCase() : undefined;
  const organisationSlug = org && SLUG.test(org) ? org.slice(0, 80) : undefined;
  if (!partnerCode && !organisationSlug && Object.keys(utm).length === 0 && !source) return null;
  return {
    partnerCode,
    organisationSlug,
    campaignId: utm.utm_campaign,
    source,
    landingPath: pathname.slice(0, 300),
    referrerHost,
    utm,
    firstTouchAt: now.toISOString(),
  };
}

export function parseAcquisitionCookie(value: string | undefined | null): AcquisitionTouch | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as AcquisitionTouch) : null;
  } catch {
    return null;
  }
}
