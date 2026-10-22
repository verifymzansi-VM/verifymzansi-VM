import { NextResponse, type NextRequest } from "next/server";
import { readFoundationPublicOrganisation } from "@/lib/foundation/organisations";
import { handlePublicOrganisationRead } from "../../_lib/organisation-route";

/** Public organisation page data; unlisted organisations are not found. */
export async function GET(request: NextRequest, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const response = await handlePublicOrganisationRead(request, (api) =>
    readFoundationPublicOrganisation(api, { slug })
  );
  if (response.status === 200 && (await response.clone().json()) === null)
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  return response;
}
