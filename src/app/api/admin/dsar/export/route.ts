import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { parseAndValidateJsonRequest, rateLimitResponse } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";

const log = createLogger("DSARExport");

const PAGE_SIZE = 1000;
/** A direct download beyond this would need a background export job. */
const MAX_ROWS_PER_DATASET = 50_000;

const exportSchema = z.object({ requestId: uuidSchema });

class ExportIncompleteError extends Error {}

type Row = Record<string, unknown>;
type Admin = ReturnType<typeof createAdminClient>;

/**
 * Read every row of a dataset, page by page. Any error, or a dataset too
 * large for a direct download, stops the export: it is never returned
 * partially complete.
 */
async function fetchAll(
  label: string,
  build: () => {
    range: (
      from: number,
      to: number
    ) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>;
  }
): Promise<Row[]> {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1);
    if (error) throw new ExportIncompleteError(`${label}: ${error.message}`);
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) return rows;
    if (rows.length >= MAX_ROWS_PER_DATASET) {
      throw new ExportIncompleteError(`${label}: more than ${MAX_ROWS_PER_DATASET} rows`);
    }
  }
}

/** The subject's own audit events in full; other people's only as "staff" or "system". */
function redactAuditRow(row: Row, subjectId: string): Row {
  if (row.actor_id === subjectId) {
    return {
      action: row.action,
      target_type: row.target_type,
      metadata: row.metadata,
      created_at: row.created_at,
    };
  }
  return {
    action: row.action,
    target_type: row.target_type,
    by: row.actor_role === "system" ? "system" : "VerifyMzansi staff",
    created_at: row.created_at,
  };
}

async function collectSubjectData(admin: Admin, subjectId: string) {
  const byOwner = (table: string, columns: string) => () =>
    admin
      .from(table)
      .select(columns)
      .eq("owner_id", subjectId)
      .order("created_at", { ascending: true });
  const byUser = (table: string, columns: string) => () =>
    admin
      .from(table)
      .select(columns)
      .eq("user_id", subjectId)
      .order("created_at", { ascending: true });

  const [
    accountProfile,
    verificationSteps,
    kycArtifacts,
    listings,
    businesses,
    promotions,
    contactEvents,
    payments,
    auditLogs,
    introductoryTrials,
    restrictions,
    appeals,
  ] = await Promise.all([
    fetchAll("account profile", () =>
      admin
        .from("account_profiles")
        .select(
          "user_id, display_name, account_verification_status, phone, location_province, location_city, location_verified_at, account_status, strikes, suspended_until, banned_at, ban_reason, legal_hold, created_at, updated_at"
        )
        .eq("user_id", subjectId)
    ),
    fetchAll(
      "verification steps",
      byUser(
        "verification_steps",
        "id, step_type, status, full_name, dob, document_type, location_method, location_province, location_city, location_town, phone_verified_at, reviewed_at, reason_code, reason_note, submitted_at, created_at, updated_at"
      )
    ),
    fetchAll(
      "KYC artifacts",
      byUser(
        "kyc_artifacts",
        "id, step_type, artifact_kind, content_type, file_size_bytes, purge_after, status, created_at"
      )
    ),
    fetchAll(
      "listings",
      byOwner(
        "listings",
        "id, title, category, price_cents, price_negotiable, location_province, location_city, status, status_reason, published_at, expires_at, created_at, updated_at"
      )
    ),
    fetchAll(
      "businesses",
      byOwner(
        "businesses",
        "id, business_name, business_type, category, phone, whatsapp, email, website, location_province, location_city, status, status_reason, published_at, created_at, updated_at"
      )
    ),
    fetchAll(
      "promotions",
      byOwner(
        "promotions",
        "id, business_id, title, promotion_type, category, price_cents, price_negotiable, location_province, location_city, start_date, end_date, status, status_reason, published_at, created_at, updated_at"
      )
    ),
    fetchAll("contact events", () =>
      admin
        .from("contact_events")
        .select(
          "id, target_id, target_type, member_verified, contact_type, sender_user_id, created_at"
        )
        .eq("owner_id", subjectId)
        .order("created_at", { ascending: true })
    ),
    fetchAll(
      "payments",
      byUser(
        "payments",
        "id, area, amount_cents, status, provider, provider_reference, created_at, updated_at"
      )
    ),
    fetchAll("audit log", () =>
      admin
        .from("audit_logs")
        .select("id, actor_id, actor_role, action, target_type, target_id, metadata, created_at")
        .or(`actor_id.eq.${subjectId},target_id.eq.${subjectId}`)
        .order("created_at", { ascending: true })
    ),
    fetchAll(
      "introductory trials",
      byUser(
        "intro_trial_claims",
        "id, area, content_id, duration_days, created_at, activated_at, expires_at, released_at, release_reason, converted_at"
      )
    ),
    fetchAll(
      "moderation decisions",
      byUser(
        "account_restrictions",
        "kind, reason, starts_at, ends_at, lifted_at, lift_reason, created_at"
      )
    ),
    fetchAll("appeals", () =>
      admin
        .from("appeal_cases")
        .select("status, reason, reviewer_rationale, created_at, resolved_at")
        .eq("appellant_id", subjectId)
        .order("created_at", { ascending: true })
    ),
  ]);

  return {
    accountProfile: accountProfile[0] ?? null,
    verificationSteps,
    kycArtifacts,
    listings,
    businesses,
    promotions,
    // Messages from other members: the sender is not identified.
    contactEvents: contactEvents.map(({ sender_user_id, ...rest }) => ({
      ...rest,
      sent_by_you: sender_user_id === subjectId,
    })),
    payments,
    auditLog: auditLogs.map((row) => redactAuditRow(row, subjectId)),
    introductoryTrials,
    moderationDecisions: restrictions,
    appeals,
  };
}

