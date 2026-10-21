import type { NextRequest } from "next/server";
import {
  readFoundationAccountProfile,
  saveFoundationAccountProfile,
} from "@/lib/foundation/account-profile";
import { handleFoundationProfile } from "./_lib/handle";

export function GET(request: NextRequest) {
  return handleFoundationProfile(
    request,
    "profile:read",
    (api) => readFoundationAccountProfile(api),
    false
  );
}

export function POST(request: NextRequest) {
  return handleFoundationProfile(request, "profile:update", saveFoundationAccountProfile, true);
}
