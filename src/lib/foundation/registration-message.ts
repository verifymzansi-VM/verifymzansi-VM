import type { FoundationSignupMode } from "./signup-mode";

/** The one reply while sign-up is by invitation, also shown in the sign-in
 * page's "Check your email" box (above its Resend button). Safe in client
 * components. */
export const INVITE_ONLY_REGISTRATION_MESSAGE =
  "VerifyMzansi is open by invitation for now. If this email was invited, we've sent it a confirmation link. Nothing there after a few minutes? Resend it, or sign up with the email address your invitation was sent to.";

/** The one answer every registration request gets, whether or not an account
 * can be created for that address, so the reply never reveals who is invited
 * or already registered. While sign-up is by invitation only it says so
 * plainly. The mode is the database's (readFoundationSignupMode); when it
 * could not be read, FOUNDATION_REGISTRATION_INVITE_ONLY decides. */
export function foundationRegistrationReply(mode: FoundationSignupMode | null = null) {
  const inviteOnly = mode
    ? mode === "invite_only"
    : process.env.FOUNDATION_REGISTRATION_INVITE_ONLY === "true";
  return {
    ok: true as const,
    inviteOnly,
    message: inviteOnly
      ? INVITE_ONLY_REGISTRATION_MESSAGE
      : "If registration is available for this email, check your inbox to continue.",
  };
}
