import "server-only";

import type { User } from "@supabase/supabase-js";
import { getRoleFromUser } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

const IMMERSIVE_DETAIL_FLAG = "immersive_detail";

/**
 * The desktop viewer is off unless the `immersive_detail` flag turns it on
 * (on, percent of visitors, or staff roles). Local development can force it
 * with IMMERSIVE_DETAIL_DEV_FORCE=1; that variable is ignored in production.
 */
export async function isImmersiveDetailEnabled(context: {
  user?: Pick<User, "id" | "app_metadata"> | null;
  viewerId?: string | null;
}): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && process.env.IMMERSIVE_DETAIL_DEV_FORCE === "1") {
    return true;
  }
  return isFeatureEnabled(IMMERSIVE_DETAIL_FLAG, {
    userId: context.user?.id,
    role: context.user ? (getRoleFromUser(context.user) ?? undefined) : undefined,
    bucketKey: context.viewerId ?? context.user?.id,
  });
}
