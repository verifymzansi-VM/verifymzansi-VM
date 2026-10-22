import type { NextRequest } from "next/server";
import { acceptFoundationOrganisationInvite } from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../../_lib/organisation-route";

/** Accept an administrator invitation: { token }. SQL checks the invited
 * address, verified identity, expiry and the administrator limit. */
export function POST(request: NextRequest) {
  return handleOrganisationRoute(
    request,
    "organisation:invite",
    true,
    acceptFoundationOrganisationInvite
  );
}
