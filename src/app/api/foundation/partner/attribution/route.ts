import type { NextRequest } from "next/server";
import { recordFoundationAcquisition } from "@/lib/foundation/partners";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

/** First-touch attribution after sign-in, from the first-visit cookie values. */
export function POST(request: NextRequest) {
  return handleOrganisationRoute(request, "partner:attribution", true, recordFoundationAcquisition);
}
