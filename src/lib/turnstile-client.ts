import { getPublicRuntimeConfig, type PublicRuntimeConfig } from "@/lib/public-runtime-config";

export type TurnstileClientMode = "configured" | "bypass" | "unavailable";

export interface TurnstileClientState {
  mode: TurnstileClientMode;
  siteKey: string;
}

export const TURNSTILE_UNAVAILABLE_MESSAGE =
  "Security verification is temporarily unavailable. Please try again later.";
export const TURNSTILE_DOMAIN_MISCONFIGURED_MESSAGE =
  "Security verification is unavailable on this page because the domain is not authorized. Please try again later.";

export function getTurnstileClientState(
  config: PublicRuntimeConfig = getPublicRuntimeConfig()
): TurnstileClientState {
  const siteKey = config.turnstileSiteKey.trim();

  if (siteKey === "dummy_site_key") {
    return { mode: "bypass", siteKey };
  }

  if (siteKey.length > 0) {
    return { mode: "configured", siteKey };
  }

  if (process.env.NODE_ENV === "production") {
    return { mode: "unavailable", siteKey: "" };
  }

  return { mode: "bypass", siteKey: "" };
}
