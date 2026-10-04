import "server-only";

import type { User } from "@supabase/supabase-js";
import { getRoleFromUser } from "@/lib/auth/roles";
import { isFeatureEnabled } from "@/lib/services/feature-flags";

const VIDEO_MODE_FLAG = "video_mode";

/**
 * Mobile Video mode is off unless the `video_mode` flag turns it on (staff
 * roles first, then a percent of visitors, then everyone). Local development
 * can force it with VIDEO_MODE_DEV_FORCE=1; that variable is ignored in production.
 */
export async function isVideoModeEnabled(context: {
  user?: Pick<User, "id" | "app_metadata"> | null;
  viewerId?: string | null;
}): Promise<boolean> {
  if (process.env.NODE_ENV === "development" && process.env.VIDEO_MODE_DEV_FORCE === "1") {
    return true;
  }
  return isFeatureEnabled(VIDEO_MODE_FLAG, {
    userId: context.user?.id,
    role: context.user ? (getRoleFromUser(context.user) ?? undefined) : undefined,
    bucketKey: context.viewerId ?? context.user?.id,
  });
}
