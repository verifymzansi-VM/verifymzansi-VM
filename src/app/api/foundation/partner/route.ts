import type { NextRequest } from "next/server";
import { readFoundationPartnerDashboard } from "@/lib/foundation/partners";
import { handleOrganisationRoute } from "../_lib/organisation-route";

/** The caller's partner summary (null when not a partner); never who they referred. */
export function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, (api) =>
    readFoundationPartnerDashboard(api)
  );
}
