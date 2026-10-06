import { NextResponse } from "next/server";
import { z } from "zod";

import { MIN_SEEN_PHOTOS, PREMISES_TYPES, type SeenState } from "@/lib/business-verification/seen";
import { createNotification } from "@/lib/notifications";
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";
import { logAuditEvent } from "@/lib/services/audit";
import { createAdminClient } from "@/lib/supabase/admin";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { createLogger } from "@/lib/utils/logger";

import { loadOpenSeenCase, requireStaffCase } from "../../_lib/staff-guard";

const log = createLogger("AdminBusinessVerificationVisit");

const schema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("schedule"),
    expectedUpdatedAt: z.string().min(10).max(64),
    scheduledFor: z.string().datetime({ offset: true }),
  }),
  z.object({
    action: z.literal("report"),
    expectedUpdatedAt: z.string().min(10).max(64),
    outcome: z.enum(["seen", "not_confirmed"]),
    identityConfirmed: z.boolean(),
    signage: z.boolean(),
    productsSeen: z.string().trim().min(3).max(500),
    premisesType: z.enum(PREMISES_TYPES),
    notes: z.string().trim().max(1000).nullable(),
    /** Visits: the town or city where the business was seen (public on the sticker). */
    city: z.string().trim().max(80).nullable().optional(),
  }),
]);

/**
 * POST /api/admin/business-verification/[id]/visit
 * "schedule": the verifier takes the check and books a time (the owner is
 * told the date and the verifier's first name). "report": the verifier who
 * took it records what they saw; a different staff member approves.
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // Claims are checked below: the assigned verifier keeps working their
    // booked check without re-claiming it.
    const guard = await requireStaffCase(request, params, {
      log,
      capability: "queue:claim",
      requireClaim: false,
    });
    if (guard instanceof NextResponse) return guard;

    const body = await parseAndValidateJsonRequest(request, schema, {
      includeValidationDetails: true,
    });
    if (!body.success) return body.response;

    const row = await loadOpenSeenCase(guard);
    if (row instanceof NextResponse) return row;
    const admin = createAdminClient();
    const seen = row.seen;
    let next: SeenState;

    const previousVerifier =
      seen.assignedTo && seen.assignedTo !== guard.user.id ? seen.assignedTo : null;
    if (body.data.action === "schedule") {
      if (seen.report) {
        return NextResponse.json(
          { error: "The report is already sent; this check can't be rebooked." },
          { status: 409 }
        );
      }
      if (previousVerifier && !["governance_controller", "admin"].includes(guard.actorRole)) {
        return NextResponse.json(
          {
            error:
              "Another verifier booked this check. Ask a governance controller to reassign it.",
          },
          { status: 403 }
        );
      }
      if (seen.assignedTo !== guard.user.id) {
        const refused = await checkQueueClaim(guard.user.id, {
          type: "business_verification",
          id: row.id,
        });
        if (refused) return refused;
      }
      if (Date.parse(body.data.scheduledFor) < Date.now() - 3_600_000) {
        return NextResponse.json({ error: "Choose a time in the future." }, { status: 400 });
      }
      next = { ...seen, assignedTo: guard.user.id, scheduledFor: body.data.scheduledFor };
    } else {
      if (seen.assignedTo !== guard.user.id) {
        return NextResponse.json(
          { error: "Only the verifier who booked this check can report on it." },
          { status: 403 }
        );
      }
      const myPhotos = (seen.photos ?? []).filter((p) => p.by === guard.user.id);
      if (body.data.outcome === "seen" && myPhotos.length < MIN_SEEN_PHOTOS) {
        return NextResponse.json(
          { error: `Add at least ${MIN_SEEN_PHOTOS} photos or screenshots first.` },
          { status: 400 }
        );
      }
      const { action: _a, expectedUpdatedAt: _e, ...report } = body.data;
      next = { ...seen, report: { ...report, by: guard.user.id, at: new Date().toISOString() } };
    }

    const { data: updated, error: updateError } = await admin
      .from("business_verifications")
      .update({ seen: next })
      .eq("id", row.id)
      .eq("updated_at", body.data.expectedUpdatedAt)
      .select("id");
    if (updateError) throw new Error(updateError.message);
    if (!updated?.length) {
      return NextResponse.json(
        { error: "This case changed. Reload and check again." },
        { status: 409 }
      );
    }

    if (body.data.action === "schedule") {
      const { data: profile } = await admin
        .from("account_profiles")
        .select("display_name")
        .eq("user_id", guard.user.id)
        .maybeSingle();
      const firstName = String(profile?.display_name ?? "").split(/\s+/)[0] || "our verifier";
      const when = new Date(body.data.scheduledFor).toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        dateStyle: "medium",
        timeStyle: "short",
      });
      await createNotification({
        userId: row.owner_id,
        type: "info",
        title: seen.method === "visit" ? "Your visit is booked" : "Your video check is booked",
        message: `${when} with ${firstName} from VerifyMzansi. Reply on your Verify page to change it.`,
        href: `/dashboard/businesses/${row.business_id}/verification`,
      });
      if (previousVerifier) {
        await createNotification({
          userId: previousVerifier,
          type: "info",
          title: "A Seen check was reassigned",
          message: `${firstName} now runs this check (${when}).`,
          href: `/admin/business-verification/${row.id}`,
        });
      }
    }

    if (body.data.action === "report") {
      // A different staff member approves the report, so let them claim it.
      await releaseDecidedClaim(guard.user.id, { type: "business_verification", id: row.id });
    }

    await logAuditEvent({
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      action: `business_verification_seen_${body.data.action}`,
      targetType: "business",
      targetId: row.business_id,
      area: "MZANSI_BUSINESS",
      metadata: { caseId: row.id },
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    logApiError(log, "Seen visit action failed", error);
    return internalApiError();
  }
}
