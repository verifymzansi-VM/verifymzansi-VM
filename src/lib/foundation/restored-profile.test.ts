import { expect, it } from "vitest";
import type { User } from "@supabase/supabase-js";
import { restoredAccountProfile } from "./restored-profile";
import type { FoundationAccountContext } from "./account-context";
const id = "00000000-0000-4000-8000-000000000001";
const account: FoundationAccountContext = {
  version: 1,
  account_id: id,
  email: "member@example.invalid",
  phone: null,
  totp_enrolled: false,
  staff: null,
  profile: {
    display_name: "Synthetic Member",
    public_name: "Synthetic Member",
    bio: null,
    avatar_object_id: null,
    legal_first_name: null,
    legal_last_name: null,
    legal_name_locked: false,
    identity_verified: false,
    revision: 1,
    updated_at: "2026-10-28T00:00:00Z",
  },
};
const auth = {
  id,
  created_at: "2026-10-27T00:00:00Z",
  user_metadata: { phone: "+27821234567", role: "admin", identity_verified: true },
} as unknown as User;
const verification = {
  case_id: null,
  version: null,
  verified: false,
  phone_verified: false,
  locality_confirmed: false,
  submission_pending: false,
  return_reason: null,
};
it("keeps registration phone as an unverified hint and ignores metadata authority", () => {
  const profile = restoredAccountProfile(account, auth, verification);
  expect(profile.phone).toBeNull();
  expect(profile.pending_phone).toBe("+27821234567");
  expect(profile.account_verification_status).toBe("incomplete");
  expect(profile.legal_name_locked_at).toBeNull();
});
it("requires canonical identity, phone and locality facts for verified presentation", () => {
  const verified = {
    ...account,
    phone: "+27821234567",
    profile: { ...account.profile, identity_verified: true },
  };
  expect(restoredAccountProfile(verified, auth, verification).account_verification_status).toBe(
    "incomplete"
  );
  expect(
    restoredAccountProfile(verified, auth, {
      ...verification,
      phone_verified: true,
      locality_confirmed: true,
    }).account_verification_status
  ).toBe("verified");
});
it("refuses an account switch rather than attaching another member's profile", () => {
  expect(() => restoredAccountProfile(account, { ...auth, id: "other" }, verification)).toThrow();
});
