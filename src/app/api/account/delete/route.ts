import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";

const log = createLogger("AccountDelete");

const accountDeleteSchema = z.object({
  confirmation: z
    .string()
    .trim()
    .transform((value) => value.toUpperCase())
    .refine((value) => value === "DELETE", "Type DELETE to confirm account deletion"),
  currentPassword: z.string().max(128).optional().or(z.literal("")),
});

type SupabaseMutationResult = {
  error?: {
    code?: string | null;
    message?: string | null;
    details?: string | null;
  } | null;
};

function getIdentityProviders(user: { app_metadata?: unknown; identities?: unknown }): string[] {
  const providers = new Set<string>();
  const appMetadata = (user.app_metadata ?? {}) as Record<string, unknown>;
  if (typeof appMetadata.provider === "string") {
    providers.add(appMetadata.provider);
  }

  if (Array.isArray(user.identities)) {
    for (const identity of user.identities) {
      if (identity && typeof identity === "object") {
        const provider = (identity as Record<string, unknown>).provider;
        if (typeof provider === "string") {
          providers.add(provider);
        }
      }
    }
  }

  return [...providers];
}

function requiresPasswordReauth(user: { app_metadata?: unknown; identities?: unknown }): boolean {
  const providers = getIdentityProviders(user);
  return providers.length === 0 || providers.includes("email");
}

