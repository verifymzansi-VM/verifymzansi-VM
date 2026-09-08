import { isValidSaPhone, normalizeSaPhone } from "@/lib/utils/phone";

export function contactPhone(value?: string | null): string | null {
  return value && isValidSaPhone(value) ? normalizeSaPhone(value) : null;
}

export function whatsappLink(
  value: string | null | undefined,
  title: string,
  path: string,
  introduction = "Hi, I'm interested in"
): string | null {
  const phone = contactPhone(value);
  if (!phone) return null;
  const url = `https://verifymzansi.com${path}`;
  return `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(`${introduction} ${title}. ${url}`)}`;
}
