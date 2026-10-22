import type { NextRequest } from "next/server";
import { readFoundationOrganisationLinks } from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

/** The caller's applications, affiliations and organisations they administer. */
export function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationOrganisationLinks(api)
  );
}
