"use client";

import { useEffect, useState } from "react";
import { Clock3 } from "lucide-react";
import { cn } from "@/lib/utils";
import { getExpiryCountdownLabel } from "@/lib/utils/expiry-countdown";

interface ExpiryCountdownBadgeProps {
  expiresAt: string | null | undefined;
  className?: string;
  iconClassName?: string;
}

export function ExpiryCountdownBadge({
  expiresAt,
  className,
  iconClassName,
}: ExpiryCountdownBadgeProps) {
  const [nowMs, setNowMs] = useState(() => Date.now());
  const label = getExpiryCountdownLabel(expiresAt, nowMs);

  useEffect(() => {
    const timer = window.setInterval(() => setNowMs(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  if (!label) return null;

  return (
    <div className={cn("inline-flex items-center gap-1", className)}>
      <Clock3 className={cn("h-3.5 w-3.5", iconClassName)} />
      <span>{label}</span>
    </div>
  );
}
