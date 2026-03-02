"use client";

import { ShieldCheck, Circle, CircleDashed, Clock, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TrustLevel } from "@/types/enums";

const ICONS = { Circle, CircleDashed, Clock, ShieldCheck, Crown };

const ICON_MAP: Record<TrustLevel, keyof typeof ICONS> = {
  0: "Circle",
  1: "CircleDashed",
  2: "Clock",
  3: "ShieldCheck",
  4: "Crown",
};

const LABELS: Record<TrustLevel, string> = {
  0: "Unregistered",
  1: "Incomplete",
  2: "Pending Review",
  3: "Verified",
  4: "Verified Pro",
};

const COLOR_MAP: Record<TrustLevel, string> = {
  0: "text-warm-400",
  1: "text-warm-500",
  2: "text-brand-gold",
  3: "text-brand-green",
  4: "text-brand-gold",
};

interface TrustIndicatorProps {
  level: TrustLevel;
  className?: string;
}

export function TrustIndicator({ level, className }: TrustIndicatorProps) {
  const Icon = ICONS[ICON_MAP[level]];

  return (
    <span className={cn("inline-flex items-center gap-1 text-sm", className)}>
      <Icon className={cn("h-4 w-4", COLOR_MAP[level])} />
      <span className="text-muted-foreground">{LABELS[level]}</span>
    </span>
  );
}
