import { NextRequest, NextResponse } from "next/server";
import { withAllPrivateFields } from "@/lib/content/private-fields";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { createLogger } from "@/lib/utils/logger";
import { checkSensitiveActionRateLimit } from "@/lib/utils/rate-limit";
import { enforceAdminMutationGuard } from "@/lib/utils/admin-route-guard";
import { parseAndValidateJsonRequest, rateLimitResponse } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { getDataBackend } from "@/lib/data-backend";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { privacyRevision } from "@/lib/foundation/privacy-requests";
import {
  FoundationStaffCommandError,
  settleStaffCommand,
  staffCommandRefusal,
} from "@/lib/foundation/staff-command";

const log = createLogger("DSARExport");

const PAGE_SIZE = 1000;
/** A direct download beyond this would need a background export job. */
const MAX_ROWS_PER_DATASET = 50_000;

const exportSchema = z.object({ requestId: uuidSchema });

/** Datasets in a foundation access export (33 since database update
 * 20261109073519_post_lifecycle_guards.sql added event_submissions). */
const FOUNDATION_EXPORT_DATASET_COUNT = 33;

class ExportIncompleteError extends Error {
  override name = "ExportIncompleteError";
}

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
    businessVerifications,
    enquiriesSent,
    enquiriesReceived,
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
        "id, title, description, category, price_cents, price_zar, price_negotiable, location_province, location_city, status, status_reason, published_at, expires_at, created_at, updated_at"
      )
    ),
    fetchAll(
      "businesses",
      byOwner(
        "businesses",
        "id, business_name, description, business_type, category, website, location_province, location_city, status, status_reason, published_at, created_at, updated_at"
      )
    ),
    fetchAll(
      "promotions",
      byOwner(
        "promotions",
        "id, business_id, title, description, promotion_type, category, price_cents, price_negotiable, location_province, location_city, start_date, end_date, status, status_reason, published_at, created_at, updated_at"
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
    fetchAll(
      "business verifications",
      byOwner(
        "business_verifications",
        "id, business_id, kind, route, status, registration_number, doc_type, registered_office, reason_code, decided_at, expires_at, created_at, updated_at"
      )
    ),
    fetchAll("enquiries sent", () =>
      admin
        .from("contact_events")
        .select("target_id, target_type, contact_type, created_at")
        .eq("sender_user_id", subjectId)
        .order("created_at", { ascending: true })
    ),
    // Messages other people sent the subject, without the senders' contact details.
    fetchAll("enquiries received", () =>
      admin
        .from("leads")
        .select("target_id, target_type, message, status, created_at")
        .eq("owner_id", subjectId)
        .order("created_at", { ascending: true })
    ),
  ]);

  return {
    accountProfile: accountProfile[0] ?? null,
    verificationSteps,
    kycArtifacts,
    // Contact details and street addresses live in the server-only private tables.
    listings: await withAllPrivateFields("listings", listings as Array<Row & { id: string }>),
    businesses: await withAllPrivateFields("businesses", businesses as Array<Row & { id: string }>),
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
    businessVerifications,
    // Only what the subject did; never the other side's identity.
    enquiriesSent: enquiriesSent.map(({ target_id, target_type, contact_type, created_at }) => ({
      target_id,
      target_type,
      contact_type,
      created_at,
    })),
    enquiriesReceived: enquiriesReceived.map(
      ({ target_id, target_type, message, status, created_at }) => ({
        target_id,
        target_type,
        message,
        status,
        created_at,
      })
    ),
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
  if (getDataBackend() === "foundation") {
    return handleFoundationOwnerRoute<{ request_id: string }>({
      request: request instanceof NextRequest ? request : new NextRequest(request),
      log,
      action: "admin:dsar:export:local",
      mutate: true,
      requireCaller: true,
      unavailableMessage: "The data export could not be confirmed. Nothing was exported.",
      signInMessage: "Sign in to review data requests",
      refusal: staffCommandRefusal,
      responseHeaders: (result) => ({
        "Content-Disposition": `attachment; filename="dsar-export-${result.request_id.slice(0, 8)}.json"`,
        "X-Content-Type-Options": "nosniff",
      }),
      command: async (api, body, caller) => {
        if (!caller) throw new Error("Verified staff caller required");
        const input = exportSchema.extend({ revision: privacyRevision }).strict().parse(body);
        const rl = await checkSensitiveActionRateLimit(caller.accountId, "admin:dsar:export");
        if (rl.degraded || rl.limited)
          throw new FoundationStaffCommandError(
            rl.degraded ? 503 : 429,
            "Export protection is temporarily unavailable or the limit has been reached."
          );
        const rpc = await api.rpc(
          "export_frontend_privacy_request",
          {
            p_case: input.requestId,
            p_revision: input.revision,
          },
          { get: false }
        );
        if (rpc.error?.code === "PT413")
          throw new FoundationStaffCommandError(
            413,
            "The export is too large for a direct download. Nothing was exported."
          );
        const date = z.iso.datetime({ offset: true });
        const result = await settleStaffCommand(
          Promise.resolve(rpc),
          z
            .strictObject({
              request_id: z.literal(input.requestId),
              reference: z.literal(`DSAR-${input.requestId.slice(0, 8).toUpperCase()}`),
              generated_at: date,
              request_type: z.literal("access"),
              received_at: date,
              due_by: date,
              account_found: z.boolean(),
              datasets: z.record(
                z.string().regex(/^[a-z_]{1,40}$/),
                z.array(z.record(z.string(), z.unknown())).max(2500)
              ),
            })
            .refine((v) =>
              v.account_found
                ? Object.keys(v.datasets).length === FOUNDATION_EXPORT_DATASET_COUNT
                : Object.keys(v.datasets).length === 0
            )
        );
        return {
          ...result,
          scope:
            "Account records in the listed datasets. Raw identity evidence, credentials, internal storage and provider data, and counterpart contact details are excluded.",
        };
      },
    });
  }
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
