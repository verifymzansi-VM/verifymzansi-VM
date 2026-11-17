import type { User } from "@supabase/supabase-js";
import type { AccountProfile } from "@/types/database";
import type { FoundationAccountContext } from "./account-context";
import type { foundationVerificationStatusSchema } from "./verification-status";
import type { z } from "zod";
import { declareNotAvailable, notAvailable } from "./not-available";

/** Profile fields the live backend does not provide to the restored screens. */
export const ACCOUNT_PROFILE_NOT_AVAILABLE = declareNotAvailable({
  pending_email: notAvailable(null, "a pending email change is not read for the profile"),
  masked_phone_public: notAvailable(null, "contact numbers are revealed per post, not on profiles"),
  contact_last_email_change_at: notAvailable(null, "email change times are not stored"),
  account_status: notAvailable("active", "account restrictions are not read for the profile"),
  strikes: notAvailable(0, "account restrictions are not read for the profile"),
  suspended_until: notAvailable(null, "account restrictions are not read for the profile"),
  banned_at: notAvailable(null, "account restrictions are not read for the profile"),
  ban_reason: notAvailable(null, "account restrictions are not read for the profile"),
  legal_hold: notAvailable(false, "legal holds are not read for the profile"),
  profile_completeness_score: notAvailable(0, "profile completeness is not computed"),
});
/** Profile facts only the owner dashboard read provides
 * (presentedDashboardProfile); the account read alone leaves these placeholders. */
export const DASHBOARD_ONLY_PROFILE_FACTS = declareNotAvailable({
  legal_name_locked_at: notAvailable(null, "read with the owner dashboard"),
  contact_last_phone_change_at: notAvailable(null, "read with the owner dashboard"),
  location_province: notAvailable(null, "read with the owner dashboard"),
  location_city: notAvailable(null, "read with the owner dashboard"),
  location_verified_at: notAvailable(null, "read with the owner dashboard"),
});

/** Presentation adapter for the selected frontend. It never supplies grants
 * to the backend; verification comes only from current database facts. */
export function restoredAccountProfile(
  context: FoundationAccountContext,
  authUser: User,
  verification: z.infer<typeof foundationVerificationStatusSchema>
): AccountProfile {
  if (context.account_id !== authUser.id) throw new Error("Account changed during profile read");
  const p = context.profile;
  const hint = authUser.user_metadata?.phone;
  const pendingPhone =
    !context.phone && typeof hint === "string" && /^\+27\d{9}$/.test(hint) ? hint : null;
  const missing = ACCOUNT_PROFILE_NOT_AVAILABLE.values();
  const dashboardOnly = DASHBOARD_ONLY_PROFILE_FACTS.values();
  return {
    id: context.account_id,
    user_id: context.account_id,
    display_name: p.public_name ?? p.display_name ?? "",
    bio: p.bio,
    account_verification_status:
      p.identity_verified && verification.phone_verified && verification.locality_confirmed
        ? "verified"
        : "incomplete",
    phone: context.phone,
    pending_phone: pendingPhone,
    pending_email: missing.pending_email,
    avatar_url: p.avatar_object_id ? `/api/profile/avatar/${p.avatar_object_id}` : null,
    masked_phone_public: missing.masked_phone_public,
    legal_first_name: p.legal_first_name,
    legal_last_name: p.legal_last_name,
    legal_name_locked_at: dashboardOnly.legal_name_locked_at,
    legal_name_locked: p.legal_name_locked,
    contact_last_phone_change_at: dashboardOnly.contact_last_phone_change_at,
    contact_last_email_change_at: missing.contact_last_email_change_at,
    location_province: dashboardOnly.location_province,
    location_city: dashboardOnly.location_city,
    location_verified_at: dashboardOnly.location_verified_at,
    account_status: missing.account_status,
    strikes: missing.strikes,
    suspended_until: missing.suspended_until,
    banned_at: missing.banned_at,
    ban_reason: missing.ban_reason,
    legal_hold: missing.legal_hold,
    profile_completeness_score: missing.profile_completeness_score,
    created_at: authUser.created_at,
    updated_at: p.updated_at,
  };
}
