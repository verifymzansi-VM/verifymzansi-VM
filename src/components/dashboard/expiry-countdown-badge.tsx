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
      <span>{exactDate ? formatExpiryLabel(label, exactDate) : label}</span>
    </div>
  );
}

function formatExpiryDate(expiresAt: string | null | undefined) {
  if (!expiresAt) return null;
  const date = new Date(expiresAt);
  if (!Number.isFinite(date.getTime())) return null;

  return new Intl.DateTimeFormat("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(date);
}

function formatExpiryLabel(label: string, exactDate: string) {
  if (label === "Expired") return `Expired ${exactDate}`;

  return `Expires ${exactDate} (${label.replace(/^Expires /, "")})`;
}
