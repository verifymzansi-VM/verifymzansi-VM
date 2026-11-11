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
 * fetched when the browser is idle after the page has loaded (so the first tap
 * still opens it at once), or on the first open if that comes sooner. Nothing
 * is rendered until it is first opened; afterwards it stays mounted, so it
 * closes with its usual animation.
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
  return opened && Lightbox ? <Lightbox {...props} /> : null;
}
