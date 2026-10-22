import type { NextRequest } from "next/server";
import { readFoundationPostAffiliations } from "@/lib/foundation/organisations";
import { handlePublicOrganisationRead } from "../../_lib/organisation-route";

/** Affiliation badges for business cards: GET ?ids=uuid,uuid (at most 100). */
export function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") ?? "").split(",").filter(Boolean);
  return handlePublicOrganisationRead(request, (api) =>
    readFoundationPostAffiliations(api, { post_ids: ids })
  );
}
