/** The one answer every registration request gets, whether or not an account
 * can be created for that address, so the reply never reveals who is invited
 * or already registered. While sign-up is by invitation only
 * (FOUNDATION_REGISTRATION_INVITE_ONLY), it says so plainly. */
export function foundationRegistrationReply() {
  const inviteOnly = process.env.FOUNDATION_REGISTRATION_INVITE_ONLY === "true";
  return {
    ok: true as const,
    inviteOnly,
    message: inviteOnly
      ? "Registration is by invitation only for now. If this email was invited, check your inbox to continue."
      : "If registration is available for this email, check your inbox to continue.",
  };
}
