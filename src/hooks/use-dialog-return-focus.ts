"use client";

import { useCallback, useRef } from "react";

/**
 * Returns keyboard focus to the control that opened a dialog when that dialog
 * is opened from component state rather than from its own trigger (WCAG 2.4.3).
 * Radix returns focus only to a `DialogTrigger`; without one it lands on the
 * page body, so keyboard users are thrown back to the top of the page.
 *
 * Call `rememberOpener` when opening, with the clicked control
 * (`event.currentTarget`) when there is one, otherwise the focused element is
 * used; pass `onCloseAutoFocus` to `DialogContent`.
 */
export function useDialogReturnFocus() {
  const openerRef = useRef<HTMLElement | null>(null);

  const rememberOpener = useCallback((target?: EventTarget | null) => {
    const candidate =
      target instanceof HTMLElement
        ? target
        : typeof document !== "undefined"
          ? document.activeElement
          : null;
    openerRef.current =
      candidate instanceof HTMLElement && candidate !== document.body ? candidate : null;
  }, []);

  const onCloseAutoFocus = useCallback((event: Event) => {
    const opener = openerRef.current;
    openerRef.current = null;
    if (!opener?.isConnected) return;
    event.preventDefault();
    opener.focus({ preventScroll: true });
  }, []);

  return { rememberOpener, onCloseAutoFocus };
}
