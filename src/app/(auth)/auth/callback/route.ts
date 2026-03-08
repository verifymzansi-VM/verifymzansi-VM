import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { sanitizeReturnUrl } from "@/lib/utils/navigation";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = sanitizeReturnUrl(searchParams.get("next"));
  const type = searchParams.get("type"); // Supabase passes type=signup for email confirmation

  if (code) {
    const supabase = await createClient();
    const { error, data } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For email signup confirmations, redirect to login with a success message
      if (type === "signup") {
        return NextResponse.redirect(`${origin}/login?confirmed=true`);
      }

      // For OAuth logins (Google, etc.), check if this is a new user
      // and ensure they have a seller_profiles row.
      const user = data?.session?.user;
      if (user?.app_metadata?.provider && user.app_metadata.provider !== "email") {
        const admin = await createClient();
        const { data: profile } = await admin
          .from("seller_profiles")
          .select("id")
          .eq("id", user.id)
          .single();

        // Auto-create seller profile for new OAuth users
        if (!profile) {
          const displayName =
            user.user_metadata?.full_name ||
            user.user_metadata?.name ||
            user.email?.split("@")[0] ||
            "User";

          await admin.from("seller_profiles").insert({
            id: user.id,
            display_name: displayName,
            email: user.email,
            seller_verification_status: "incomplete",
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
