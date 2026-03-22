import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { logAuditEvent } from "@/lib/services/audit";
import { verifyAdminActorRoleFromDb } from "@/lib/auth/admin-access";
import { createLogger } from "@/lib/utils/logger";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { ACCOUNT_PROFILE_WRITE_TABLE, getOwnerColumn } from "@/lib/account/compat";
import { parseAndValidateSearchParams } from "@/lib/utils/api";
import { uuidSchema } from "@/lib/validations/shared";
import { z } from "zod";

const log = createLogger("DSARExport");
const dsarExportQuerySchema = z.object({
  requestId: uuidSchema,
});

type AuthListUser = {
  id: string;
  email?: string | null;
};

type AuthListUsersResponse = {
  data?: {
    users?: AuthListUser[];
  };
  error?: {
    message?: string | null;
  } | null;
};

type AuthAdminLike = {
  listUsers?: (params: { page: number; perPage: number }) => Promise<AuthListUsersResponse>;
};

async function resolveUserIdByEmail(
  admin: ReturnType<typeof createAdminClient>,
  email: string
): Promise<
  | { status: "matched"; userId: string }
  | { status: "not_found" | "ambiguous" | "unavailable"; userId: null }
> {
  const authAdmin = (admin.auth as { admin?: AuthAdminLike } | undefined)?.admin;
  if (!authAdmin?.listUsers) {
    return { status: "unavailable", userId: null };
  }

  const normalizedEmail = email.trim().toLowerCase();
  const matches: AuthListUser[] = [];
  const perPage = 200;

  for (let page = 1; page <= 10; page += 1) {
    const { data, error } = await authAdmin.listUsers({ page, perPage });
    if (error) {
      throw new Error(error.message || "Failed to resolve requester email");
    }

    const users = data?.users || [];
    matches.push(
      ...users.filter((user) => (user.email || "").trim().toLowerCase() === normalizedEmail)
    );

    if (users.length < perPage) {
      break;
    }
  }

  if (matches.length === 1) {
    return { status: "matched", userId: matches[0].id };
  }

  if (matches.length > 1) {
    return { status: "ambiguous", userId: null };
  }

  return { status: "not_found", userId: null };
}

