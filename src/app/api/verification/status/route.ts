import { NextResponse, type NextRequest } from "next/server";
import { resolveAccountVerification } from "@/lib/account/resolved-verification";
import { createClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("VerificationStatus");

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rateCheck = await checkRateLimit({
      key: user.id,
      action: "verification:status",
      degradedMode: "local",
    });
    if (rateCheck.limited) {
      return NextResponse.json(
        { error: "Too many verification status requests. Please try again shortly." },
        { status: 429, headers: { "Retry-After": String(rateCheck.retryAfter ?? 60) } }
      );
    }

    const verification = await resolveAccountVerification(supabase, user.id, {
      includeStepsWhenVerified: true,
    });

    // risk_level is an admin-only fraud signal — never expose it to the
    // verified user, who could probe which signals raised their score.
    const steps = verification.steps.map((step) => {
      const { risk_level: _riskLevel, ...rest } = step;
      return rest;
    });

    return NextResponse.json(
      {
        accountVerificationStatus: verification.accountVerificationStatus,
        overallStatus: verification.accountVerificationStatus,
        steps,
      },
      {
        headers: { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" },
      }
    );
  } catch (err) {
    log.error("Unexpected error", {
      error: err instanceof Error ? err.message : "unknown error",
      stack: err instanceof Error ? err.stack : undefined,
    });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
