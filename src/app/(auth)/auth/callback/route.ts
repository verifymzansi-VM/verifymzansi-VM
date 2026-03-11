import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
import { ACCOUNT_PROFILE_NOT_FOUND_ERROR } from "@/lib/account/compat";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("AuthCallback");

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeReturnUrl(searchParams.get("next"));
  const type = searchParams.get("type"); // Supabase passes type=signup for email confirmation

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For email signup confirmations, honor the requested success route.
      // Legacy links without `next` still fall back to the login success state.
      if (type === "signup") {
        const confirmedPath = next === "/dashboard" ? "/login?confirmed=true" : next;
        return NextResponse.redirect(`${origin}${confirmedPath}`);
      }

      // For OAuth logins (Google, etc.), check if this is a new user
      // and ensure they have an account profile row.
      const user = data?.session?.user;
      if (user?.app_metadata?.provider && user.app_metadata.provider !== "email") {
        try {
          const admin = createAdminClient();
          const { data: profile } = await admin
            .from("seller_profiles")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

          // Auto-create an account profile for new OAuth users.
          if (!profile) {
            const displayName =
              user.user_metadata?.full_name ||
              user.user_metadata?.name ||
              user.email?.split("@")[0] ||
              "User";

            await admin.from("seller_profiles").upsert(
              {
                user_id: user.id,
                display_name: displayName,
                account_verification_status: "incomplete",
                seller_verification_status: "incomplete",
                account_status: "active",
              },
              { onConflict: "user_id" }
            );
          }
        } catch (err) {
          // Non-blocking: OAuth users can still proceed; the account profile can be created later.
          log.warn("Failed to create account profile for OAuth user", {
            userId: user.id,
            message: ACCOUNT_PROFILE_NOT_FOUND_ERROR,
            error: err instanceof Error ? err.message : "Unknown",
          });
        }

        // OAuth users go straight to dashboard
        return NextResponse.redirect(`${origin}${next || "/dashboard"}`);
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
