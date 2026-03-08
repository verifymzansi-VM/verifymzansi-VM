import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NextResponse } from "next/server";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";
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
      // For email signup confirmations, the session is already established
      // via exchangeCodeForSession — redirect straight to dashboard.
      if (type === "signup") {
        return NextResponse.redirect(`${origin}/dashboard?confirmed=true`);
      }

      // For OAuth logins (Google, etc.), check if this is a new user
      // and ensure they have a seller_profiles row.
      const user = data?.session?.user;
      if (user?.app_metadata?.provider && user.app_metadata.provider !== "email") {
        try {
          const admin = createAdminClient();
          const { data: profile } = await admin
            .from("seller_profiles")
            .select("user_id")
            .eq("user_id", user.id)
            .maybeSingle();

          // Auto-create seller profile for new OAuth users
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
                seller_verification_status: "incomplete",
                account_status: "active",
              },
              { onConflict: "user_id" }
            );
          }
        } catch (err) {
          // Non-blocking: OAuth user can still proceed; profile can be created later
          log.warn("Failed to create seller profile for OAuth user", {
            userId: user.id,
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
