import type { SupabaseClient, User } from "@supabase/supabase-js";
import { verifyCapabilityFromDb } from "@/lib/auth/admin-access";
import { checkStaffApiMfa } from "@/lib/auth/staff-mfa-guard";
import { createLogger } from "@/lib/utils/logger";

const log = createLogger("StaffPostingBypass");

/**
 * Whether a staff member may skip posting plan limits
 * (`posting:bypass_limits`). The staff role alone is not enough: like every
 * other back-office power, the bypass requires the staff MFA policy to be
 * satisfied. Fails closed — a missing capability, an unmet MFA requirement
 * or any lookup error all mean "no bypass", so the caller simply applies the
 * normal plan limits instead of rejecting the post.
 */
export async function hasStaffPostingLimitBypass(
  supabase: SupabaseClient,
  user: Pick<User, "id" | "app_metadata" | "is_anonymous">
): Promise<boolean> {
  try {
    if (!(await verifyCapabilityFromDb(user, "posting:bypass_limits"))) {
      return false;
    }
    const mfaBlock = await checkStaffApiMfa(supabase, user.id);
    if (mfaBlock) {
      log.warn("Posting-limit bypass withheld: staff MFA requirement not met", {
        userId: user.id,
      });
      return false;
    }
    return true;
  } catch (error) {
    log.warn("Posting-limit bypass check failed; applying normal limits", {
      userId: user.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
