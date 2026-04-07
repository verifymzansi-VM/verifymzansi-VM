import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkRateLimit, getClientIp } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { enforceSameOriginMutation } from "@/lib/utils/mutation-origin";
import { enforceCsrfToken } from "@/lib/utils/csrf";
import { internalApiError, logApiError, parseAndValidateJsonRequest } from "@/lib/utils/api";
import { ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import {
  checkCooldown,
  EMAIL_CHANGE_COOLDOWN_MS,
  emailCooldown,
} from "@/lib/account/identity-policy";

const log = createLogger("EmailChange");
const ACCOUNT_EMAIL_IN_USE_ERROR = "That email address is already in use by another account.";
const ACCOUNT_EMAIL_PENDING_CONFLICT_ERROR =
  "That email address is currently being verified by another account.";

const emailChangeSchema = z.object({
  newEmail: z
    .string()
    .email("Enter a valid email address")
    .max(256, "Email address is too long")
    .transform((v) => v.toLowerCase().trim()),
});

export async function POST(request: NextRequest) {
  try {
    const sameOriginFailure = enforceSameOriginMutation(request, log);
    if (sameOriginFailure) return sameOriginFailure;

    const csrfFailure = enforceCsrfToken(request, log);
    if (csrfFailure) return csrfFailure;

    const ip = getClientIp(request);
    const rateCheck = await checkRateLimit({ key: ip, action: "account:email-change" });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many requests. Please try again later." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Authentication required" }, { status: 401 });
    }

    const admin = createAdminClient();

    const parsedBody = await parseAndValidateJsonRequest(request, emailChangeSchema, {
      invalidJsonMessage: "Invalid JSON payload",
      validationErrorMessage: "Invalid request",
      includeValidationDetails: false,
    });
    if (!parsedBody.success) return parsedBody.response;

    const { newEmail } = parsedBody.data;

    // Prevent redundant change (prevents cooldown consumption for no-ops)
    if (newEmail === (user.email ?? "").toLowerCase()) {
      return NextResponse.json(
        { error: "This is already your current email address." },
        { status: 422 }
      );
    }

    // ── Cooldown check ────────────────────────────────────────────────
    const { data: profile, error: profileFetchError } = await supabase
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("contact_last_email_change_at")
      .eq("user_id", user.id)
      .maybeSingle();

    if (profileFetchError) {
      log.error("Failed to fetch profile for email change policy check", {
        userId: user.id,
        error: profileFetchError.message,
      });
      return internalApiError();
    }

    const cooldownUntil = checkCooldown(
      profile?.contact_last_email_change_at,
      EMAIL_CHANGE_COOLDOWN_MS
    );
    if (cooldownUntil) {
      const policyErr = emailCooldown(cooldownUntil);
      return NextResponse.json(
        { error: policyErr.message, code: policyErr.code, retryAfter: policyErr.retryAfter },
        { status: 429 }
      );
    }

    const { data: pendingEmailConflict, error: pendingEmailConflictError } = await admin
      .from(ACCOUNT_PROFILE_WRITE_TABLE)
      .select("user_id")
      .eq("pending_email", newEmail)
      .neq("user_id", user.id)
      .limit(1)
      .maybeSingle();

    if (pendingEmailConflictError) {
      log.error("Failed to check pending email ownership conflict", {
        userId: user.id,
        error: pendingEmailConflictError.message,
      });
      return internalApiError();
    }

    if (pendingEmailConflict) {
      return NextResponse.json(
        { error: ACCOUNT_EMAIL_PENDING_CONFLICT_ERROR, code: "email_pending_conflict" },
        { status: 409 }
      );
    }

    // ── Initiate Supabase email change (sends confirmation to newEmail) ─
    const { error: updateError } = await supabase.auth.updateUser({ email: newEmail });
    if (updateError) {
      log.error("Email change request failed", {
        userId: user.id,
        error: updateError.message,
      });
      if (updateError.message.toLowerCase().includes("already registered")) {
        return NextResponse.json({ error: ACCOUNT_EMAIL_IN_USE_ERROR }, { status: 409 });
      }
      return NextResponse.json(
        { error: "Failed to initiate email change. Please try again." },
        { status: 500 }
      );
    }

    // ── Stamp cooldown and record audit trail ─────────────────────────
    const nowIso = new Date().toISOString();

    // Cooldown starts at request time so bulk re-submission is throttled even
    // if the user never confirms the change.
    const [profileUpdate, auditInsert] = await Promise.allSettled([
      admin
        .from(ACCOUNT_PROFILE_WRITE_TABLE)
        .update({
          pending_email: newEmail,
          contact_last_email_change_at: nowIso,
        })
        .eq("user_id", user.id),
      admin.from("contact_change_history").insert({
        user_id: user.id,
        change_type: "email",
        requested_at: nowIso,
        source: "user",
      }),
    ]);

    if (profileUpdate.status === "rejected") {
      log.error("Failed to stamp email change cooldown on profile", {
        userId: user.id,
        error: String(profileUpdate.reason),
      });
    } else if (profileUpdate.value.error?.code === "23505") {
      return NextResponse.json(
        { error: ACCOUNT_EMAIL_PENDING_CONFLICT_ERROR, code: "email_pending_conflict" },
        { status: 409 }
      );
    }
    if (auditInsert.status === "rejected") {
      log.warn("Failed to write email change audit record", {
        userId: user.id,
        error: String(auditInsert.reason),
      });
    }

    return NextResponse.json({
      success: true,
      message:
        "Confirmation email sent to your new address. Please check your inbox and click the link to complete the change.",
    });
  } catch (error) {
    logApiError(log, "Unexpected email change error", error);
    return internalApiError();
  }
}
