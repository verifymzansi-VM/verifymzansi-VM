import type { NextRequest } from "next/server";
import { setFoundationAvatar } from "@/lib/foundation/account-profile";
import { handleFoundationProfile } from "../_lib/handle";

/** Links an already uploaded, server-finalized image owned by the caller. */
export function POST(request: NextRequest) {
  return handleFoundationProfile(request, "profile:avatar", setFoundationAvatar, true);
}
