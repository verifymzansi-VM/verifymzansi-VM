import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validations/shared";

/** A signed JWT can outlive sign-out, factor removal or a session downgrade. */
export async function hasActiveStaffSession(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sessionId = uuidSchema.safeParse(data?.claims.session_id);
    if (error || data?.claims.sub !== userId || !sessionId.success) return false;
    // Preserve AAL1 access to enrolment. A token claiming MFA must also retain
    // live AAL2 status and a verified authenticator before any staff route uses
    // the service role. This replaces, rather than adds, a database round trip.
    const rpc =
      data.claims.aal === "aal2" ? "staff_session_has_live_mfa" : "staff_session_is_active";
    const result = await createAdminClient().rpc(rpc, {
      p_user: userId,
      p_session: sessionId.data,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
