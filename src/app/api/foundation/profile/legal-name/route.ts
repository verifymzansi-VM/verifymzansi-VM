import type { NextRequest } from "next/server";
import { saveFoundationLegalNameClaim } from "@/lib/foundation/account-profile";
import { handleFoundationProfile } from "../_lib/handle";

/** Unreviewed claim used by the next identity submission; locked after review. */
export function POST(request: NextRequest) {
  return handleFoundationProfile(request, "profile:update", saveFoundationLegalNameClaim, true);
}