/**
 * POST /api/admin/dsar/export  { requestId }
 *
 * Build the complete export of a data subject's records as a download.
 * Needs dsar:manage, a second factor verified in the last 15 minutes, and a
 * verified requester identity. Nothing is stored: the file goes straight to
 * the staff member, who sends it to the requester.
 */
export async function POST(request: Request) {
  try {
    const guard = await enforceAdminMutationGuard({
      request,
      logger: log,
      capability: "dsar:manage",
      stepUp: true,
      rateLimitAction: "admin:dsar:export:local",
    });
    if (!guard.success) return guard.response;

    const rl = await checkSensitiveActionRateLimit(guard.user.id, "admin:dsar:export");
    if (rl.limited) return rateLimitResponse(rl.retryAfter ?? 60);

    const body = await parseAndValidateJsonRequest(request, exportSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Valid requestId is required",
      includeValidationDetails: false,
    });
    if (!body.success) return body.response;
    const { requestId } = body.data;

    const admin = createAdminClient();
    const { data: dsarCase, error: dsarError } = await admin
      .from("dsar_cases")
      .select(
        "id, type, requester_email, identity_verified, identity_check, description, status, received_at, due_by, extended_due_at, legal_basis, completed_at, response_summary, subject_user_id, created_at"
      )
      .eq("id", requestId)
      .maybeSingle();
    if (dsarError) {
      log.error("Failed to load DSAR case", { requestId, error: dsarError.message });
      return NextResponse.json({ error: "The request could not be loaded." }, { status: 500 });
    }
    if (!dsarCase) {
      return NextResponse.json({ error: "Data request not found." }, { status: 404 });
    }
    if (!dsarCase.identity_verified) {
      return NextResponse.json(
        {
          error: "Verify the requester's identity before exporting their data.",
          code: "identity_unverified",
        },
        { status: 409 }
      );
    }

    let subjectId: string | null = dsarCase.subject_user_id;
    let resolution = subjectId ? "linked_account" : "not_found";
    if (!subjectId) {
      const { data: matched, error: lookupError } = await admin.rpc("auth_user_id_by_email", {
        p_email: dsarCase.requester_email,
      });
      if (lookupError) throw new ExportIncompleteError(`subject lookup: ${lookupError.message}`);
      if (typeof matched === "string") {
        subjectId = matched;
        resolution = "exact_email_match";
      }
    }

    const data = subjectId ? await collectSubjectData(admin, subjectId) : null;

    await logAuditEvent({
      action: "dsar_exported",
      actorId: guard.user.id,
      actorRole: guard.actorRole,
      targetId: requestId,
      targetType: "dsar_case",
      metadata: {
        resolution,
        subjectId,
        datasets: data
          ? Object.fromEntries(
              Object.entries(data).map(([k, v]) => [k, Array.isArray(v) ? v.length : v ? 1 : 0])
            )
          : {},
      },
    });

    const exportPackage = {
      generatedAt: new Date().toISOString(),
      request: {
        reference: `DSAR-${requestId.slice(0, 8).toUpperCase()}`,
        type: dsarCase.type,
        receivedAt: dsarCase.received_at,
        dueBy: dsarCase.extended_due_at ?? dsarCase.due_by,
        legalBasis: dsarCase.legal_basis,
        status: dsarCase.status,
      },
      subject: { resolution },
      notes: {
        completeness:
          "Every record held for this account in the datasets below is included; the export is refused rather than cut short.",
        exclusions:
          "Raw identity documents and selfies, encrypted identifiers, exact GPS coordinates, provider raw responses and payment provider payloads are excluded. Other people (reporters, staff, other members) are not identified.",
      },
      data,
    };

    return new NextResponse(JSON.stringify(exportPackage, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="dsar-export-${requestId.slice(0, 8).toLowerCase()}.json"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const incomplete = error instanceof ExportIncompleteError;
    log.error("Failed to export DSAR package", {
      error: error instanceof Error ? error.message : "unknown error",
      incomplete,
    });
    return NextResponse.json(
      {
        error: incomplete
          ? "The export could not include every record, so nothing was exported. Try again, or contact the platform team if it keeps failing."
          : "The export failed. Try again.",
        code: incomplete ? "export_incomplete" : "export_failed",
      },
      { status: 500 }
    );
  }
}
