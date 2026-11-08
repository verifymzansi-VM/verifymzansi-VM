/** Methods in a session's `amr` claim that are a sign-in by the member: Google
 * (oauth), a password, or a one-time email code or link. A second factor
 * (totp), a reset link (recovery), confirmation links and refreshes are not
 * sign-ins here. */
const SIGN_IN_METHODS = new Set(["oauth", "password", "otp", "magiclink"]);

/** How long a sign-in counts as recent for adding a password: the same hour
 * in which a reset link's session may set one (recovery-claims.ts and the
 * resetter in password-update.ts). */
export const RECENT_SIGN_IN_SECONDS = 3600;

/** How recent a staff member's authenticator step must be for adding a
 * password: the 15 minutes the database requires for sensitive staff
 * capabilities (requires_recent_mfa). */
export const RECENT_AUTHENTICATOR_SECONDS = 900;

/** The latest valid stamp among `methods` in a verified `amr` claim. */
function latestStamp(amr: unknown, methods: ReadonlySet<string>, now: number) {
  if (!Array.isArray(amr)) return null;
  let latest: number | null = null;
  for (const raw of amr as unknown[]) {
    if (!raw || typeof raw !== "object") continue;
    const { method, timestamp } = raw as Record<string, unknown>;
    if (
      typeof method === "string" &&
      methods.has(method) &&
      typeof timestamp === "number" &&
      Number.isSafeInteger(timestamp) &&
      timestamp > 0 &&
      timestamp <= now + 30
    )
      latest = Math.max(latest ?? 0, timestamp);
  }
  return latest;
}

/** Call only after GoTrue has verified this exact JWT. The time (seconds) of
 * the session's latest sign-in, or null. GoTrue stamps each method when it is
 * used in the session; refreshing the session does not move the stamp. */
export function foundationLatestSignIn(amr: unknown, now = Math.floor(Date.now() / 1000)) {
  return latestStamp(amr, SIGN_IN_METHODS, now);
}

const AUTHENTICATOR_METHODS = new Set(["totp"]);

/** Call only after GoTrue has verified this exact JWT. The time (seconds) of
 * the session's latest authenticator-app step, or null. */
export function foundationLatestAuthenticatorStep(
  amr: unknown,
  now = Math.floor(Date.now() / 1000)
) {
  return latestStamp(amr, AUTHENTICATOR_METHODS, now);
}

/** Whether that sign-in is recent enough (see RECENT_SIGN_IN_SECONDS). */
export function foundationSignedInRecently(
  signedInAt: number | null,
  now = Math.floor(Date.now() / 1000)
) {
  return signedInAt !== null && now - signedInAt <= RECENT_SIGN_IN_SECONDS;
}

/** Whether that authenticator step is recent enough (RECENT_AUTHENTICATOR_SECONDS). */
export function foundationAuthenticatorStepRecent(
  stepAt: number | null,
  now = Math.floor(Date.now() / 1000)
) {
  return stepAt !== null && now - stepAt <= RECENT_AUTHENTICATOR_SECONDS;
}

/** Call only after GoTrue has verified this exact JWT. Whether this session
 * was signed in with a password at any point, which proves the account has
 * one. */
export function foundationSignedInWithPassword(amr: unknown) {
  return (
    Array.isArray(amr) &&
    amr.some(
      (entry: unknown) =>
        !!entry &&
        typeof entry === "object" &&
        (entry as Record<string, unknown>).method === "password"
    )
  );
}

/** Providers that can carry a password in GoTrue. */
const PASSWORD_PROVIDERS = new Set(["email", "phone"]);

/**
 * Whether GoTrue's own record shows this verified account as one that signed
 * up through a provider such as Google, with no email or phone sign-in. Read
 * only from GoTrue's identities and app metadata, which members cannot edit;
 * user metadata, which they can, is ignored. Anything missing or unreadable
 * counts as "may have a password".
 *
 * GoTrue does not report whether a password exists. It adds an "email"
 * identity when a first password is set only behind an experimental option
 * that is off by default (GOTRUE_EXPERIMENTAL_CREATE_EMAIL_IDENTITY_ON_PASSWORD_SET_ENABLED),
 * so a Google member who already added a password still looks like this;
 * combine with foundationSignedInWithPassword. For such a member a further
 * request only sends a reset link to their own inbox, as forgot-password does.
 */
export function foundationAccountHasNoPassword(user: unknown) {
  if (!user || typeof user !== "object") return false;
  const record = user as Record<string, unknown>;
  if (record.is_sso_user === true || record.is_anonymous === true) return false;
  const { identities, app_metadata: app } = record;
  if (!Array.isArray(identities) || identities.length === 0) return false;
  if (!app || typeof app !== "object") return false;
  const listed = (app as Record<string, unknown>).providers;
  if (!Array.isArray(listed) || listed.length === 0) return false;
  const providers: unknown[] = [
    ...identities.map((identity: unknown) =>
      identity && typeof identity === "object"
        ? (identity as Record<string, unknown>).provider
        : null
    ),
    ...listed,
    (app as Record<string, unknown>).provider,
  ];
  return providers.every(
    (provider) =>
      typeof provider === "string" && provider !== "" && !PASSWORD_PROVIDERS.has(provider)
  );
}
