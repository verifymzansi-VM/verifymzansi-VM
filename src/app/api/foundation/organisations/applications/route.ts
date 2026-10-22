import type { NextRequest } from "next/server";
import {
  applyToFoundationOrganisation,
  updateMyFoundationApplication,
} from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

/** Apply with an owned business profile and explicit consent. */
export function POST(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:apply",
    true,
    applyToFoundationOrganisation
  );
}

/** Applicant follow-up: { application_id, action: "respond" | "withdraw", response? }. */
export function PATCH(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:apply",
    true,
    updateMyFoundationApplication
  );
}
