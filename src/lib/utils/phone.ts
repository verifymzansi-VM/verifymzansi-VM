import { maskPhone } from "@/lib/utils/mask";

export const ACCOUNT_PHONE_IN_USE_ERROR = "This phone number is already linked to another account.";

export function normalizeSaPhone(phone: string): string {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, "");

  if (digits.startsWith("27") && digits.length === 11) {
    return `+${digits}`;
  }

  if (digits.startsWith("0") && digits.length === 10) {
    return `+27${digits.slice(1)}`;
  }

  return trimmed;
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
