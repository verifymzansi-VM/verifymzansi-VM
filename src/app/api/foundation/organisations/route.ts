import type { NextRequest } from "next/server";
import { readFoundationOrganisationDirectory } from "@/lib/foundation/organisations";
import { handlePublicOrganisationRead } from "../_lib/organisation-route";

/** Public programme directory (listed organisations only). */
export function GET(request: NextRequest) {
  return handlePublicOrganisationRead(request, readFoundationOrganisationDirectory);
}
