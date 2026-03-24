export const VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE = "email_confirmation_required";
export const VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE =
  "Please confirm your email address before starting verification";
export const VERIFICATION_EMAIL_CONFIRMATION_BLOCKER_DESCRIPTION =
  "Check your inbox for the confirmation link, then return here to continue with document and location verification.";

export interface VerificationEmailConfirmationRequiredPayload {
  error: typeof VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE;
  code: typeof VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE;
}

export function buildVerificationEmailConfirmationRequiredPayload(): VerificationEmailConfirmationRequiredPayload {
  return {
    error: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE,
    code: VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE,
  };
}

export function isVerificationEmailConfirmationRequired(
  payload: unknown
): payload is VerificationEmailConfirmationRequiredPayload {
  if (!payload || typeof payload !== "object") return false;

  const candidate = payload as {
    error?: unknown;
    code?: unknown;
  };

  return (
    candidate.code === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_CODE ||
    candidate.error === VERIFICATION_EMAIL_CONFIRMATION_REQUIRED_MESSAGE
  );
}
