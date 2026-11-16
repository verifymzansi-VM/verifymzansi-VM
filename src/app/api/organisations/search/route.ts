import { NextResponse, type NextRequest } from "next/server";
import { restoredOrganisationDirectory } from "@/lib/foundation/marketplace-server";
import { publicProvinceLabel } from "@/lib/foundation/marketplace-read";
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
  try {
    const directory = await restoredOrganisationDirectory();
    const organisations = directory
      .filter(
        (org) =>
          (!q || org.name.toLowerCase().includes(q.toLowerCase())) &&
          (request.nextUrl.searchParams.get("purpose") === "filter" || org.accepting_applications)
      )
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 50)
      .map((org) => ({
        id: org.id,
        slug: org.slug,
        name: org.name,
        organisation_type: org.organisation_type,
        service_area: org.service_area,
        province: org.province ? publicProvinceLabel(org.province) : null,
        organisation_programmes: org.programmes.map((programme) => ({
          id: programme.id,
          name: programme.name,
          active: true,
        })),
      }));
    return NextResponse.json(
      { organisations },
      { headers: { "Cache-Control": "private, no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Organisations could not be loaded" }, { status: 503 });
  }
}
