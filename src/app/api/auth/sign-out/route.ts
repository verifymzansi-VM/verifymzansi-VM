import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("SignOut");

export async function POST(request: Request) {
  try {
    const supabase = await createClient();
    await supabase.auth.signOut();
  } catch (err) {
    log.error("Sign-out error", { error: err instanceof Error ? err.message : "unknown error" });
    // Continue to redirect even if sign-out fails
  }

  const { origin } = new URL(request.url);
  return NextResponse.redirect(`${origin}/`, { status: 302 });
}
