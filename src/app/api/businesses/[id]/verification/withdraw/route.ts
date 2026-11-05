import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logAuditEvent } from "@/lib/services/audit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("BusinessVerificationWithdraw");

const bodySchema = z.object({ caseId: z.string().uuid() });

/** POST /api/businesses/[id]/verification/withdraw — the owner cancels an open case. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request,
      log,
      action: "business-verification:withdraw",
      mutate: true,
      unavailableMessage: "The withdrawal could not be confirmed. Reload the business check.",
      signInMessage: "Sign in to withdraw this check",
      refusal: staffCommandRefusal,
      command: async (api, body) =>
        settleStaffCommand(
          api.rpc(
            "withdraw_frontend_business_check",
            {
              p_business: z.uuid().parse((await params).id),
              p_case: bodySchema.strict().parse(body).caseId,
            },
            { get: false }
          ),
          z.strictObject({ ok: z.literal(true) })
        ),
    });
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      requireIdReviewed: false,
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;

    const parsed = await parseAndValidateJsonRequest(request, bodySchema);
    if (!parsed.success) return parsed.response;

    const { data, error } = await admin
      .from("business_verifications")
      .update({ status: "withdrawn", decided_at: new Date().toISOString() })
      .eq("id", parsed.data.caseId)
      .eq("business_id", business.id)
      .eq("owner_id", userId)
      .in("status", ["pending", "info_requested"])
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length)
      return NextResponse.json({ error: "No open case to cancel." }, { status: 404 });

    await logAuditEvent({
      actorId: userId,
      actorRole: "member",
      action: "business_verification_withdrawn",
      targetType: "business",
      targetId: business.id,
      area: "MZANSI_BUSINESS",
      metadata: { caseId: parsed.data.caseId },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    log.error("Withdraw failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: "We couldn't cancel that. Please try again." },
      { status: 500 }
    );
  }
}
