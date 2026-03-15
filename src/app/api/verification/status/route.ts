import { NextResponse, type NextRequest } from "next/server";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
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

    const verification = await resolveAccountVerification(supabase, user.id, {
      includeStepsWhenVerified: true,
    });

    return NextResponse.json({
      accountVerificationStatus: verification.accountVerificationStatus,
      overallStatus: verification.accountVerificationStatus,
      steps: verification.steps,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
