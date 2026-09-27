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
    <div className="lg:hidden -mx-1 px-1">
      <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none [mask-image:linear-gradient(to_right,transparent_0,black_4px,black_calc(100%-16px),transparent_100%)] [-webkit-mask-image:linear-gradient(to_right,transparent_0,black_4px,black_calc(100%-16px),transparent_100%)]">
        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className="flex shrink-0 items-center gap-1.5 rounded-full border border-primary/25 bg-primary/5 py-1 pl-3 pr-2 text-xs font-medium text-foreground shadow-xs transition-all hover:border-primary/40 hover:bg-primary/10 active:scale-[0.97] motion-reduce:transition-none"
            aria-label={`Remove ${chip.label} filter`}
            onClick={() => {
              triggerHaptic("light");
              chip.onRemove();
            }}
          >
            <span className="max-w-[120px] truncate">{chip.label}</span>
            <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary/15">
              <X className="h-2.5 w-2.5 shrink-0" />
            </span>
          </button>
        ))}
        {chips.length >= 2 && onClearAll && (
          <button
            type="button"
            className="shrink-0 rounded-full px-2.5 py-1 text-xs font-medium text-muted-foreground underline transition-colors hover:text-foreground"
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
