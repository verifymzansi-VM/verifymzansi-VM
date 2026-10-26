import type { NextRequest } from "next/server";
import { decideFoundationCommission } from "@/lib/foundation/partners";
import { readFoundationStaffCommissions } from "@/lib/foundation/staff-directory";
import { FoundationOrganisationError } from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

export function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, (api) => {
    const params = request.nextUrl.searchParams;
    if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
      throw new FoundationOrganisationError("invalid");
    return readFoundationStaffCommissions(api, Object.fromEntries(params));
  });
}

export function POST(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:manage",
    true,
    decideFoundationCommission,
    true
  );
}
