import type { NextRequest } from "next/server";
import {
  readFoundationOrganisationAffiliations,
  updateFoundationAffiliation,
} from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../../../_lib/organisation-route";

type Context = { params: Promise<{ id: string }> };

/** Active affiliations of an organisation the caller administers. */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationOrganisationAffiliations(api, { organisation_id: id })
  );
}

/** { affiliation_id, action: "revoke", reason } or { ..., action: "set_type", affiliation_type }. */
export function PATCH(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:manage", true, updateFoundationAffiliation);
}
