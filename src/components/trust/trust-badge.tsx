"use client";

import { BrandShield as ShieldCheck } from "@/components/shared/brand-shield";
import { Circle, CircleDashed, Clock, Crown } from "lucide-react";
import { cn } from "@/lib/utils";
import { getTrustTier } from "@/lib/constants/trust-scale";
import type { TrustLevel } from "@/types/enums";

const ICONS = {
  Circle,
  CircleDashed,
  Clock,
  ShieldCheck,
  Crown,
} as const;

interface TrustBadgeProps {
  level: TrustLevel;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function TrustBadge({ level, showLabel = true, size = "md", className }: TrustBadgeProps) {
  const tier = getTrustTier(level);
  const IconComponent = ICONS[tier.iconName as keyof typeof ICONS];

  const sizeClasses = {
    sm: "text-xs px-1.5 py-0.5 gap-1",
    md: "text-xs px-2 py-0.5 gap-1",
    lg: "text-sm px-3 py-1.5 gap-1.5",
  };

  const iconSizes = {
    sm: "h-3 w-3",
    md: "h-3.5 w-3.5",
    lg: "h-4 w-4",
  };

  // Badges stay still: ambient pulsing on every pending badge competes with
  // real content, so tier.glowAnimation is intentionally not rendered.
  return (
    <span
      className={cn(tier.badgeClass, sizeClasses[size], className)}
      title={tier.description}
      role={showLabel ? undefined : "img"}
      aria-label={showLabel ? undefined : tier.label}
    >
      <IconComponent className={cn("shrink-0", iconSizes[size])} aria-hidden="true" />
      {showLabel && <span>{tier.label}</span>}
    </span>
  );
}
