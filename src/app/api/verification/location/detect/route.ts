import { type NextRequest, NextResponse } from "next/server";
import { resolveIpGeolocation } from "@/lib/services/ip-geolocation";
import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { isFeatureEnabled } from "@/lib/services/feature-flags";
import { enforceConfirmedVerificationRequest } from "../../_lib/verification-request-prelude";

const log = createLogger("LocationSuggestion");

/** A suggestion only: never writes a step or approves an account. */
export async function POST(request: NextRequest) {
  const prelude = await enforceConfirmedVerificationRequest(request, log);
  if (!prelude.success) return prelude.response;

  try {
    if (!(await isFeatureEnabled("kyc_v2_flow"))) {
      return NextResponse.json(
        { error: "Location confirmation is not enabled", code: "kyc_v2_disabled" },
        { status: 404 }
      );
    }
    // This read-only suggestion does not need a new distributed limiter/service.
    // Keep detection's counter separate so exhausting it never blocks manual save.
    const rate = checkLocalRateLimit(prelude.user.id, "verification:location-detect", 10);
    if (rate.limited) {
      return NextResponse.json(
        { error: "Too many detection attempts. Select your province and city manually." },
        {
          status: 429,
          headers: {
            "Retry-After": String(rate.retryAfter ?? 60),
            "Cache-Control": "private, no-store",
          },
        }
      );
    }
    const geo = await resolveIpGeolocation();
    const province = geo?.country === "ZA" ? normalizeProvinceName(geo.province) : null;
    const city = resolveCityName(province, geo?.city);
    return NextResponse.json(
      { detected: Boolean(province && city), province, city },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json(
      { detected: false, province: null, city: null },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  }
}
