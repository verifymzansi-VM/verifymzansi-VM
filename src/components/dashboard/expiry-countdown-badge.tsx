"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getExpiryCountdownLabel } from "@/lib/utils/expiry-countdown";

interface ExpiryCountdownBadgeProps {
  expiresAt: string | null | undefined;
  className?: string;
  iconClassName?: string;
  showDate?: boolean;
}

export function ExpiryCountdownBadge({
  expiresAt,
  className,
  iconClassName,
  showDate = false,
}: ExpiryCountdownBadgeProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const label = getExpiryCountdownLabel(expiresAt, nowMs);
  const exactDate = showDate ? formatExpiryDate(expiresAt) : null;

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!label) return null;

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Clock3 className={cn("h-3.5 w-3.5", iconClassName)} />
      <span suppressHydrationWarning>
        {exactDate ? formatExpiryLabel(label, exactDate) : label}
      </span>
    </div>
  );
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** South Africa Standard Time is UTC+2 all year. */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

/**
 * Deterministic "07 Mar 2026" in South African time. `Intl` output differs between
 * Node and browsers (and by device time zone), which caused hydration mismatches.
 */
function formatExpiryDate(expiresAt: string | null | undefined) {
  if (!expiresAt) return null;
  const time = new Date(expiresAt).getTime();
  if (!Number.isFinite(time)) return null;
  const sast = new Date(time + SAST_OFFSET_MS);
  const day = String(sast.getUTCDate()).padStart(2, "0");
  return `${day} ${MONTHS[sast.getUTCMonth()]} ${sast.getUTCFullYear()}`;
}

function formatExpiryLabel(label: string, exactDate: string) {
  if (label === "Expired") return `Expired ${exactDate}`;

  return `Expires ${exactDate} (${label.replace(/^Expires /, "")})`;
}
