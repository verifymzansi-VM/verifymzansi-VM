"use client";

import { useEffect, useState } from "react";

const QUERY = "(hover: hover) and (pointer: fine)";

/**
 * Returns true when the current device supports hover-centric interactions.
 * This lets card media prefer hover previews on desktop while falling back to
 * touch-friendly behavior on large tablets and other coarse-pointer devices.
 */
export function useHoverCapability(): boolean {
  const [canHover, setCanHover] = useState(false);

  useEffect(() => {
    const mql = window.matchMedia(QUERY);
    const update = () => setCanHover(mql.matches);
    update();

    mql.addEventListener("change", update);
    return () => mql.removeEventListener("change", update);
  }, []);

  return canHover;
}
