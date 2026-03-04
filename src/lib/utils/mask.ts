/**
 * Mask a phone number for public display.
 * @example maskPhone("+27821234567") → "+27 •••• ••67"
 */
export function maskPhone(phone: string): string {
  const cleaned = phone.replace(/\D/g, "");
  if (cleaned.length < 4) return "••••••••";
  const lastTwo = cleaned.slice(-2);
  if (cleaned.startsWith("27")) {
    return `+27 •••• ••${lastTwo}`;
  }
  return `••••• •••${lastTwo}`;
}

/**
 * Mask a display name (show first name + initial).
 * @example maskName("Senzo Mthethwa") → "Senzo M."
 */
export function maskName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "Anonymous";
  const parts = trimmed.split(/\s+/);
  if (parts.length <= 1) {
    // Single name: show first char only for privacy
    const single = parts[0];
    return single.length > 1 ? `${single[0]}***` : single || "Anonymous";
  }
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

/**
 * Mask a South African ID number (show only last 4 digits).
 * @example maskIdNumber("9001015800086") → "••••••••• 0086"
 */
export function maskIdNumber(idNumber: string): string {
  if (idNumber.length < 4) return "•••••••••••••";
  return `${"•".repeat(idNumber.length - 4)} ${idNumber.slice(-4)}`;
}

/**
 * Mask an email address.
 * @example maskEmail("senzo@example.com") → "s***o@example.com"
 */
export function maskEmail(email: string): string {
  if (!email || !email.includes("@")) return "***@***";
  const [local, domain] = email.split("@");
  if (!domain || !local || local.length < 2) return `***@${domain || "***"}`;
  return `${local[0]}***${local[local.length - 1]}@${domain}`;
}
