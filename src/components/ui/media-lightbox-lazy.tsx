"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import type { MediaLightbox as MediaLightboxComponent } from "@/components/ui/media-lightbox";

type MediaLightboxProps = ComponentProps<typeof MediaLightboxComponent>;

let loadedLightbox: typeof MediaLightboxComponent | null = null;
let pendingLightbox: Promise<typeof MediaLightboxComponent> | null = null;

/** Loads the full-screen viewer's code once; later calls share the same download. */
export function loadMediaLightbox(): Promise<typeof MediaLightboxComponent> {
  if (loadedLightbox) return Promise.resolve(loadedLightbox);
  pendingLightbox ??= import("@/components/ui/media-lightbox").then(
    (module) => (loadedLightbox = module.MediaLightbox),
    (error: unknown) => {
      // Let the next open try again (for example after the connection returns).
      pendingLightbox = null;
      throw error;
    }
  );
  return pendingLightbox;
}

type IdleWindow = Window & {
  requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
  cancelIdleCallback?: (handle: number) => void;
};

/**
 * The same full-screen photo and video viewer as `media-lightbox`, with the
 * same props, but its code is not part of the page's first download: it is
 * fetched when the browser is idle after the page has loaded, or as soon as
 * the visitor first touches the page or presses a key (so a tap on a photo
 * usually finds it ready), or on the first open if that comes sooner. Nothing
 * is rendered until it is first opened; afterwards it stays mounted, so it
 * closes with its usual animation. If a tap does arrive before the code, an
 * invisible layer takes further taps until the viewer appears, as the
 * viewer's own backdrop would have.
 */
export function MediaLightbox(props: MediaLightboxProps) {
  const { isOpen } = props;
  const [opened, setOpened] = useState(false);
  const [, setLoads] = useState(0);
  const onCloseRef = useRef(props.onClose);
  useEffect(() => {
    onCloseRef.current = props.onClose;
  });

  // Remember the first open during render, so the viewer mounts in the same pass.
  if (isOpen && !opened) setOpened(true);

  // The first touch or key press anywhere starts the download.
  useEffect(() => {
    if (loadedLightbox) return;
    const start = () => void loadMediaLightbox().catch(() => {});
    const options = { capture: true, passive: true } as const;
    window.addEventListener("pointerdown", start, options);
    window.addEventListener("keydown", start, options);
    return () => {
      window.removeEventListener("pointerdown", start, options);
      window.removeEventListener("keydown", start, options);
    };
  }, []);

  useEffect(() => {
    if (loadedLightbox) return;
    let cancelled = false;
    const load = () =>
      loadMediaLightbox().then(
        () => {
          if (!cancelled) setLoads((count) => count + 1);
        },
        () => {
          // The code could not be fetched: give the page its closed state back
          // so the next tap tries again, instead of an open state showing nothing.
          if (!cancelled && isOpen) onCloseRef.current();
        }
      );
    if (isOpen) {
      void load();
      return () => {
        cancelled = true;
      };
    }
    const idleWindow = window as IdleWindow;
    if (idleWindow.requestIdleCallback && idleWindow.cancelIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => void load(), { timeout: 5000 });
      return () => {
        cancelled = true;
        idleWindow.cancelIdleCallback?.(handle);
      };
    }
    const timer = window.setTimeout(() => void load(), 2000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  const Lightbox = loadedLightbox;
  if (opened && Lightbox) return <Lightbox {...props} />;
  // Waiting for the code after a tap: nothing to see, but a second tap must
  // not reach the page (it would run the page's open handler again).
  if (isOpen)
    return <div aria-hidden="true" data-lightbox-wait="" className="fixed inset-0 z-[100]" />;
  return null;
}
