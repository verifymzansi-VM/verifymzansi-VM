import type { NextRequest } from "next/server";
import { saveFoundationProgrammeShowcase } from "@/lib/foundation/organisation-sponsorships";
import { readFoundationStaffShowcases } from "@/lib/foundation/staff-directory";
import { handleOrganisationRoute } from "../../../../_lib/organisation-route";
import { bindFoundationPathInput } from "../../../_lib/path-input";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationStaffShowcases(api, { organisation_id: id })
  );
}

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:manage", true, (api, value) =>
    saveFoundationProgrammeShowcase(api, bindFoundationPathInput("organisation_id", id, value))
  );
}
