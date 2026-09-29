/**
 * Suggests an approximate province and city from Cloudflare request metadata.
 * Mobile networks and VPNs may resolve elsewhere; users confirm or select manually.
 */

import { normalizeProvinceName } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("IpGeolocation");

export interface IpGeoSignal {
  country: string | null;
  /** ISO 3166-2 region code, e.g. "GP", "WC". */
  regionCode: string | null;
  city: string | null;
  /** SA province name resolved from the region code, or null when unknown. */
  province: string | null;
}

/** Cloudflare ISO 3166-2 subdivision codes for South African provinces. */
const CF_REGION_TO_PROVINCE: Record<string, string> = {
  GP: "Gauteng",
  GT: "Gauteng",
  WC: "Western Cape",
  KZN: "KwaZulu-Natal",
  NL: "KwaZulu-Natal", // legacy/alternate code used for KwaZulu-Natal
  EC: "Eastern Cape",
  FS: "Free State",
  MP: "Mpumalanga",
  LP: "Limpopo",
  NW: "North West",
  NC: "Northern Cape",
};

interface CloudflareRequestCf {
  country?: string;
  regionCode?: string;
  region?: string;
  city?: string;
}

function readCfFromGlobalScope(): CloudflareRequestCf | null {
  // OpenNext on Cloudflare exposes the raw request cf object on the context.
  const contextSymbol = Symbol.for("__cloudflare-context__");
  const globalScope = globalThis as Record<PropertyKey, unknown>;
  const context = globalScope[contextSymbol] as { cf?: CloudflareRequestCf | null } | undefined;
  return context?.cf ?? null;
}

/**
 * Resolve IP geolocation for the current request. Returns null when not
 * running on Cloudflare (local dev, tests) or when no cf data is present.
 */
export async function resolveIpGeolocation(): Promise<IpGeoSignal | null> {
  let cf = readCfFromGlobalScope();

  if (!cf) {
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const ctx = await getCloudflareContext({ async: true });
      cf = (ctx as unknown as { cf?: CloudflareRequestCf | null }).cf ?? null;
    } catch {
      // Not in a Cloudflare context (local dev / tests) — no IP geo available.
      return null;
    }
  }

  if (!cf || (!cf.country && !cf.regionCode && !cf.region)) {
    return null;
  }

  const regionCode = cf.regionCode?.toUpperCase().replace(/^ZA-/, "") ?? null;
  const province =
    (regionCode ? CF_REGION_TO_PROVINCE[regionCode] : null) ?? normalizeProvinceName(cf.region);

  if (cf.country && cf.country !== "ZA") {
    log.info("IP geolocation resolved outside South Africa", { country: cf.country });
  }

  return {
    country: cf.country ?? null,
    regionCode,
    city: cf.city ?? null,
    province,
  };
}
