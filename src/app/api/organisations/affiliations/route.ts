import { NextResponse, type NextRequest } from "next/server";
import { organisationsPublicEnabled } from "@/lib/commercial/settings";
import { createClient } from "@/lib/supabase/server";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";

import type { PublicAffiliation } from "@/lib/organisations/affiliations";

const log = createLogger("PublicAffiliations");
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

  if (checkLocalRateLimit(getClientRateLimitKey(request), "affiliations:read", 240).limited) {
    return NextResponse.json({ affiliations: [] }, { status: 429 });
  }

  const supabase = await createClient();
  if (!(await organisationsPublicEnabled(supabase as never))) {
    return NextResponse.json({ affiliations: [] });
  }
  const { data, error } = await supabase.rpc("public_business_affiliations", {
    p_business_ids: [...new Set(ids)],
  });
  if (error) {
    log.warn("Affiliation lookup failed", { code: error.code });
    return NextResponse.json({ affiliations: [] });
  }
  return NextResponse.json(
    { affiliations: (data ?? []) as PublicAffiliation[] },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=300, stale-while-revalidate=600" } }
  );
}
