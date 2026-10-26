import type { NextRequest } from "next/server";
import { updateFoundationOrganisation } from "@/lib/foundation/organisations";
import { readFoundationStaffOrganisation } from "@/lib/foundation/staff-organisations";
import { handleOrganisationRoute } from "../../../_lib/organisation-route";
import { bindFoundationPathInput } from "../../_lib/path-input";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleOrganisationRoute(
    request,
    "organisation:manage",
    true,
    (api, value) => updateFoundationOrganisation(api, bindFoundationPathInput("id", id, value)),
    true
  );
}
export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationStaffOrganisation(api, { id })
  );
}
