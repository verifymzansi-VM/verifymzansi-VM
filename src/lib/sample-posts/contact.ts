import { isValidSaPhone, normalizeSaPhone } from "@/lib/utils/phone";

/**
 * VerifyMzansi's own numbers for the Call and WhatsApp buttons on every
 * sample page: the same on all samples, never a business's. Kept in one place,
 * as non-secret Worker vars (wrangler.toml): SAMPLE_CONTACT_PHONE and
 * SAMPLE_CONTACT_WHATSAPP. A missing or invalid South African number shows no
 * button for it; with neither, the page has no contact area.
 */
interface SampleContact {
  /** E.164, e.g. +27821234567. */
  phone: string | null;
  whatsapp: string | null;
}

function saNumber(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed && isValidSaPhone(trimmed) ? normalizeSaPhone(trimmed) : null;
}

export function readSampleContact(
  env: Record<string, string | undefined> = process.env
): SampleContact | null {
  const phone = saNumber(env.SAMPLE_CONTACT_PHONE);
  const whatsapp = saNumber(env.SAMPLE_CONTACT_WHATSAPP);
  return phone || whatsapp ? { phone, whatsapp } : null;
}
