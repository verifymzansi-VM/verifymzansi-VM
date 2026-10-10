import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { uuidSchema } from "@/lib/validations/shared";

/** A signed JWT can outlive sign-out. Privileged access needs its live session. */
export async function hasActiveStaffSession(
  supabase: SupabaseClient,
  userId: string
): Promise<boolean> {
  try {
    const { data, error } = await supabase.auth.getClaims();
    const sessionId = uuidSchema.safeParse(data?.claims.session_id);
    if (error || data?.claims.sub !== userId || !sessionId.success) return false;
    const result = await createAdminClient().rpc("staff_session_is_active", {
      p_user: userId,
      p_session: sessionId.data,
    });
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
