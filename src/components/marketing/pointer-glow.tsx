"use client";

import { useEffect } from "react";

/** Elements that follow the pointer: spotlight cards and the deep-green brand bands. */
const TRACKED = ".spotlight, .brand-alive";
/** Largest lean, in degrees, of a `.tilt` card toward the pointer. */
const MAX_TILT = 5;

/**
 * One document-level listener that feeds `--mx` / `--my` to whichever tracked element the
 * pointer is over (and `--rx` / `--ry` to `.tilt` cards), so any surface can opt in with a
 * class and no wrapper component.
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
        const target = (event.target as Element | null)?.closest<HTMLElement>(TRACKED);
        if (!target) return;
        const rect = target.getBoundingClientRect();
        const x = event.clientX - rect.left;
        const y = event.clientY - rect.top;
        target.style.setProperty("--mx", `${x}px`);
        target.style.setProperty("--my", `${y}px`);
        if (target.classList.contains("tilt") && rect.width > 0 && rect.height > 0) {
          const ry = (x / rect.width - 0.5) * 2 * MAX_TILT;
          const rx = (0.5 - y / rect.height) * 2 * MAX_TILT;
          target.style.setProperty("--rx", `${rx.toFixed(2)}deg`);
          target.style.setProperty("--ry", `${ry.toFixed(2)}deg`);
        }
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
