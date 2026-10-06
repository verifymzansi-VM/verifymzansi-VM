import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import {
  CODE_TTL_MINUTES,
  codesMatch,
  hashCode,
  isRepresentativeConfirmed,
  isWorkEmail,
  MAX_CODE_ATTEMPTS,
  newCode,
  type RepresentativeState,
} from "@/lib/business-verification/representative";
import { logAuditEvent } from "@/lib/services/audit";
import { sendWorkEmailCode } from "@/lib/services/email";
import { parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { requireVerificationOwner } from "../_lib/owner-guard";

const log = createLogger("BusinessVerificationWorkEmail");

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("send"),
    caseId: z.string().uuid(),
    email: z.string().trim().toLowerCase().email().max(254),
    position: z.string().trim().min(2).max(40),
  }),
  z.object({
    action: z.literal("verify"),
    caseId: z.string().uuid(),
    code: z
      .string()
      .trim()
      .regex(/^\d{6}$/),
  }),
]);

/**
 * POST /api/businesses/[id]/verification/work-email
 * Company representatives confirm a mailbox on the company's own domain:
 * "send" emails a 6-digit code, "verify" checks it (5 tries, 15 minutes).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await requireVerificationOwner(request, params, {
      log,
      mutation: true,
      rateAction: "business-verification:message",
    });
    if (ctx instanceof NextResponse) return ctx;
    const { admin, business, userId } = ctx;
    const body = await parseAndValidateJsonRequest(request, schema);
    if (!body.success) return body.response;

    const { data: row, error } = await admin
      .from("business_verifications")
      .select("id, route, status, representative, updated_at")
      .eq("id", body.data.caseId)
      .eq("business_id", business.id)
      .eq("owner_id", userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (
      !row ||
      row.route !== "representative" ||
      !["pending", "info_requested"].includes(row.status)
    ) {
      return NextResponse.json(
        { error: "No open company representative request." },
        { status: 404 }
      );
    }
    const state = (row.representative ?? {}) as RepresentativeState;

    const save = async (next: RepresentativeState) => {
      const { data, error: updateError } = await admin
        .from("business_verifications")
        .update({ representative: { ...next, confirmed: isRepresentativeConfirmed(next) } })
        .eq("id", row.id)
        .eq("updated_at", row.updated_at)
        .select("id");
      if (updateError) throw new Error(updateError.message);
      return (data?.length ?? 0) > 0;
    };

    if (body.data.action === "send") {
      if (!isWorkEmail(body.data.email)) {
        return NextResponse.json(
          {
            error:
              "Use your work email on your company's own website domain, not a personal mailbox.",
          },
          { status: 400 }
        );
      }
      const code = newCode();
      const ok = await save({
        ...state,
        email: body.data.email,
        position: body.data.position,
        codeHash: hashCode(row.id, code),
        codeExpiresAt: new Date(Date.now() + CODE_TTL_MINUTES * 60_000).toISOString(),
        attempts: 0,
        emailVerifiedAt: null,
        domainConfirmed: false,
      });
      if (!ok) return NextResponse.json({ error: "Please try again." }, { status: 409 });
      const sent = await sendWorkEmailCode({
        email: body.data.email,
        businessName: business.business_name,
        code,
      });
      if (!sent.success) {
        return NextResponse.json(
          { error: "We couldn't send the email. Check the address." },
          { status: 502 }
        );
      }
      return NextResponse.json({ sent: true });
    }

    // verify
    if (!state.codeHash || !state.codeExpiresAt || Date.parse(state.codeExpiresAt) < Date.now()) {
      return NextResponse.json({ error: "The code expired. Send a new one." }, { status: 400 });
    }
    if ((state.attempts ?? 0) >= MAX_CODE_ATTEMPTS) {
      return NextResponse.json({ error: "Too many tries. Send a new code." }, { status: 429 });
    }
    if (!codesMatch(state.codeHash, row.id, body.data.code)) {
      await save({ ...state, attempts: (state.attempts ?? 0) + 1 });
      return NextResponse.json({ error: "That code isn't right." }, { status: 400 });
    }
    const ok = await save({
      ...state,
      codeHash: null,
      codeExpiresAt: null,
      attempts: 0,
      emailVerifiedAt: new Date().toISOString(),
    });
    if (!ok) return NextResponse.json({ error: "Please try again." }, { status: 409 });
    await logAuditEvent({
      actorId: userId,
      actorRole: "member",
      action: "business_verification_work_email_verified",
      targetType: "business",
      targetId: business.id,
      area: "MZANSI_BUSINESS",
      metadata: { caseId: row.id, domain: state.email?.split("@")[1] ?? null },
    });
    return NextResponse.json({ verified: true });
  } catch (error) {
    log.error("Work email step failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ error: "Something went wrong. Please try again." }, { status: 500 });
  }
}
