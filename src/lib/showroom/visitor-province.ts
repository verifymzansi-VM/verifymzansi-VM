import "server-only";

import { cookies } from "next/headers";
import { normalizeProvinceName } from "@/lib/constants/sa-provinces";
import { resolveIpGeolocation } from "@/lib/services/ip-geolocation";
import { SHOWROOM_PROVINCE_COOKIE, SHOWROOM_PROVINCE_ALL } from "./province-cookie";

export interface VisitorProvince {
  province: string | null;
  /** "chosen" by the visitor, "detected" from the network, or none. */
  source: "chosen" | "detected" | null;
}

/**
 * The province whose posts the showroom offers first. A visitor's own choice
 * wins; otherwise the province is estimated from the connection (about 90%
 * accurate; mobile networks and VPNs can be wrong, hence the "Change" chip).
 * The network address is used for this request only and never stored.
 */
export async function getVisitorProvince(): Promise<VisitorProvince> {
  try {
    const chosen = (await cookies()).get(SHOWROOM_PROVINCE_COOKIE)?.value;
    if (chosen === SHOWROOM_PROVINCE_ALL) return { province: null, source: "chosen" };
    const normalized = normalizeProvinceName(chosen ? decodeURIComponent(chosen) : null);
    if (normalized) return { province: normalized, source: "chosen" };
  } catch {
    // Outside a request (tests, build): fall through to detection.
  }

  const geo = await resolveIpGeolocation().catch(() => null);
  if (geo?.country === "ZA" && geo.province) return { province: geo.province, source: "detected" };
  return { province: null, source: null };
}
