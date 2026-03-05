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
    const { error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // For signup confirmations, redirect to login with a success message
      // so the user knows their email is verified and can now sign in.
      if (type === "signup") {
        return NextResponse.redirect(`${origin}/login?confirmed=true`);
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // Auth code exchange failed — redirect to login with error
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`);
}
