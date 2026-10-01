import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { enforceBillingMutationGuard } from "@/lib/billing/route-guard";
import { mapCommercialError } from "@/lib/commercial/errors";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("BillingPlanAdmins");

const schema = z.object({
  entitlementId: z.uuid(),
  action: z.enum(["add", "remove"]),
  email: z.email().max(254),
});

/**
 * POST /api/billing/plan-admins
 * The buyer of a multi-listing plan adds or removes its second named
 * administrator (an identity-reviewed account). The database checks that the
 * caller bought this plan and enforces the two-administrator limit.
 */
export async function POST(request: NextRequest) {
  const guard = await enforceBillingMutationGuard({
    request,
    log,
    rateLimitAction: "billing:plan-admins",
    degradedMessage: "Administrators cannot be changed right now. Please try again shortly.",
    limitedMessage: "Too many changes. Please try again later.",
  });
  if (!guard.success) return guard.response;

  const parsed = await parseAndValidateJsonRequest(request, schema, {
    invalidJsonMessage: "Invalid request",
    validationErrorMessage: "Enter a valid email address",
    includeValidationDetails: false,
  });
  if (!parsed.success) return parsed.response;

  const { data, error } = await createAdminClient().rpc("owner_manage_plan_admin", {
    p_owner: guard.user.id,
    p_entitlement: parsed.data.entitlementId,
    p_action: parsed.data.action,
    p_email: parsed.data.email,
  });
  if (error) {
    const mapped = mapCommercialError(error.message);
    if (!mapped) log.warn("Plan administrator change failed", { code: error.code });
    return NextResponse.json(
      { error: mapped?.message ?? "The change could not be applied." },
      { status: mapped?.status ?? 409 }
    );
  }
  return NextResponse.json({ success: true, data });
}
