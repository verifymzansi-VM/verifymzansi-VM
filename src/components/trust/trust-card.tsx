"use client";

import { cn } from "@/lib/utils";
import { getTrustTier } from "@/lib/constants/trust-scale";
import { TrustBadge } from "./trust-badge";
import { Card } from "@/components/ui/card";
import type { TrustLevel } from "@/types/enums";

interface TrustCardProps {
  level: TrustLevel;
  children: React.ReactNode;
  className?: string;
  showBadge?: boolean;
}

export function TrustCard({ level, children, className, showBadge = true }: TrustCardProps) {
  const tier = getTrustTier(level);

  return (
    <Card
      trustLevel={level}
      className={cn(
        "relative overflow-hidden",
        tier.glowAnimation && "animate-trust-glow",
        className
      )}
    >
      {showBadge && (
        <div className="absolute top-3 right-3 z-10">
          <TrustBadge level={level} />
        </div>
      )}
      {children}
    </Card>
  );
}
