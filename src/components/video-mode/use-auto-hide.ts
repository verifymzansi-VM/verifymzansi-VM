"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

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
  // Read by a tap at once, so a tap in the moment the controls fade (before the
  // next render) still only brings them back.
  const hiddenRef = useRef(false);
  const enabledRef = useRef(enabled);
  useLayoutEffect(() => {
    enabledRef.current = enabled;
  }, [enabled]);
  // The control a finger or mouse last pressed: focus left there by a tap does
  // not hold the controls; focus from a keyboard or screen reader does.
  const pointerTarget = useRef<Element | null>(null);
  useEffect(() => {
    const onDown = (event: PointerEvent) => {
      pointerTarget.current =
        event.target instanceof Element ? event.target.closest("button, a, [tabindex]") : null;
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (!enabled || hidden) return;
    const timer = window.setTimeout(() => {
      const focused = document.activeElement;
      // Someone moving through the controls by keyboard or screen reader keeps them (WCAG 2.2.1).
      if (focused?.closest("[data-vm-chrome]") && focused !== pointerTarget.current) return;
      hiddenRef.current = true;
      setHidden(true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [enabled, hidden, activity, delay]);

  const hiddenNow = hidden && enabled;

  /** Show everything and start the 4 s again. */
  const show = useCallback(() => {
    hiddenRef.current = false;
    setHidden(false);
    setActivity((value) => value + 1);
  }, []);

  /** A touch while the controls show (a hidden view waits for a tap instead). */
  const noteActivity = useCallback(() => {
    if (!(hiddenRef.current && enabledRef.current)) setActivity((value) => value + 1);
  }, []);

  /** A tap on the video: true when it only brought the controls back (no pause). */
  const revealOnTap = useCallback(() => {
    if (!(hiddenRef.current && enabledRef.current)) return false;
    show();
    return true;
  }, [show]);

  return { hidden: hiddenNow, show, noteActivity, revealOnTap };
}
