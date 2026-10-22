import type { NextRequest } from "next/server";
import { readFoundationProgrammeShowcases } from "@/lib/foundation/organisation-sponsorships";
import { handlePublicOrganisationRead } from "../../_lib/organisation-route";

/** Programme spotlights for a page: GET ?placement=home|business|tourism|market. */
export function GET(request: NextRequest) {
  const placement = request.nextUrl.searchParams.get("placement");
  return handlePublicOrganisationRead(request, (api) =>
    readFoundationProgrammeShowcases(api, { placement })
  );
}
