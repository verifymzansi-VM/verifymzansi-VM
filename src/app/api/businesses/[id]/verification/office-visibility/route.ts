import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { publicOffice } from "@/lib/business-verification/public";
import { approvedOffice } from "@/lib/business-verification/service";
import { logAuditEvent } from "@/lib/services/audit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";

const log = createLogger("BusinessRegisteredOfficeVisibility");

const schema = z.object({ showFull: z.boolean() });

/**
 * PATCH /api/businesses/[id]/verification/office-visibility
 * The owner chooses whether the registered office's street lines are public.
 * Suburb, city and province always show once CIPC is verified.
 */
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      requireIdReviewed: false,
      rateAction: "business-verification:settings",
    });
    if (ctx instanceof NextResponse) return ctx;
    const body = await parseAndValidateJsonRequest(request, schema);
    if (!body.success) return body.response;

    // The public column is rebuilt from the approved case's full office, so
    // hidden street lines are never stored where anyone can read them.
    const office = await approvedOffice(ctx.admin, ctx.business.id);
    const { data, error } = await ctx.admin
      .from("businesses")
      .update({
        show_full_registered_office: body.data.showFull,
        cipc_registered_office: publicOffice(office, body.data.showFull),
      })
      .eq("id", ctx.business.id)
      .eq("owner_id", ctx.userId)
      .not("cipc_verified_at", "is", null)
      .select("id");
    if (error) throw new Error(error.message);
    if (!data?.length) {
      return NextResponse.json({ error: "Verify your CIPC registration first." }, { status: 409 });
    }

    await logAuditEvent({
      actorId: ctx.userId,
      actorRole: "member",
      action: "business_verification_office_visibility_changed",
      targetType: "business",
      targetId: ctx.business.id,
      area: "MZANSI_BUSINESS",
      metadata: { showFull: body.data.showFull },
    });
    return NextResponse.json({ showFull: body.data.showFull });
  } catch (error) {
    log.error("Office visibility change failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Could not save. Please try again." }, { status: 500 });
  }
}
