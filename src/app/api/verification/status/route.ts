import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile } = await supabase
      .from("seller_profiles")
      .select("id, seller_verification_status")
      .eq("user_id", user.id)
      .maybeSingle();

    if (!profile) {
      return NextResponse.json({ error: "No profile found" }, { status: 404 });
    }

    const { data: steps } = await supabase
      .from("verification_steps")
      .select("step_type, status, reviewed_at, reason_code, reason_note, risk_level, submitted_at")
      .eq("user_id", user.id);

    return NextResponse.json({
      overallStatus: profile.seller_verification_status,
      steps: steps || [],
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
