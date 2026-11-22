/**
 * Suggests an approximate province and city from Cloudflare request metadata.
 * Mobile networks and VPNs may resolve elsewhere; users confirm or select manually.
 */

import { normalizeProvinceName } from "@/lib/constants/sa-provinces";

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

/**
 * The request-scoped Cloudflare data. On the Worker, OpenNext's runtime
 * defines this symbol to return `{ env, ctx, cf: request.cf }` for the request
 * being handled. Anywhere else (next start, next dev, tests) it is unset.
 *
 * Deliberately no getCloudflareContext() fallback: outside the Worker that
 * asks wrangler's platform proxy, whose `cf` describes the machine running the
 * server (cached in node_modules/.mf/cf.json), not the visitor.
 */
function readRequestCf(): CloudflareRequestCf | null {
  const contextSymbol = Symbol.for("__cloudflare-context__");
  const globalScope = globalThis as Record<PropertyKey, unknown>;
  const context = globalScope[contextSymbol] as { cf?: CloudflareRequestCf | null } | undefined;
  return context?.cf ?? null;
}

/**
 * Resolve IP geolocation for the current request from Cloudflare's request
 * data. Returns null when not running on the Worker (local server, tests) or
 * when the request carries no location. Nothing about the location is logged
 * or stored: the showroom reads it on every page view.
 */
export function resolveIpGeolocation(): IpGeoSignal | null {
  const cf = readRequestCf();

  if (!cf || (!cf.country && !cf.regionCode && !cf.region)) {
    return null;
  }

  const regionCode = cf.regionCode?.toUpperCase().replace(/^ZA-/, "") ?? null;
  const province =
    (regionCode ? CF_REGION_TO_PROVINCE[regionCode] : null) ?? normalizeProvinceName(cf.region);

  return {
    country: cf.country ?? null,
    regionCode,
    city: cf.city ?? null,
    province,
  };
}
