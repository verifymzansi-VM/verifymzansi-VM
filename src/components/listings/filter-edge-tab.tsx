"use client";

import { SlidersHorizontal } from "lucide-react";
import { LiquidEdgeTab } from "@/components/ui/liquid-edge-tab";

/** Stay below the header and above the phone tab bar. */
const TOP_CLEARANCE = 72;
const BOTTOM_CLEARANCE = 92;

/**
 * Phones and tablets: the lists' filters live in a drop of liquid on the right
 * wall (the same control as Video mode's tab). Tap it or pull it away from the
 * wall to open the filters; slide it up or down to move it out of the way.
 */
export function FilterEdgeTab({
  label,
  count,
  open,
  onOpen,
}: {
  label: string;
  /** Filters in use: shown on the drop, with a gold rim. */
  count: number;
  open: boolean;
  onOpen: () => void;
}) {
  return (
    <LiquidEdgeTab
      label={label}
      onActivate={onOpen}
      highlighted={count > 0}
      badge={count}
      pulse={count}
      ariaExpanded={open}
      ariaHasPopup="dialog"
      storageKey="vm:filters:tab-y"
      bounds={(restingTop, height) => ({
        min: TOP_CLEARANCE - restingTop,
        max: window.innerHeight - BOTTOM_CLEARANCE - restingTop - height,
      })}
      className="fixed right-[env(safe-area-inset-right)] top-[calc(50dvh-36px)] z-40 lg:hidden"
    >
      <SlidersHorizontal className="h-4 w-4" />
    </LiquidEdgeTab>
  );
}
