"use client";

import { ChevronRight } from "lucide-react";
import { LiquidEdgeTab } from "@/components/ui/liquid-edge-tab";

/** Space kept clear below the top bar and above Video mode's action column. */
const RAIL_GAP = 12;
const TOP_BAR_BOTTOM = 60;

/**
 * Video mode's tab on the right wall: sends every control out of view and
 * brings them back. It swells as the controls flow into it, and ripples now
 * and then while it is the only thing on screen.
 */
export function EdgeTab({ hidden, onToggle }: { hidden: boolean; onToggle: () => void }) {
  return (
    <LiquidEdgeTab
      label={hidden ? "Show post details and controls" : "Hide controls"}
      onActivate={onToggle}
      highlighted={hidden}
      pulse={hidden}
      pulseDelayMs={hidden ? 260 : 0}
      ripple={hidden}
      ariaExpanded={!hidden}
      storageKey="vm:video:tab-offset"
      bounds={(restingTop, height) => {
        // Never below the action column.
        const railTop =
          document.querySelector(".vm-actions")?.getBoundingClientRect().top ??
          window.innerHeight * 0.6;
        return {
          min: TOP_BAR_BOTTOM - restingTop,
          max: Math.max(TOP_BAR_BOTTOM - restingTop, railTop - RAIL_GAP - restingTop - height),
        };
      }}
      className="vm-edge-tab absolute right-[env(safe-area-inset-right)] top-[calc(env(safe-area-inset-top)+34dvh)] z-30"
    >
      <ChevronRight
        className={`h-4 w-4 transition-transform duration-500 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${hidden ? "rotate-180 text-brand-gold-300" : ""}`}
      />
    </LiquidEdgeTab>
  );
}
