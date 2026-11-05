import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { notifyStaffForAdminEvent } from "@/lib/notifications";
import { logAuditEvent } from "@/lib/services/audit";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { settleStaffCommand, staffCommandRefusal } from "@/lib/foundation/staff-command";

const log = createLogger("BusinessVerificationSeenRequest");

const schema = z
  .object({
    method: z.enum(["video", "visit"]),
    /** Where to visit: any trading location. Never shown publicly. */
    address: z.string().trim().max(300).optional(),
    slots: z.array(z.string().trim().min(3).max(80)).min(1).max(3),
    consentScreenshots: z.literal(true),
  })
  .refine((v) => v.method === "video" || (v.address && v.address.length >= 5), {
    message: "Add the address we should visit",
    path: ["address"],
  });

/**
 * POST /api/businesses/[id]/verification/seen
 * The owner asks to be seen by VerifyMzansi: a live video call (default) or
 * an in-person visit where we can. Staff schedule it and report back.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (getDataBackend() === "foundation")
    return handleFoundationOwnerRoute({
      request,
      log,
      action: "business-verification:seen",
      mutate: true,
      successStatus: 201,
      unavailableMessage: "The business check could not be confirmed. Reload before trying again.",
      signInMessage: "Sign in to request a business check",
      refusal: staffCommandRefusal,
      command: async (api, body) => {
        const id = z.uuid().parse((await params).id);
        const input = schema.strict().parse(body);
        return settleStaffCommand(
          api.rpc(
            "request_frontend_business_seen",
            {
              p_business: id,
              p_method: input.method,
              p_slots: input.slots,
              p_consent: input.consentScreenshots,
              ...(input.method === "visit" && input.address ? { p_address: input.address } : {}),
            },
            { get: false }
          ),
          z.strictObject({
            caseId: z.uuid(),
            status: z.literal("pending"),
            reused: z.boolean().optional(),
          })
        );
      },
    });
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:seen",
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;
    const body = await parseAndValidateJsonRequest(request, schema, {
      includeValidationDetails: true,
    });
    if (!body.success) return body.response;

    const { data: created, error } = await admin
      .from("business_verifications")
      .insert({
        business_id: business.id,
        owner_id: userId,
        kind: "seen",
        seen: {
          method: body.data.method,
          address: body.data.method === "visit" ? body.data.address : null,
          slots: body.data.slots,
          consentScreenshots: true,
          requestedAt: new Date().toISOString(),
        },
      })
      .select("id")
      .single();
    if (error || !created) {
      if (error?.code === "23505") {
        return NextResponse.json(
          { error: "You already have a check booked for this business.", code: "case_open" },
          { status: 409 }
        );
      }
      throw new Error(error?.message ?? "insert failed");
    }

    await Promise.all([
      logAuditEvent({
        actorId: userId,
        actorRole: "member",
        action: "business_verification_seen_requested",
        targetType: "business",
        targetId: business.id,
        area: "MZANSI_BUSINESS",
        metadata: { caseId: created.id, method: body.data.method },
      }),
      notifyStaffForAdminEvent({
        capability: "queue:view",
        type: "info",
        title: body.data.method === "visit" ? "Business visit requested" : "Video check requested",
        message: `${business.business_name} asked to be seen by VerifyMzansi.`,
        href: `/admin/business-verification/${created.id}`,
        excludeUserId: userId,
      }),
    ]);
    return NextResponse.json({ caseId: created.id, status: "pending" }, { status: 201 });
  } catch (error) {
    log.error("Seen request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json(
      { error: "We couldn't book that. Please try again." },
      { status: 500 }
    );
  }
}
