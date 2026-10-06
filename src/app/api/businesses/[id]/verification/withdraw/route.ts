import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { logAuditEvent } from "@/lib/services/audit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";

const log = createLogger("BusinessVerificationWithdraw");

const bodySchema = z.object({ caseId: z.string().uuid() });

/** POST /api/businesses/[id]/verification/withdraw — the owner cancels an open case. */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
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
