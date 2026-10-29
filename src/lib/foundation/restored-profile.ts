import type { User } from "@supabase/supabase-js";
import type { AccountProfile } from "@/types/database";
import type { FoundationAccountContext } from "./account-context";
import type { foundationVerificationStatusSchema } from "./verification-status";
import type { z } from "zod";

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
    pending_email: null,
    avatar_url: p.avatar_object_id ? `/api/media/serve/media/${p.avatar_object_id}` : null,
    masked_phone_public: null,
    legal_first_name: p.legal_first_name,
    legal_last_name: p.legal_last_name,
    legal_name_locked_at: null,
    legal_name_locked: p.legal_name_locked,
    contact_last_phone_change_at: null,
    contact_last_email_change_at: null,
    location_province: null,
    location_city: null,
    location_verified_at: null,
    account_status: "active",
    strikes: 0,
    suspended_until: null,
    banned_at: null,
    ban_reason: null,
    legal_hold: false,
    profile_completeness_score: 0,
    created_at: authUser.created_at,
    updated_at: p.updated_at,
  };
}
