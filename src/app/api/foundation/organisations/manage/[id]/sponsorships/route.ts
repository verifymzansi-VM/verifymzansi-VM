import type { NextRequest } from "next/server";
import {
  changeFoundationSponsorship,
  readFoundationOrganisationSponsorships,
} from "@/lib/foundation/organisation-sponsorships";
import { handleOrganisationRoute } from "../../../../_lib/organisation-route";

type Context = { params: Promise<{ id: string }> };

/** Sponsored places, capacity and waiting list of an organisation the caller administers. */
export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationOrganisationSponsorships(api, { organisation_id: id })
  );
}

/** { action: "sponsor", affiliation_id, reason } or { action: "end", sponsorship_id, reason }. */
export function POST(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:manage", true, changeFoundationSponsorship);
}
