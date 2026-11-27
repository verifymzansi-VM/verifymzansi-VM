import { maskPhone } from "@/lib/utils/mask";

export const ACCOUNT_PHONE_IN_USE_ERROR = "This phone number is already linked to another account.";
export const ACCOUNT_PHONE_ALREADY_VERIFIED =
  "This phone number is already verified on your account.";
/** Shown for a number a ban blocks; never says that a ban exists. */
export const PHONE_NUMBER_UNAVAILABLE =
  "This phone number can't be used on VerifyMzansi. Contact support if you think this is a mistake.";
/** Shown when no SMS code can be sent now (the site's daily limit on codes). */
export const PHONE_CODES_UNAVAILABLE = "We can't send codes right now. Please try again later.";
const SA_PHONE_E164_REGEX = /^\+27[6-8][0-9]{8}$/;
const SA_PHONE_LOCAL_REGEX = /^0[6-8][0-9]{8}$/;

export function sanitizeSaPhoneInput(phone: string): string {
  const trimmed = phone.trim();

  if (!trimmed) {
    return "";
  }

  const digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("27") && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return digits;
  }

  return trimmed.replace(/[^\d+]/g, "");
}

export function normalizeSaPhone(phone: string): string {
  const sanitized = sanitizeSaPhoneInput(phone);
  const digits = sanitized.replace(/\D/g, "");

  if (digits.startsWith("27") && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return `+27${digits.slice(1)}`;
  }

  return sanitized;
}

export function isValidSaPhone(phone: string): boolean {
  const sanitized = sanitizeSaPhoneInput(phone);
  return SA_PHONE_E164_REGEX.test(sanitized) || SA_PHONE_LOCAL_REGEX.test(sanitized);
}

export function buildAccountPhoneFields(phone: string | null | undefined): {
  phone: string | null;
  masked_phone_public: string | null;
} {
  if (typeof phone !== "string") {
    return { phone: null, masked_phone_public: null };
  }

  const trimmed = phone.trim();
  if (!trimmed) {
    return { phone: null, masked_phone_public: null };
  }

  const normalizedPhone = normalizeSaPhone(trimmed);
  return {
    phone: normalizedPhone,
    masked_phone_public: maskPhone(normalizedPhone),
  };
}

// Compatibility alias for older call sites during the terminology rollout.
export const buildSellerPhoneFields = buildAccountPhoneFields;

// One rule for a business's own numbers, the same as the database's
// internal.business_contact_number: a landline has a 01x-05x area code, a
// mobile starts 06x, 071-074, 076-079 or 081-084 (not 080 toll-free, 086
// share-call or 087). Spaces, brackets and dashes are ignored, and the number
// may start 0, 27 or +27.
const BUSINESS_LANDLINE = /^\+27[1-5][0-9]{8}$/;
const BUSINESS_MOBILE = /^\+27(?:6[0-9]|7[1-46-9]|8[1-4])[0-9]{7}$/;

/** Shown when a landline is given for WhatsApp. */
export const WHATSAPP_NEEDS_MOBILE = "WhatsApp needs a mobile number.";

/** A business number in +27 form with its kind, or null. Calls take either
 * kind; WhatsApp takes a mobile only. */
export function businessNumber(
  value: string | null | undefined
): { number: string; kind: "landline" | "mobile" } | null {
  const match = /^(?:0|27|[+]27)([1-9][0-9]{8})$/.exec((value ?? "").replace(/[ ()-]/g, ""));
  const number = match ? `+27${match[1]}` : "";
  if (BUSINESS_MOBILE.test(number)) return { number, kind: "mobile" };
  if (BUSINESS_LANDLINE.test(number)) return { number, kind: "landline" };
  return null;
}
