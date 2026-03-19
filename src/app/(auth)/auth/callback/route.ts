import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import { ensureAccountProfile } from "@/lib/account/ensure-profile";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AuthCallback");

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const rawNext = searchParams.get("next");
  const next = sanitizeReturnUrl(rawNext);
  const type = searchParams.get("type"); // Supabase passes type=signup for email confirmation

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For email signup confirmations, honor the requested success route.
      // Legacy links without `next` still fall back to the login success state.
      if (type === "signup") {
        const confirmedPath = rawNext ? next : "/login?confirmed=true";
        return NextResponse.redirect(`${origin}${confirmedPath}`);
      }

      // For OAuth logins (Google, etc.), check if this is a new user
      // and ensure they have an account profile row.
      const user = data?.session?.user;
      if (user?.app_metadata?.provider && user.app_metadata.provider !== "email") {
        let isNewOAuthUser = false;
        try {
          // Check existence first so we know whether ensureAccountProfile creates a new row.
          const { data: existingProfile } = await supabase
            .from("account_profiles")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

          if (!existingProfile) {
            const profile = await ensureAccountProfile(supabase, user);
            if (!profile) {
              log.error("Failed to create account profile for OAuth user", {
                userId: user.id,
                message: ACCOUNT_PROFILE_NOT_FOUND_ERROR,
              });
              // Redirect to login with error instead of continuing without a profile.
              // Without a profile row the user would hit errors on every protected page.
              return NextResponse.redirect(`${origin}/login?error=profile_creation_failed`);
            } else {
              isNewOAuthUser = true;
            }
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

        // New OAuth users go to complete-profile to add their phone number;
        // returning users go to their requested destination.
        if (isNewOAuthUser) {
          const completeProfileUrl = new URL("/dashboard/complete-profile", origin);
          if (next && next !== "/dashboard") {
            completeProfileUrl.searchParams.set("returnUrl", next);
          }
          return NextResponse.redirect(completeProfileUrl);
        }
        return NextResponse.redirect(`${origin}${next || "/dashboard"}`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
