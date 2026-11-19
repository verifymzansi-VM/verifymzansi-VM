/**
 * POST /api/verification/location/detect
 * Suggests a province and city from the request's network location
 * (Cloudflare's request data). A suggestion only: it reads and writes no
 * verification data, and the member still confirms or picks the pair, which
 * /api/verification/location/manual saves.
 */

import { type NextRequest } from "next/server";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  FoundationAccountContextError,
  readFoundationAccountContext,
} from "@/lib/foundation/account-context";
import { resolveRestoredLocality } from "@/lib/foundation/restored-locality";
import { resolveIpGeolocation, type IpGeoSignal } from "@/lib/services/ip-geolocation";
import { normalizeProvinceName, resolveCityName } from "@/lib/constants/sa-provinces";
import { createLogger } from "@/lib/utils/logger";
import { enforceMutationRequest } from "@/lib/utils/mutation-guard";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";

const log = createLogger("LocationSuggestion");

/** Detection attempts per account per window, kept apart from manual saving
 * so using them up never blocks picking the province and city by hand. */
const DETECTION_CAP = 10;

type Suggestion = { detected: boolean; province: string | null; city: string | null };
const NOTHING_DETECTED: Suggestion = { detected: false, province: null, city: null };

class DetectionLimited extends Error {
  override name = "DetectionLimited";
  constructor(readonly retryAfter: number) {
    super("Detection cap reached");
  }
}

/** A South African province and city that the wizard's lists offer and the
 * foundation's locality list accepts, or nothing. */
function suggestLocality(geo: IpGeoSignal | null): Suggestion {
  if (geo?.country !== "ZA") return NOTHING_DETECTED;
  const province = normalizeProvinceName(geo.province);
  const city = resolveCityName(province, geo.city);
  if (!province || !city) return NOTHING_DETECTED;
  try {
    resolveRestoredLocality(province, city);
  } catch {
    return NOTHING_DETECTED;
  }
  return { detected: true, province, city };
}

async function detectedLocality(): Promise<Suggestion> {
  try {
    return suggestLocality(await resolveIpGeolocation());
  } catch {
    // No location data (not on Cloudflare, or it could not be read).
    return NOTHING_DETECTED;
  }
}

export async function POST(request: NextRequest) {
  // Same-origin and CSRF, though nothing is saved: the request carries the session.
  const blocked = enforceMutationRequest(request, log);
  if (blocked) return blocked;
  return handleFoundationOwnerRoute({
    request,
    log,
    action: "verification:location-detect",
    mutate: false,
    requireCaller: true,
    unavailableMessage: "Location detection is unavailable",
    signInMessage: "Sign in to manage verification",
    command: async (api, _input, caller) => {
      if (!caller) throw new Error("Verified caller missing");
      const rate = checkLocalRateLimit(
        caller.accountId,
        "verification:location-detect",
        DETECTION_CAP
      );
      if (rate.limited) throw new DetectionLimited(rate.retryAfter ?? 60);
      // A live account with a confirmed email (the database checks both).
      await readFoundationAccountContext(api);
      return detectedLocality();
    },
    refusal: (error) =>
      error instanceof DetectionLimited
        ? {
            status: 429,
            error: "Too many detection attempts. Select your province and city manually.",
            reason: "location_detection_limited",
            code: "rate_limited",
            retryAfter: error.retryAfter,
          }
        : error instanceof FoundationAccountContextError && error.reason === "forbidden"
          ? {
              status: 403,
              error: "Account access is unavailable",
              reason: "account_access_unavailable",
            }
          : null,
  });
}
