import type { ReactNode } from "react";

/**
 * Shared shell for sticky bottom action bars on mobile (listing, business and
 * promotion detail pages). Frosted glass panel, safe-area aware, hidden on
 * desktop where the sidebar contact card is visible.
 */
export function StickyMobileBar({ children }: { children: ReactNode }) {
  return (
    <div className="glass-panel fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(env(safe-area-inset-bottom),12px)] pt-3 lg:hidden">
      <div className="mx-auto flex max-w-lg gap-3">{children}</div>
    </div>
  );
}
