import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { checkLocalRateLimit, getClientRateLimitKey } from "@/lib/utils/rate-limit";

/**
 * GET /api/organisations/search?q=
 * Listed organisations accepting affiliation requests (public data only).
 */
export async function GET(request: NextRequest) {
  if (checkLocalRateLimit(getClientRateLimitKey(request), "organisations:search", 120).limited) {
    return NextResponse.json({ organisations: [] }, { status: 429 });
  }
  const q = (request.nextUrl.searchParams.get("q") ?? "")
    .replace(/[%_,()]/g, " ")
    .trim()
    .slice(0, 80);
  const supabase = await createClient();
  let query = supabase
    .from("organisations")
    .select(
      "id, slug, name, organisation_type, service_area, province, organisation_programmes(id, name, active)"
    )
    .eq("is_public", true)
    .in("programme_status", ["founding_trial", "active_paid", "affiliation_only"])
    .order("name")
    .limit(50);
  if (q) query = query.ilike("name", `%${q}%`);
  // Search filters list every public organisation; affiliation requests only
  // those currently accepting applications.
  if (request.nextUrl.searchParams.get("purpose") !== "filter") {
    query = query.eq("accepting_applications", true);
  }
  const { data } = await query;
  return NextResponse.json({ organisations: data ?? [] });
}
