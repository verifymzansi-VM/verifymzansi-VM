"use client";

import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

/**
 * Returns true when the user prefers reduced motion.
 * CSS animations are already handled by globals.css; this hook
 * lets framer-motion animations respect the same preference.
 */
export function useReducedMotion(): boolean {
  // Hydration-safe: keep the first render deterministic across server and client,
  // then update after mount based on the real media query value.
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setPrefersReducedMotion(mql.matches);
    update();

    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return prefersReducedMotion;
}
