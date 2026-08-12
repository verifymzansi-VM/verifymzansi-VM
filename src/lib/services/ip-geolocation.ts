/**
 * IP geolocation cross-signal for location verification.
 *
 * Reads Cloudflare request metadata (request.cf via the OpenNext context) and
 * maps the IP-derived region to an SA province. The client cannot fake this
 * without a VPN/proxy, so it is a useful independent cross-check against
 * client-supplied GPS coordinates.
 *
 * Never used as a hard block — mobile/cellular IPs legitimately resolve to a
 * different province (carrier NAT egress). Warn-severity signal only.
 */

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

  const regionCode = (cf.regionCode ?? null)?.toUpperCase() ?? null;
  const province = regionCode ? (CF_REGION_TO_PROVINCE[regionCode] ?? null) : null;

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
