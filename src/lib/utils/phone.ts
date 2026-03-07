import { maskPhone } from "@/lib/utils/mask";

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

export function buildSellerPhoneFields(phone: string | null | undefined): {
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
