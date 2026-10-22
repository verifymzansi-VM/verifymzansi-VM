import type { NextRequest } from "next/server";
import {
  decideFoundationApplication,
  readFoundationOrganisationApplications,
} from "@/lib/foundation/organisations";
import { handleOrganisationRoute } from "../../../../_lib/organisation-route";

type Context = { params: Promise<{ id: string }> };

/** Organisation administrator (or staff) review list: GET ?status= */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  const status = request.nextUrl.searchParams.get("status");
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationOrganisationApplications(api, {
      organisation_id: id,
      ...(status === null ? {} : { status }),
    })
  );
}

/** Decide: { application_id, decision: approve | decline | request_info, note? }. */
export function POST(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:manage", true, decideFoundationApplication);
}
