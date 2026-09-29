import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { sanitizeUserMessage } from "@/lib/utils/sanitize-html";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";

const log = createLogger("DsarIntake");

const intakeSchema = z.object({
  type: z.enum(["access", "correction", "deletion", "objection"]),
  requesterEmail: z.string().trim().toLowerCase().email().max(254),
  requesterPhone: z.string().trim().max(30).optional(),
  description: z.string().trim().min(10).max(2000),
  /** How the request arrived and how identity will be checked. */
  intakeNote: z.string().trim().min(10).max(1000),
  /** When the request actually arrived (for example by post). Defaults to now. */
  receivedAt: z.string().datetime({ offset: true }).optional(),
});

/** A request cannot be backdated past the longest rule window. */
const MAX_BACKDATE_MS = 60 * 24 * 60 * 60 * 1000;

/**
 * POST /api/admin/dsar/intake
 *
 * Record a data request made outside the website (email, post, phone), for
 * someone who cannot sign in. The deadline runs from when it arrived, set
 * by the database from the deadline rules. Identity starts unverified and
 * must be checked manually before anything is disclosed.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "dsar:manage",
      rateLimitAction: "admin:dsar:intake",
    });
    if (!guard.success) return guard.response;

    const body = await parseAndValidateJsonRequest(request, intakeSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Check the request details and try again.",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const input = body.data;

    const now = Date.now();
    const receivedAt = input.receivedAt ? new Date(input.receivedAt) : new Date(now);
    if (receivedAt.getTime() > now + 60_000) {
      return NextResponse.json(
        { error: "The received date cannot be in the future." },
        { status: 400 }
      );
    }
    if (receivedAt.getTime() < now - MAX_BACKDATE_MS) {
      return NextResponse.json(
        {
          error:
            "The received date is more than 60 days ago. Check it with the Information Officer.",
        },
        { status: 400 }
      );
    }

    const admin = createAdminClient();
    const { data: matched, error: lookupError } = await admin.rpc("auth_user_id_by_email", {
      p_email: input.requesterEmail,
    });
    if (lookupError) throw new Error(`subject lookup failed: ${lookupError.message}`);
    const subjectId = typeof matched === "string" ? matched : null;

    const { data: created, error } = await admin
      .from("dsar_cases")
      .insert({
        type: input.type,
        requester_email: input.requesterEmail,
        requester_phone: input.requesterPhone || "not_provided",
        description: [
          sanitizeUserMessage(input.description),
          `Intake note (staff): ${sanitizeUserMessage(input.intakeNote)}`,
        ].join("\n\n"),
        identity_verified: false,
        identity_check: "manual",
        status: "submitted",
        received_at: receivedAt.toISOString(),
        // Placeholder: the database sets the real due date from the rules.
        due_by: receivedAt.toISOString(),
        subject_user_id: subjectId,
        intake_by: guard.user.id,
      })
      .select("id, due_by")
      .single();
    if (error || !created) throw new Error(`DSAR intake insert failed: ${error?.message}`);

    await logAuditEvent({
      action: "dsar_requested",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetType: "dsar_case",
      targetId: created.id,
      metadata: { type: input.type, channel: "manual_intake", linkedAccount: subjectId !== null },
    });

    return NextResponse.json(
      {
        status: "created",
        requestId: created.id,
        reference: `DSAR-${created.id.slice(0, 8).toUpperCase()}`,
        dueBy: created.due_by,
      },
      { status: 201 }
    );
  } catch (err) {
    logApiError(log, "DSAR intake failed", err);
    return internalApiError();
  }
}
