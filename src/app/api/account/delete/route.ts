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
import { queuePublicMediaCleanup } from "@/lib/services/media-cleanup";

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

/**
 * Clear references that would block deleting the auth user. The audit trail,
 * decision ledger, appeals, role history and moderation log are kept: they
 * reference the user only by id, and personal details in audit metadata are
 * redacted by redact_personal_audit_data() before the user is deleted.
 */
async function cleanupBlockingUserReferences(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  userId: string
): Promise<SupabaseMutationResult> {
  const operations: Array<[string, PromiseLike<SupabaseMutationResult>]> = [
    ["consent_records.user_id", admin.from("consent_records").delete().eq("user_id", userId)],
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
      "content_edit_requests.reviewed_by",
      admin.from("content_edit_requests").update({ reviewed_by: null }).eq("reviewed_by", userId),
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
      "content_views.viewer_user_id",
      admin.from("content_views").update({ viewer_user_id: null }).eq("viewer_user_id", userId),
    ],
    [
      // Keep the record that an ID document was viewed; only drop who viewed it.
      "kyc_evidence_access_logs.actor_id",
      admin.from("kyc_evidence_access_logs").update({ actor_id: null }).eq("actor_id", userId),
    ],
    [
      "kyc_evidence_access_logs.user_id",
      admin.from("kyc_evidence_access_logs").delete().eq("user_id", userId),
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

/**
 * Queue the user's uploaded public media (with its responsive variants) for
 * deletion and remove their avatar objects.
 */
async function removeUserStoredFiles(
  admin: ReturnType<typeof createAdminClient>,
  userId: string,
  urls: string[]
): Promise<{ error: string | null }> {
  if (urls.length > 0) {
    try {
      await queuePublicMediaCleanup(admin, urls, "account_deleted", userId);
    } catch (queueError) {
      return { error: queueError instanceof Error ? queueError.message : "Media cleanup failed" };
    }
  }

  const avatars = admin.storage.from("avatars");
  const { data: avatarFiles, error: listError } = await avatars.list(userId);
  if (listError) {
    return { error: listError.message };
  }
  const avatarPaths = (avatarFiles ?? []).map((file) => `${userId}/${file.name}`);
  if (avatarPaths.length > 0) {
    const { error: removeError } = await avatars.remove(avatarPaths);
    if (removeError) {
      return { error: removeError.message };
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

    // Staff give up their role first (Admin → Role Management), so the last
    // admin can never delete themselves out of the platform.
    const { data: staffAccess, error: staffError } = await admin.rpc("staff_access_of", {
      p_user: user.id,
    });
    if (staffError) {
      log.error("Failed to check staff role before account deletion", {
        userId: user.id,
        error: staffError.message,
      });
      return internalApiError("Unable to delete account right now");
    }
    if (Array.isArray(staffAccess) && staffAccess.length > 0) {
      return NextResponse.json(
        {
          error:
            "Staff accounts cannot be deleted while they hold a staff role. Ask an admin to remove your role first.",
          code: "STAFF_ROLE_ACTIVE",
        },
        { status: 409 }
      );
    }

    // Nothing irreversible happens before the account itself is deleted: a
    // failure here leaves the account, its posts and its records intact.
    const cleanupResult = await cleanupBlockingUserReferences(admin, user.id);
    if (cleanupResult.error) {
      log.error("Account deletion cleanup failed", {
        userId: user.id,
        error: cleanupResult.error.message,
        code: cleanupResult.error.code,
      });
      return internalApiError("Unable to delete account right now");
    }

    // Collect stored media first: the rows that list it go with the account.
    const { data: uploads, error: uploadsError } = await admin
      .from("media_uploads")
      .select("url")
      .eq("user_id", user.id);
    if (uploadsError) {
      log.error("Could not list media before account deletion", {
        userId: user.id,
        error: uploadsError.message,
      });
      return internalApiError("Unable to delete account right now");
    }
    const mediaUrls = (uploads ?? []).map((upload) => upload.url as string).filter(Boolean);

    // Posts, enquiries and verification cases go with the account (ON DELETE
    // CASCADE); payments and invoices stay for tax records, unlinked.
    const { error: deleteError } = await admin.auth.admin.deleteUser(user.id);
    if (deleteError) {
      log.error("Supabase auth user deletion failed", {
        userId: user.id,
        error: deleteError.message,
      });
      return internalApiError("Unable to delete account right now");
    }

    const { error: redactError } = await admin.rpc("redact_personal_audit_data", {
      p_user: user.id,
      p_reason: "Account deleted by the account holder",
    });
    if (redactError) {
      log.error("Audit redaction failed after account deletion", {
        userId: user.id,
        error: redactError.message,
      });
    }
    const storageResult = await removeUserStoredFiles(admin, user.id, mediaUrls);
    if (storageResult.error) {
      log.error("Storage cleanup failed after account deletion", {
        userId: user.id,
        error: storageResult.error,
      });
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
