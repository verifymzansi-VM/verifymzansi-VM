import type { NextRequest } from "next/server";
import { updateFoundationOrganisation } from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../../_lib/organisation-route";
import { bindFoundationPathInput } from "../../_lib/path-input";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:manage", true, (api, value) =>
    updateFoundationOrganisation(api, bindFoundationPathInput("id", id, value))
  );
}
