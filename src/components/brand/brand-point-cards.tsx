import type { ComponentType } from "react";
import { cn } from "@/lib/utils";

export interface BrandPoint {
  icon: ComponentType<{ className?: string }>;
  title: string;
}

/** Short trust points as small cards with gold icon tiles, for a BrandSurface. */
export function BrandPointCards({
  points,
  className,
}: {
  points: readonly BrandPoint[];
  className?: string;
}) {
  return (
    <ul className={cn("grid gap-3 sm:grid-cols-3", className)}>
      {points.map(({ icon: Icon, title }) => (
        <li
          key={title}
          className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] p-3.5 text-[13px] font-semibold leading-snug text-white/90 sm:block xl:p-4 xl:text-sm"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-brand-gold-300/15 text-brand-gold-300 sm:mb-2.5">
            <Icon className="h-4 w-4" />
          </span>
          {title}
        </li>
      ))}
    </ul>
  );
}
