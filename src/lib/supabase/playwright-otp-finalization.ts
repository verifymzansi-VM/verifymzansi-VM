import { PHONE_CHANGE_COOLDOWN_MS } from "@/lib/account/identity-policy";
import { normalizeSaPhone } from "@/lib/utils/phone";
import { maskPhone } from "@/lib/utils/mask";
import { listPlaywrightTableRows, writePlaywrightTableRows } from "./playwright-fixture-store";

/** Isolated browser model only; transactional/RLS evidence comes from database tests. */
export function finalizePlaywrightOtp(params: Record<string, unknown> = {}) {
  const profiles = listPlaywrightTableRows("account_profiles");
  const challenges = listPlaywrightTableRows("otp_challenges");
  const profile = profiles.find((row) => row.user_id === params.p_user_id);
  const phone = typeof params.p_phone === "string" ? normalizeSaPhone(params.p_phone) : "";
  const result = (outcome: string, extra = {}) => ({ data: { outcome, ...extra }, error: null });
  if (!/^\+27\d{9}$/.test(phone)) return result("invalid_challenge");
  if (!profile) return result("profile_missing");
  const now = Date.now();
  if (
    profile.account_status === "banned" ||
    (profile.account_status === "suspended" &&
      (!profile.suspended_until || Date.parse(String(profile.suspended_until)) > now))
  )
    return result("account_restricted");
  if (profile.pending_phone && profile.pending_phone !== phone) return result("invalid_challenge");
  const challenge = challenges.find(
    (row) =>
      row.id === params.p_challenge_id && row.user_id === params.p_user_id && row.phone === phone
  );
  if (
    !challenge ||
    challenge.otp_hash !== params.p_expected_hash ||
    !Number.isFinite(Date.parse(String(challenge.expires_at))) ||
    Date.parse(String(challenge.expires_at)) <= now
  )
    return result("invalid_challenge");
  const steps = listPlaywrightTableRows("verification_steps");
  const sessions = listPlaywrightTableRows("verification_sessions");
  const step = steps.find((row) => row.user_id === params.p_user_id && row.step_type === "phone");
  const session = sessions.find((row) => row.user_id === params.p_user_id);
  if (challenge.verified_at)
    return profile.phone === phone &&
      !profile.pending_phone &&
      step?.status === "approved" &&
      step.phone_verified_at === challenge.verified_at &&
      session?.phone_verified_at === challenge.verified_at
      ? result("already_verified", { phone_changed: false })
      : result("invalid_challenge");
  const count = Number(challenge.attempt_count ?? 0);
  if (!Number.isInteger(count) || count < 1 || count > 5) return result("invalid_challenge");
  const changed = profile.phone !== phone;
  const wasReplacement = changed && Boolean(profile.phone);
  if (wasReplacement) {
    if (profile.pending_phone !== phone) return result("invalid_challenge");
    if (profile.account_verification_status !== "verified")
      return result("phone_reverification_required");
    const until =
      Date.parse(String(profile.contact_last_phone_change_at)) + PHONE_CHANGE_COOLDOWN_MS;
    if (until > now)
      return result("phone_cooldown", { retry_after: Math.ceil((until - now) / 1000) });
  }
  const stamp = new Date(now).toISOString();
  const logs = listPlaywrightTableRows("otp_logs");
  Object.assign(profile, {
    phone,
    pending_phone: null,
    masked_phone_public: maskPhone(phone),
    ...(changed ? { contact_last_phone_change_at: stamp } : {}),
  });
  if (step) Object.assign(step, { status: "approved", phone_verified_at: stamp });
  else
    steps.push({
      id: crypto.randomUUID(),
      user_id: params.p_user_id,
      step_type: "phone",
      status: "approved",
      phone_verified_at: stamp,
    });
  if (session) session.phone_verified_at = stamp;
  else
    sessions.push({ id: crypto.randomUUID(), user_id: params.p_user_id, phone_verified_at: stamp });
  for (const row of challenges)
    if (row.user_id === params.p_user_id && row.phone === phone && !row.verified_at)
      row.verified_at = stamp;
  for (const row of logs)
    if (row.phone === phone && row.otp_hash === params.p_expected_hash && !row.verified_at)
      Object.assign(row, { verified: true, verified_at: stamp });
  // No awaits: the in-memory fixture changes are observed together by other requests.
  writePlaywrightTableRows("account_profiles", profiles);
  writePlaywrightTableRows("verification_steps", steps);
  writePlaywrightTableRows("verification_sessions", sessions);
  writePlaywrightTableRows("otp_challenges", challenges);
  writePlaywrightTableRows("otp_logs", logs);
  return result("verified", { phone_changed: wasReplacement });
}
