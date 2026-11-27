import { businessNumber, isValidSaPhone, normalizeSaPhone } from "@/lib/utils/phone";

export function contactPhone(value?: string | null): string | null {
  return value && isValidSaPhone(value) ? normalizeSaPhone(value) : null;
}

/** A number to call: a South African landline (01x-05x), mobile or call-only
 * number (087, 0800, 0860, 0861), in +27 form, the database's rule for
 * business numbers. */
export function contactCallPhone(value?: string | null): string | null {
  return businessNumber(value)?.number ?? null;
}

/** A landline (calls only) as it is written locally, such as "031 123 4567";
 * null for a mobile or anything else. */
export function landlineDisplay(value?: string | null): string | null {
  const found = businessNumber(value);
  if (found?.kind !== "landline") return null;
  const digits = found.number.slice(3);
  return `0${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
}

export function whatsappLink(
  value: string | null | undefined,
  title: string,
  path: string,
  introduction = "Hi, I'm interested in"
): string | null {
  const found = businessNumber(value);
  if (found?.kind !== "mobile") return null;
  const phone = found.number;
  const url = `https://verifymzansi.com${path}`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(`${introduction} ${title}. ${url}`)}`;
}
