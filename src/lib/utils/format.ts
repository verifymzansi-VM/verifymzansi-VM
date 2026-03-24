import { sanitizeSaPhoneInput } from "@/lib/utils/phone";

/**
 * Format an amount in cents as South African Rand.
 * @example formatZAR(26000) → "R 260.00"
 */
export function formatZAR(cents: number): string {
  if (Number.isNaN(cents) || !Number.isFinite(cents)) return "R 0.00";
  const rand = cents / 100;
  return `R ${rand.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a short ZAR display (no decimals for round amounts).
 * @example formatZARShort(26000) → "R260"
 */
export function formatZARShort(cents: number): string {
  if (Number.isNaN(cents) || !Number.isFinite(cents)) return "R0";
  const rand = cents / 100;
  if (rand % 1 === 0) {
    return `R${rand.toLocaleString("en-ZA")}`;
  }
  return `R${rand.toLocaleString("en-ZA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * Format a date for display.
 * @example formatDate(new Date()) → "19 Feb 2026"
 */
export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/**
 * Format a date with time.
 * @example formatDateTime(new Date()) → "19 Feb 2026, 14:30"
 */
export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  return d.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Format a relative time string.
 * @example formatRelativeTime(new Date(Date.now() - 3600000)) → "1 hour ago"
 */
export function formatRelativeTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();

  // Handle future dates gracefully
  if (diffMs < 0) return "just now";

  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHours = Math.floor(diffMin / 60);
  const diffDays = Math.floor(diffHours / 24);
  const diffWeeks = Math.floor(diffDays / 7);
  const diffMonths = Math.floor(diffDays / 30);

  if (diffSec < 60) return "just now";
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? "" : "s"} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? "" : "s"} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays === 1 ? "" : "s"} ago`;
  if (diffWeeks < 5) return `${diffWeeks} week${diffWeeks === 1 ? "" : "s"} ago`;
  if (diffMonths < 12) return `${diffMonths} month${diffMonths === 1 ? "" : "s"} ago`;

  return formatDate(d);
}

/**
 * Compact relative-time string (e.g. "5m ago", "3d ago").
 * @example timeAgo("2026-03-04T10:00:00Z") → "2h ago"
 */
export function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Human-friendly countdown until a future timestamp.
 * @example expiresIn("2026-03-05T10:00:00Z") → "23h left"
 */
export function expiresIn(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.floor(diff / 3_600_000);
  if (hours < 24) return `${hours}h left`;
  const days = Math.floor(hours / 24);
  return `${days}d left`;
}

/**
 * Format a South African phone number.
 * @example formatPhone("+27821234567") → "+27 82 123 4567"
 */
export function formatPhone(phone: string): string {
  const cleaned = sanitizeSaPhoneInput(phone).replace(/\D/g, "");
  if (cleaned.startsWith("27") && cleaned.length === 11) {
    return `+27 ${cleaned.slice(2, 4)} ${cleaned.slice(4, 7)} ${cleaned.slice(7)}`;
  }
  if (cleaned.startsWith("0") && cleaned.length === 10) {
    return `0${cleaned.slice(1, 3)} ${cleaned.slice(3, 6)} ${cleaned.slice(6)}`;
  }
  return phone;
}