function isMissingSchemaError(error: NonNullable<SupabaseMutationResult["error"]>): boolean {
  const combined =
    `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    combined.includes("42p01") ||
    combined.includes("42703") ||
    combined.includes("does not exist") ||
    combined.includes("schema cache")
  );
}

async function allowMissingSchema(
  action: string,
  operation: PromiseLike<SupabaseMutationResult>
): Promise<SupabaseMutationResult> {
  const result = await operation;
  if (result.error && isMissingSchemaError(result.error)) {
    log.warn("Skipping account deletion cleanup step because schema is unavailable", {
      action,
      error: result.error.message,
      code: result.error.code,
    });
    return { error: null };
  }
  return result;
}

async function cleanupBlockingUserReferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string
): Promise<SupabaseMutationResult> {
  const operations: Array<[string, PromiseLike<SupabaseMutationResult>]> = [
    ["audit_logs.actor_id", admin.from("audit_logs").delete().eq("actor_id", userId)],
    [
      "audit_logs.target_seller_id",
      admin.from("audit_logs").update({ target_seller_id: null }).eq("target_seller_id", userId),
    ],
    [
      "reports.reporter_user_id",
      admin.from("reports").update({ reporter_user_id: null }).eq("reporter_user_id", userId),
    ],
    [
      "reports.assigned_to",
      admin.from("reports").update({ assigned_to: null }).eq("assigned_to", userId),
    ],
    [
      "dsar_cases.processed_by",
      admin.from("dsar_cases").update({ processed_by: null }).eq("processed_by", userId),
    ],
    [
      "verification_steps.reviewed_by",
      admin.from("verification_steps").update({ reviewed_by: null }).eq("reviewed_by", userId),
    ],
    [
      "feature_flags.updated_by",
      admin.from("feature_flags").update({ updated_by: null }).eq("updated_by", userId),
    ],
    [
      "contact_events.sender_user_id",
      admin.from("contact_events").update({ sender_user_id: null }).eq("sender_user_id", userId),
    ],
    [
      "listing_views.viewer_user_id",
      admin.from("listing_views").update({ viewer_user_id: null }).eq("viewer_user_id", userId),
    ],
    [
      "kyc_evidence_access_logs.actor_id",
      admin.from("kyc_evidence_access_logs").delete().eq("actor_id", userId),
    ],
    [
      "kyc_evidence_access_logs.user_id",
      admin.from("kyc_evidence_access_logs").delete().eq("user_id", userId),
    ],
    [
      "decision_record_events.actor_id",
      admin.from("decision_record_events").delete().eq("actor_id", userId),
    ],
    [
      "decision_records.approver_id",
      admin.from("decision_records").update({ approver_id: null }).eq("approver_id", userId),
    ],
    [
      "decision_records.secondary_approver_id",
      admin
        .from("decision_records")
        .update({ secondary_approver_id: null })
        .eq("secondary_approver_id", userId),
    ],
    [
      "decision_records.recommender_id",
      admin.from("decision_records").delete().eq("recommender_id", userId),
    ],
    [
      "appeal_cases.reviewer_id",
      admin.from("appeal_cases").update({ reviewer_id: null }).eq("reviewer_id", userId),
    ],
    ["appeal_cases.appellant_id", admin.from("appeal_cases").delete().eq("appellant_id", userId)],
    [
      "role_assignments_history.target_user_id",
      admin.from("role_assignments_history").delete().eq("target_user_id", userId),
    ],
    [
      "role_assignments_history.assigned_by",
      admin.from("role_assignments_history").delete().eq("assigned_by", userId),
    ],
    [
      "moderation_actions.actor_id",
      admin.from("moderation_actions").delete().eq("actor_id", userId),
    ],
    [
      "moderation_actions.target_owner_id",
      admin.from("moderation_actions").delete().eq("target_owner_id", userId),
    ],
  ];

  for (const [action, operation] of operations) {
    const result = await allowMissingSchema(action, operation);
    if (result.error) {
      return result;
    }
  }

  return { error: null };
}

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) return sameOriginFailure;

    const csrfFailure = enforceCsrfToken(request, log);
    if (csrfFailure) return csrfFailure;

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({
      key: ip,
      action: "account:delete",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: rateCheck.degraded ? 503 : 429,
          headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) },
        }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user?.id || !user.email) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const parsedBody = await parseAndValidateJsonRequest(request, accountDeleteSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) return parsedBody.response;

    const userRateCheck = await checkRateLimit({
      key: user.id,
      action: "account:delete",
      degradedMode: "local",
    });
    if (userRateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        {
          status: userRateCheck.degraded ? 503 : 429,
          headers: { "Retry-After": String(userRateCheck.retryAfter ?? 60) },
        }
      );
    }

    if (requiresPasswordReauth(user) && !parsedBody.data.currentPassword) {
      return NextResponse.json(
        {
          error: "Current password is required to delete this account.",
          code: "PASSWORD_REQUIRED",
        },
        { status: 400 }
      );
    }

    if (requiresPasswordReauth(user)) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: parsedBody.data.currentPassword ?? "",
      });
      if (signInError) {
        return NextResponse.json(
          { error: "Current password is incorrect", code: "INVALID_PASSWORD" },
          { status: 401 }
        );
      }
    }

    const admin = createAdminClient();
    const { data: profile, error: profileError } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("legal_hold")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileError) {
      log.error("Failed to check legal hold before account deletion", {
        userId: user.id,
        error: profileError.message,
      });
      return internalApiError("Unable to delete account right now");
    }

    if (profile?.legal_hold) {
      return NextResponse.json(
        {
          error:
            "This account cannot be deleted while a legal hold is active. Please contact support.",
          code: "LEGAL_HOLD",
        },
        { status: 409 }
      );
    }

    const cleanupResult = await cleanupBlockingUserReferences(admin, user.id);
    if (cleanupResult.error) {
      log.error("Account deletion cleanup failed", {
        userId: user.id,
        error: cleanupResult.error.message,
        code: cleanupResult.error.code,
      });
      return internalApiError("Unable to delete account right now");
    }

    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      log.error("Supabase auth user deletion failed", {
        userId: user.id,
        error: deleteError.message,
      });
      return internalApiError("Unable to delete account right now");
    }

    await supabase.auth.signOut().catch((error: unknown) => {
      log.warn("Account deleted but session sign-out failed", {
        userId: user.id,
        error: error instanceof Error ? error.message : "Unknown",
      });
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    logApiError(log, "Unexpected account deletion error", error);
    return internalApiError("Unable to delete account right now");
  }
}
