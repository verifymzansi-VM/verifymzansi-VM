"use client";

import { useCallback, useEffect, useState } from "react";

/** How long a video plays without a touch before the controls fade out. */
export const AUTO_HIDE_MS = 4000;

/**
 * Video mode's controls fade out after 4 s of playback without a touch: the
 * left column, Details (and Book or Tickets) and the top bar. The right column,
 * the title and price, the thin progress line and (while muted) the sound
 * button stay. A tap on the video then brings them back without pausing; a tap
 * while they show pauses. `enabled` is true only while a video plays with
 * nothing open over it: pausing, a sheet or the end of the feed shows
 * everything and stops the clock.
 */
export function useAutoHide(enabled: boolean, delay = AUTO_HIDE_MS) {
  const [hidden, setHidden] = useState(false);
  // Any touch or key press while the controls show starts the clock again.
  const [activity, setActivity] = useState(0);

  useEffect(() => {
    if (!enabled || hidden) return;
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      // Keyboard users moving through the controls keep them (WCAG 2.2.1).
      if (focused?.closest("[data-vm-chrome]") && focused.matches(":focus-visible")) return;
      setHidden(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, hidden, activity, delay]);

  const hiddenNow = hidden && enabled;

  /** Show everything and start the 4 s again. */
  const show = useCallback(() => {
    setHidden(false);
    setActivity((value) => value + 1);
  }, []);

  /** A touch while the controls show (a hidden view waits for a tap instead). */
  const noteActivity = useCallback(() => {
    if (!hiddenNow) setActivity((value) => value + 1);
  }, [hiddenNow]);

  /** A tap on the video: true when it only brought the controls back (no pause). */
  const revealOnTap = useCallback(() => {
    if (!hiddenNow) return false;
    show();
    return true;
  }, [hiddenNow, show]);

  return { hidden: hiddenNow, show, noteActivity, revealOnTap };
}
