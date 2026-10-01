"use client";

import { useEffect } from "react";

/**
 * One document-level listener that feeds `--mx` / `--my` to whichever `.spotlight` element
 * the pointer is over, so any card can opt in with a class and no wrapper component.
 */
export function PointerGlow() {
  useEffect(() => {
    if (!window.matchMedia("(hover: hover) and (prefers-reduced-motion: no-preference)").matches) {
      return;
    }
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const target = (event.target as Element | null)?.closest<HTMLElement>(".spotlight");
        if (!target) return;
        const rect = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${event.clientX - rect.left}px`);
        target.style.setProperty("--my", `${event.clientY - rect.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
    };
  }, []);

  return null;
}
