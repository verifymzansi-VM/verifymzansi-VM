import type { NextRequest } from "next/server";
import { readFoundationPostSponsorships } from "@/lib/foundation/organisation-sponsorships";
import { handlePublicOrganisationRead } from "../../_lib/organisation-route";

/** "Supported by" badges for business cards: GET ?ids=uuid,uuid (at most 100). */
export function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  return handlePublicOrganisationRead(request, (api) =>
    readFoundationPostSponsorships(api, { post_ids: ids })
  );
}
