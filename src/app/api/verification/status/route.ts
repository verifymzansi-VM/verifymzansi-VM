import { NextResponse, type NextRequest } from "next/server";
import { ACCOUNT_PROFILE_TABLE } from "@/lib/account/compat";
import { summarizeVerification } from "@/lib/account/verification-summary";
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

    // Fetch profile and verification steps in parallel
    const [profileResult, stepsResult] = await Promise.all([
      supabase
        .from(ACCOUNT_PROFILE_TABLE)
        .select("id, account_verification_status")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("verification_steps")
        .select(
          "step_type, status, reviewed_at, reason_code, reason_note, risk_level, submitted_at"
        )
        .eq("user_id", user.id),
    ]);

    const verificationStatus = summarizeVerification(
      profileResult.data?.account_verification_status,
      stepsResult.data
    ).accountVerificationStatus;

    return NextResponse.json({
      accountVerificationStatus: verificationStatus,
      overallStatus: verificationStatus,
      steps: stepsResult.data || [],
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