// NOTE: This GET handler writes an audit log entry (dsar_exported). This is a
// deliberate side-effect — the export is a significant privacy action that must
// be audited. The endpoint is protected by admin auth, mitigating CSRF risk.
export async function GET(request: NextRequest) {
  try {
    const parsedQuery = parseAndValidateSearchParams(
      request.nextUrl.searchParams,
      dsarExportQuerySchema,
      {
        validationErrorMessage: "Valid requestId is required",
        includeValidationDetails: false,
      }
    );
    if (!parsedQuery.success) {
      return parsedQuery.response;
    }
    const { requestId } = parsedQuery.data;

    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const actorRole = await verifyAdminActorRoleFromDb(user);
    if (!actorRole) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rl = checkLocalRateLimit(user.id, "admin:dsar:export");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();

    const { data: dsarCase, error: dsarError } = await admin
      .from("dsar_cases")
      .select(
        "id, type, requester_email, requester_phone, identity_verified, description, status, due_by, completed_at, response_summary, processed_by, created_at, updated_at"
      )
      .eq("id", requestId)
      .maybeSingle();

    if (dsarError) {
      log.error("Failed to load DSAR case", { requestId, error: dsarError.message });
      return NextResponse.json({ error: "Failed to load DSAR request" }, { status: 500 });
    }

    if (!dsarCase) {
      return NextResponse.json({ error: "DSAR request not found" }, { status: 404 });
    }

    const caseAuditQuery = admin
      .from("audit_logs")
      .select(
        "id, actor_id, actor_role, action, target_type, target_id, area, metadata, created_at"
      )
      .eq("target_type", "dsar_case")
      .eq("target_id", requestId)
      .order("created_at", { ascending: true })
      .limit(250);

    const userResolution = await resolveUserIdByEmail(admin, dsarCase.requester_email);
    const matchedUserId = userResolution.userId;

    let accountProfile: Record<string, unknown> | null = null;
    let verificationSteps: Record<string, unknown>[] = [];
    let kycArtifacts: Record<string, unknown>[] = [];
    let listings: Record<string, unknown>[] = [];
    let businesses: Record<string, unknown>[] = [];
    let promotions: Record<string, unknown>[] = [];
    let contactEvents: Record<string, unknown>[] = [];
    let payments: Record<string, unknown>[] = [];
    let userAuditLogs: Record<string, unknown>[] = [];

    const { data: caseAuditLogs } = await caseAuditQuery;

    if (matchedUserId) {
      const listingOwnerColumn = await getOwnerColumn(admin as never, "listings");
      const businessOwnerColumn = await getOwnerColumn(admin as never, "businesses");
      const promotionOwnerColumn = await getOwnerColumn(admin as never, "promotions");
      const contactOwnerColumn = await getOwnerColumn(admin as never, "contact_events");

      const [
        profileResult,
        verificationStepsResult,
        kycArtifactsResult,
        listingsResult,
        businessesResult,
        promotionsResult,
        contactEventsResult,
        paymentsResult,
        userAuditLogsResult,
      ] = await Promise.all([
        admin
          .from(ACCOUNT_PROFILE_WRITE_TABLE)
          .select(
            "id, user_id, display_name, account_verification_status, phone, masked_phone_public, location_province, location_city, location_verified_at, account_status, strikes, suspended_until, banned_at, ban_reason, legal_hold, profile_completeness_score, created_at, updated_at"
          )
          .eq("user_id", matchedUserId)
          .maybeSingle(),
        admin
          .from("verification_steps")
          .select(
            "id, user_id, step_type, status, full_name, dob, document_type, location_method, location_province, location_city, location_town, phone_verified_at, reviewed_by, reviewed_at, reason_code, reason_note, submitted_at, created_at, updated_at"
          )
          .eq("user_id", matchedUserId)
          .order("created_at", { ascending: true }),
        admin
          .from("kyc_artifacts")
          .select(
            "id, user_id, step_type, artifact_kind, content_type, file_size_bytes, provider_ref, purge_after, status, created_at"
          )
          .eq("user_id", matchedUserId)
          .order("created_at", { ascending: true }),
        admin
          .from("listings")
          .select(
            "id, title, category, price_cents, price_negotiable, location_province, location_city, status, status_reason, published_at, expires_at, created_at, updated_at"
          )
          .eq(listingOwnerColumn, matchedUserId)
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("businesses")
          .select(
            "id, business_name, business_type, category, phone, whatsapp, email, website, location_province, location_city, status, status_reason, published_at, created_at, updated_at"
          )
          .eq(businessOwnerColumn, matchedUserId)
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("promotions")
          .select(
            "id, business_id, title, promotion_type, category, price_cents, price_negotiable, location_province, location_city, start_date, end_date, status, status_reason, published_at, created_at, updated_at"
          )
          .eq(promotionOwnerColumn, matchedUserId)
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("contact_events")
          .select("id, target_id, target_type, member_verified, contact_type, created_at")
          .eq(contactOwnerColumn, matchedUserId)
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("payments")
          .select(
            "id, area, amount_cents, status, provider, provider_payment_id, provider_reference, created_at, updated_at"
          )
          .eq("user_id", matchedUserId)
          .order("created_at", { ascending: false })
          .limit(500),
        admin
          .from("audit_logs")
          .select(
            "id, actor_id, actor_role, action, target_type, target_id, area, metadata, created_at"
          )
          .or(`actor_id.eq.${matchedUserId},target_id.eq.${matchedUserId}`)
          .order("created_at", { ascending: false })
          .limit(250),
      ]);

      accountProfile = (profileResult.data as Record<string, unknown> | null) || null;
      verificationSteps = (verificationStepsResult.data as Record<string, unknown>[] | null) || [];
      kycArtifacts = (kycArtifactsResult.data as Record<string, unknown>[] | null) || [];
      listings = (listingsResult.data as Record<string, unknown>[] | null) || [];
      businesses = (businessesResult.data as Record<string, unknown>[] | null) || [];
      promotions = (promotionsResult.data as Record<string, unknown>[] | null) || [];
      contactEvents = (contactEventsResult.data as Record<string, unknown>[] | null) || [];
      payments = (paymentsResult.data as Record<string, unknown>[] | null) || [];
      userAuditLogs = (userAuditLogsResult.data as Record<string, unknown>[] | null) || [];
    }

    await logAuditEvent({
      action: "dsar_exported",
      actorId: user.id,
      actorRole,
      targetId: requestId,
      targetType: "dsar_case",
      metadata: {
        resolution: userResolution.status,
        matchedUserId,
      },
    });

    const exportPackage = {
      generatedAt: new Date().toISOString(),
      generatedBy: user.id,
      request: dsarCase,
      identityResolution: {
        status: userResolution.status,
        requesterEmail: dsarCase.requester_email,
        matchedUserId,
      },
      notes: {
        scope:
          "This export includes the DSAR case, DSAR audit trail, and matched platform data when the requester email resolves to exactly one account.",
        exclusions:
          "Raw KYC files, encrypted identifiers, exact GPS coordinates, provider raw responses, and payment provider payload blobs are intentionally excluded.",
      },
      data: {
        caseAuditLogs: caseAuditLogs || [],
        accountProfile,
        verificationSteps,
        kycArtifacts,
        listings,
        businesses,
        promotions,
        contactEvents,
        payments,
        userAuditLogs,
      },
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
    log.error("Failed to export DSAR package", {
      error: error instanceof Error ? error.message : "unknown error",
    });
    return NextResponse.json({ error: "Failed to export DSAR package" }, { status: 500 });
  }
}
