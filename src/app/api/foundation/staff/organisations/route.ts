import type { NextRequest } from "next/server";
import { createFoundationOrganisation } from "@/lib/foundation/organisations";
import { readFoundationStaffOrganisations } from "@/lib/foundation/staff-directory";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

export function GET(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:read",
    false,
    readFoundationStaffOrganisations
  );
}

export function POST(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:manage",
    true,
    createFoundationOrganisation,
    true
  );
}
