import { isValidSaPhone, normalizeSaPhone } from "@/lib/utils/phone";

export function contactPhone(value?: string | null): string | null {
  return value && isValidSaPhone(value) ? normalizeSaPhone(value) : null;
}

/** A South African mobile number that can use WhatsApp: 06x, 071-074, 076-079
 * or 081-084 (not 080 toll-free or 086 share-call), the rule the database's
 * click-to-view command (internal.business_contact_number) also applies. */
const WHATSAPP_MOBILE = /^\+27(?:6[0-9]|7[1-46-9]|8[1-4])[0-9]{7}$/;

/** A number to call: any South African landline or mobile, in +27 form
 * (WhatsApp links stay mobile only). */
export function contactCallPhone(value?: string | null): string | null {
  const digits = (value ?? "").replace(/[^0-9+]/g, "");
  const match = /^(?:0|27|[+]27)([1-8][0-9]{8})$/.exec(digits);
  return match ? `+27${match[1]}` : null;
}

export function whatsappLink(
  value: string | null | undefined,
  title: string,
  path: string,
  introduction = "Hi, I'm interested in"
): string | null {
  const phone = contactPhone(value);
  if (!phone || !WHATSAPP_MOBILE.test(phone)) return null;
  const url = `https://verifymzansi.com${path}`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(`${introduction} ${title}. ${url}`)}`;
}
