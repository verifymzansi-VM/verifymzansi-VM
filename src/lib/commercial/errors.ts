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
      "Choose a plan to make this post visible: R50 / 30 days, R250 / 6 months or R450 / year.",
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
