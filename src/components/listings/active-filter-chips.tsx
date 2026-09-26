"use client";

import { X } from "lucide-react";
import { triggerHaptic } from "@/lib/utils/haptics";

export interface FilterChip {
  key: string;
  label: string;
  onRemove: () => void;
}

interface ActiveFilterChipsProps {
  chips: FilterChip[];
  onClearAll?: () => void;
}

export function ActiveFilterChips({ chips, onClearAll }: ActiveFilterChipsProps) {
  if (chips.length === 0) return null;

  return (
    <div className="-mx-1 px-1 lg:hidden">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none [mask-image:linear-gradient(to_right,transparent_0,black_4px,black_calc(100%-16px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0,black_4px,black_calc(100%-16px),transparent_100%)]">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-card pl-3 pr-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => {
              triggerHaptic("light");
              chip.onRemove();
            }}
          >
            <span className="max-w-[140px] truncate">{chip.label}</span>
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
              <X className="h-3 w-3 shrink-0" aria-hidden="true" />
            </span>
          </button>
        ))}
        {chips.length >= 2 && onClearAll && (
          <button
            type="button"
            className="min-h-9 shrink-0 rounded-full px-2.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onClick={() => {
              triggerHaptic("light");
              onClearAll();
            }}
          >
            Clear all
          </button>
        )}
      </div>
    </div>
  );
}
