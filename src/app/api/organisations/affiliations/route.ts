import { NextResponse, type NextRequest } from "next/server";
import { readRestoredBusinessAffiliations } from "@/lib/foundation/public-business-affiliations";
import { handlePublicOrganisationRead } from "@/app/api/foundation/_lib/organisation-route";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/organisations/affiliations?ids=a,b,c
 * Public affiliation badges for business cards. Only active affiliations of
 * listed organisations; logos only with recorded permission; "sponsored"
 * only where an organisation actually funds the visibility.
 */
export async function GET(request: NextRequest) {
  const ids = (request.nextUrl.searchParams.get("ids") ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter((id) => UUID.test(id))
    .slice(0, 100);
  if (ids.length === 0) return NextResponse.json({ affiliations: [] });
  return handlePublicOrganisationRead(request, async (api) => ({
    affiliations: await readRestoredBusinessAffiliations(api, ids),
  }));
}
