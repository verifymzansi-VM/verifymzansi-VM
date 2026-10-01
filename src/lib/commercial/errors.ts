/**
 * Database guard codes raised by the publication trigger and commercial RPCs,
 * mapped to plain-language messages and HTTP statuses.
 */
const COMMERCIAL_ERRORS: ReadonlyArray<{ code: string; status: number; message: string }> = [
  {
    code: "SLOT_FULL",
    status: 409,
    message:
      "All your active posting slots or activations are in use. Mark a post as sold, deactivate one, or add a slot from R50 / 30 days.",
  },
  {
    code: "TRIAL_REQUIRED",
    status: 402,
    message:
      "Choose a plan to make this post visible: R50 / 30 days, R140 / 90 days or R250 / 180 days.",
  },
  {
    code: "TRIAL_EXPIRED",
    status: 402,
    message: "Your free period has ended. Reactivate from R50 / 30 days — your post is saved.",
  },
  { code: "TRIAL_EVENT_ENDED", status: 409, message: "This event has already ended." },
  {
    code: "EVENT_LIMIT",
    status: 429,
    message: "You have reached the maximum number of active free events.",
  },
  {
    code: "CONTENT_STATE",
    status: 409,
    message: "This post cannot be changed in its current state.",
  },
  { code: "CONTENT_NOT_FOUND", status: 404, message: "Post not found." },
  {
    code: "PROGRAMME_ALREADY_USED",
    status: 409,
    message: "This identity has already received a free programme or trial.",
  },
  {
    code: "PROGRAMME_VERIFICATION_REQUIRED",
    status: 409,
    message: "The member must complete identity verification first.",
  },
  { code: "CONTRACT_ADMIN_LIMIT", status: 409, message: "Administrator limit reached." },
  { code: "ORGANISATION_ADMIN_LIMIT", status: 409, message: "Administrator limit reached." },
  {
    code: "ORGANISATION_ADMIN_UNVERIFIED",
    status: 409,
    message: "Organisation administrators must complete VerifyMzansi identity verification first.",
  },
  {
    code: "AFFILIATION_NOT_OWNER",
    status: 403,
    message: "You can only request affiliation for your own business.",
  },
  {
    code: "AFFILIATION_CLOSED",
    status: 409,
    message: "This organisation is not accepting affiliation requests.",
  },
  {
    code: "AFFILIATION_CONSENT_REQUIRED",
    status: 400,
    message: "Please confirm consent to share the listed information.",
  },
  { code: "AFFILIATION_EXISTS", status: 409, message: "This business is already affiliated." },
  {
    code: "AFFILIATION_PENDING",
    status: 409,
    message: "A request for this organisation is already open.",
  },
  { code: "AFFILIATION_RATE_LIMIT", status: 429, message: "Too many requests today." },
  {
    code: "SPONSORSHIP_REQUIRES_AFFILIATION",
    status: 409,
    message: "Only active affiliations can be sponsored.",
  },
  {
    code: "SPONSORSHIP_INACTIVE",
    status: 409,
    message: "This organisation has no active sponsorship programme.",
  },
  {
    code: "SPONSORSHIP_EXISTS",
    status: 409,
    message: "This business is already sponsored or waitlisted.",
  },
  {
    code: "ORGANISATION_ADMIN_EXISTS",
    status: 409,
    message: "This person is already an administrator.",
  },
  { code: "ORGANISATION_INACTIVE", status: 409, message: "This programme is not active." },
  {
    code: "ORGANISATION_INVITE_INVALID",
    status: 410,
    message: "This invitation link is no longer valid. Ask VerifyMzansi to send a new one.",
  },
  {
    code: "ORGANISATION_INVITE_EMAIL",
    status: 403,
    message: "Sign in with the email address the invitation was sent to.",
  },
  {
    code: "TRIAL_EXTENSION_OFFER_REQUIRED",
    status: 409,
    message:
      "Free time is added through an extension offer (Admin › Trials). It applies only after the participant accepts.",
  },
  {
    code: "TRIAL_EXTENSION_INELIGIBLE",
    status: 409,
    message: "This trial cannot be extended. Only active, unconverted free access is eligible.",
  },
  {
    code: "TRIAL_EXTENSION_NO_RECIPIENT",
    status: 409,
    message: "Add a programme administrator before offering an extension.",
  },
  { code: "TRIAL_EXTENSION_DAYS", status: 400, message: "Offer between 1 and 30 days." },
  {
    code: "TRIAL_EXTENSION_OPEN",
    status: 409,
    message: "This trial already has an open extension offer.",
  },
  {
    code: "TRIAL_EXTENSION_SECOND_ADMIN",
    status: 403,
    message: "A different administrator must approve this extension.",
  },
  {
    code: "TRIAL_EXTENSION_STALE",
    status: 409,
    message:
      "The end date changed after this offer was made. Withdraw it and make a new offer, or contact VerifyMzansi.",
  },
  { code: "TRIAL_EXTENSION_NOT_FOUND", status: 404, message: "Offer not found." },
  {
    code: "TRIAL_EXTENSION_ANSWERED",
    status: 409,
    message: "This offer has already been answered or is not open.",
  },
  { code: "TRIAL_EXTENSION_EXPIRED", status: 410, message: "This offer has expired." },
  {
    code: "PLAN_ADMIN_NOT_FOUND",
    status: 404,
    message: "Only the buyer of a multi-listing plan can manage its administrators.",
  },
  { code: "PLAN_ADMIN_INACTIVE", status: 409, message: "This plan has ended." },
  {
    code: "PLAN_ADMIN_UNAVAILABLE",
    status: 404,
    message:
      "That email does not belong to an identity-reviewed VerifyMzansi account. Ask them to register and complete identity review first.",
  },
  { code: "PLAN_ADMIN_SELF", status: 400, message: "You already own this plan." },
  { code: "PLAN_ADMIN_EXISTS", status: 409, message: "This person is already an administrator." },
  {
    code: "PLAN_ADMIN_LIMIT",
    status: 409,
    message: "This plan includes two named administrators. Remove one before adding another.",
  },
  {
    code: "TRIAL_EXTENSION_RESEND_LIMIT",
    status: 429,
    message: "This offer has already been resent the maximum number of times.",
  },
];

export interface CommercialErrorResult {
  code: string;
  status: number;
  message: string;
}

/** Map a Postgres/PostgREST error message to a known commercial rule, if any. */
export function mapCommercialError(
  message: string | null | undefined
): CommercialErrorResult | null {
  if (!message) return null;
  if (/permission required|access required/i.test(message)) {
    return {
      code: "FORBIDDEN",
      status: 403,
      message: "You do not have permission for this action.",
    };
  }
  if (/audit reason is required|reason is required/i.test(message)) {
    return {
      code: "REASON_REQUIRED",
      status: 400,
      message: "Please give a reason (5–500 characters).",
    };
  }
  const match = COMMERCIAL_ERRORS.find((entry) => message.includes(entry.code));
  return match ? { ...match } : null;
}
