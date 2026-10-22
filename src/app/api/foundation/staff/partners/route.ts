import type { NextRequest } from "next/server";
import { saveFoundationPartner } from "@/lib/foundation/partners";
import { readFoundationStaffPartners } from "@/lib/foundation/staff-directory";
import { handleOrganisationRoute } from "../../_lib/organisation-route";

export function GET(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:read", false, readFoundationStaffPartners);
}

export function POST(request: NextRequest) {
  return handleOrganisationRoute(request, "organisation:manage", true, saveFoundationPartner);
}
