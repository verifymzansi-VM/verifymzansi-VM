import "server-only";

import type { NextRequest } from "next/server";
import type { FoundationAuthenticatedApi } from "@/lib/foundation/authenticated-api";
import {
  FoundationProfileError,
  type FoundationAccountProfile,
} from "@/lib/foundation/account-profile";
import { createLogger } from "@/lib/utils/logger";
import { handleFoundationOwnerRoute, type FoundationRefusal } from "../../_lib/owner-route";

const log = createLogger("FoundationProfile");
const refusals: Record<FoundationProfileError["reason"], [number, string]> = {
  invalid: [400, "Check the highlighted details and try again"],
  reserved: [400, "Choose a name that isn't a VerifyMzansi role or team name"],
  locked: [409, "Your verified name can't be changed"],
  changed: [409, "Your profile changed; reload it before saving"],
  legal_name_required: [409, "Add your legal name before verifying your identity"],
  avatar_unavailable: [400, "Upload the picture again"],
  unavailable: [503, "Your profile is temporarily unavailable"],
};
function refusal(error: unknown): FoundationRefusal | null {
  if (!(error instanceof FoundationProfileError)) return null;
  const [status, message] = refusals[error.reason];
  return { status, error: message, reason: error.reason };
}

type Command = (
  api: FoundationAuthenticatedApi,
  input: unknown
) => Promise<FoundationAccountProfile>;

/** Foundation profile route; see handleFoundationOwnerRoute for protections. */
export function handleFoundationProfile(
  request: NextRequest,
  action: "profile:read" | "profile:update" | "profile:avatar",
  command: Command,
  mutate: boolean
) {
  return handleFoundationOwnerRoute({
    request,
    log,
    action,
    mutate,
    unavailableMessage: "Your profile is temporarily unavailable",
    signInMessage: "Sign in to manage your profile",
    command,
    refusal,
  });
}
