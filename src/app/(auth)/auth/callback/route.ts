import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR, ACCOUNT_PROFILE_WRITE_TABLE } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import { createLogger } from "@/lib/utils/logger";
import { resolveAppOrigin } from "@/lib/utils/auth-redirect";

const log = createLogger("AuthCallback");

async function finalizePendingEmailChange(userId: string, confirmedEmail: string) {
  const admin = createAdminClient();
  const normalizedEmail = confirmedEmail.trim().toLowerCase();

  const { data: profile, error: profileError } = await admin
    .from(ACCOUNT_PROFILE_WRITE_TABLE)
    .select("pending_email")
    .eq("user_id", userId)
    .maybeSingle();

  if (profileError) {
    log.warn("Failed to read pending email during auth callback", {
      userId,
      error: profileError.message,
    });
    return;
  }

  const pendingEmail = profile?.pending_email?.trim().toLowerCase() ?? null;
  if (!pendingEmail || pendingEmail !== normalizedEmail) {
    return;
  }

  const appliedAt = new Date().toISOString();
  const [profileUpdate, historyRow] = await Promise.all([
    admin.from(ACCOUNT_PROFILE_WRITE_TABLE).update({ pending_email: null }).eq("user_id", userId),
    admin
      .from("contact_change_history")
      .select("id")
      .eq("user_id", userId)
      .eq("change_type", "email")
      .is("applied_at", null)
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  if (profileUpdate.error) {
    log.warn("Failed to clear pending email during auth callback", {
      userId,
      error: profileUpdate.error.message,
    });
  }

  if (historyRow.error) {
    log.warn("Failed to locate contact-change audit row during auth callback", {
      userId,
      error: historyRow.error.message,
    });
    return;
  }

  if (!historyRow.data?.id) {
    return;
  }

  const { error: historyUpdateError } = await admin
    .from("contact_change_history")
    .update({ applied_at: appliedAt })
    .eq("id", historyRow.data.id);

  if (historyUpdateError) {
    log.warn("Failed to mark email change as applied during auth callback", {
      userId,
      error: historyUpdateError.message,
    });
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const origin = resolveAppOrigin(request);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = sanitizeReturnUrl(rawNext);
  const type = searchParams.get("type"); // Supabase passes type=signup for email confirmation

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (error) {
      const msg = (error.message || "").toLowerCase();
      let errorCode = "auth_callback_failed";
      if (msg.includes("expired") || msg.includes("invalid") || msg.includes("not found")) {
        errorCode = "code_expired";
      } else if (msg.includes("already") || msg.includes("used")) {
        errorCode = "code_already_used";
      }
      log.warn("Auth callback code exchange failed", {
        errorCode,
        message: error.message,
      });
      return NextResponse.redirect(`${origin}/login?error=${errorCode}`);
    }

    const user = data?.session?.user;
    if (user?.id && user.email) {
      await finalizePendingEmailChange(user.id, user.email);
    }

    // For email signup confirmations, honor the requested success route.
    // Legacy links without `next` still fall back to the login success state.
    if (type === "signup") {
      const confirmedPath = rawNext ? next : "/login?confirmed=true";
      return NextResponse.redirect(`${origin}${confirmedPath}`);
    }

    // For OAuth logins (Google, etc.), check if this is a new user
    // and ensure they have an account profile row.
    if (user?.app_metadata?.provider && user.app_metadata.provider !== "email") {
      let isNewOAuthUser = false;
      try {
        const { data: existingProfile } = await supabase
          .from("account_profiles")
          .select("user_id")
          .eq("user_id", user.id)
          .maybeSingle();

        isNewOAuthUser = !existingProfile;

        let profile = await ensureAccountProfile(supabase, user);
        if (!profile) {
          // Retry once for transient DB errors — ensureAccountProfile uses upsert so this is safe
          log.warn("First ensureAccountProfile attempt returned null, retrying", {
            userId: user.id,
          });
          profile = await ensureAccountProfile(supabase, user);
        }
        if (!profile) {
          log.error("Failed to create account profile for OAuth user", {
            userId: user.id,
            message: ACCOUNT_PROFILE_NOT_FOUND_ERROR,
          });
          return NextResponse.redirect(`${origin}/login?error=profile_creation_failed`);
        }
      } catch (err) {
        // Profile creation threw — redirect to login with error so the user
        // can retry rather than landing on a broken dashboard.
        log.error("Failed to create account profile for OAuth user", {
          userId: user.id,
          message: ACCOUNT_PROFILE_NOT_FOUND_ERROR,
          error: err instanceof Error ? err.message : "Unknown",
          stack: err instanceof Error ? err.stack : undefined,
        });
        return NextResponse.redirect(`${origin}/login?error=profile_creation_failed`);
      }

      // Block login for suspended/banned/deleted accounts
      if (!isNewOAuthUser) {
        const adminForStatus = createAdminClient();
        const { data: statusProfile } = await adminForStatus
          .from("account_profiles")
          .select("account_status")
          .eq("user_id", user.id)
          .maybeSingle();

        const accountStatus = statusProfile?.account_status;
        if (
          accountStatus === "suspended" ||
          accountStatus === "banned" ||
          accountStatus === "deleted"
        ) {
          await supabase.auth.signOut();
          log.warn("OAuth login blocked: account status", {
            userId: user.id,
            status: accountStatus,
          });
          return NextResponse.redirect(`${origin}/login?error=account_suspended`);
        }
      }

      // New OAuth users go to complete-profile to add their phone number;
      // returning users go to their requested destination.
      if (isNewOAuthUser) {
        const completeProfileUrl = new URL("/dashboard/complete-profile", origin);
        if (rawNext && next && next !== "/dashboard" && next !== "/") {
          completeProfileUrl.searchParams.set("returnUrl", next);
        }
        return NextResponse.redirect(completeProfileUrl);
      }
      return NextResponse.redirect(`${origin}${next || "/"}`);
    }

    return NextResponse.redirect(`${origin}${next}`);
  }

  // No code parameter — redirect to login
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
