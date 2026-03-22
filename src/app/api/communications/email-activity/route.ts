import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { checkLocalRateLimit } from "@/lib/utils/rate-limit";
import { createLogger } from "@/lib/utils/logger";
import { internalApiError, logApiError } from "@/lib/utils/api";

const log = createLogger("CommunicationEmailActivity");

export async function GET(_request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const rl = checkLocalRateLimit(user.id, "communication:email-activity:read");
    if (rl.limited) {
      return NextResponse.json(
        { error: "Too many requests" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfter ?? 60) } }
      );
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("audit_logs")
      .select("id, action, created_at, metadata")
      .eq("target_type", "account_profile")
      .eq("target_id", user.id)
      .in("action", ["communication_email_sent", "communication_email_failed"])
      .order("created_at", { ascending: false })
      .limit(20);

    if (error) {
      log.error("Failed to load email activity", { userId: user.id, error: error.message });
      return NextResponse.json({ error: "Failed to load email activity" }, { status: 500 });
    }

    return NextResponse.json({ items: data || [] });
  } catch (error) {
    logApiError(log, "Unexpected email activity fetch error", error);
    return internalApiError();
  }
}
