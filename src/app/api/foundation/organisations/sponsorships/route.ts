import type { NextRequest } from "next/server";
import { readMyFoundationSponsorships } from "@/lib/foundation/organisation-sponsorships";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

/** The caller's sponsored places for their own businesses. */
export function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readMyFoundationSponsorships(api)
  );
}
