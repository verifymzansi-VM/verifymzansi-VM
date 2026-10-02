"use client";

import {
  Component,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ClassicSuppressionProvider } from "@/components/immersive/classic-suppression";
import dynamic from "next/dynamic";
import { IMMERSIVE_MIN_WIDTH_QUERY } from "@/lib/feed/session";
import type { FeedSlide } from "@/lib/feed/types";
import { trackContentView } from "@/lib/views/content-views";

// Loaded only on desktop; a failed download falls back to the classic page.
const ImmersiveViewer = dynamic(
  () => import("@/components/immersive/immersive-viewer").then((module) => module.ImmersiveViewer),
  {
    ssr: false,
    loading: () => <div className="fixed inset-0 z-50 bg-brand-green-950" aria-hidden="true" />,
  }
);

const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;

class ViewerBoundary extends Component<
  { children: ReactNode; onFail: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("[ImmersiveViewer]", error);
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

type Mode = "pending" | "immersive" | "classic";

function pageShell(): HTMLElement | null {
  return document.querySelector<HTMLElement>("[data-desktop-scale]");
}

/**
 * Desktop (1024px and wider) post pages open in the full-screen viewer; phones
 * and tablets keep the classic page, which the server always renders (search
 * engines, no-JavaScript visitors and the fallback all get it).
 *
 * Before the browser runs any script the classic page is covered by the brand
 * surface for up to three seconds (CSS only, see globals.css), so the switch
 * never flashes. If the viewer fails, the classic page comes back and counts
 * the visit itself.
 */
export function ImmersiveDetailGate({
  initialSlide,
  children,
}: {
  initialSlide: FeedSlide;
  children: ReactNode;
}) {
  const classicRef = useRef<HTMLDivElement>(null);
  // Decided in the first browser render, before any child effect reads it.
  // Never rendered, so it cannot cause a hydration mismatch.
  const [desktopAtStart] = useState(
    () => typeof window !== "undefined" && window.matchMedia(IMMERSIVE_MIN_WIDTH_QUERY).matches
  );
  const fellBack = useRef(false);
  const isSuppressed = useCallback(() => desktopAtStart && !fellBack.current, [desktopAtStart]);
  const [mode, setMode] = useState<Mode>("pending");
  const activeHref = useRef(initialSlide.href);

  useIsomorphicLayoutEffect(() => {
    const query = window.matchMedia(IMMERSIVE_MIN_WIDTH_QUERY);
    if (query.matches) {
      // Hide synchronously so the classic player never starts behind the viewer.
      classicRef.current?.setAttribute("hidden", "");
      setMode("immersive");
    } else {
      setMode("classic");
    }
  }, []);

  useEffect(() => {
    const query = window.matchMedia(IMMERSIVE_MIN_WIDTH_QUERY);
    function onChange() {
      if (query.matches) return;
      // Narrowing the window: show the classic page of the post on screen,
      // never the stale page of the post that was opened first.
      const current = `${window.location.pathname}`;
      if (activeHref.current !== initialSlide.href || current !== initialSlide.href) {
        window.location.assign(activeHref.current);
        return;
      }
      setMode("classic");
    }
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [initialSlide.href]);

  useEffect(() => {
    if (mode !== "immersive") return;
    const shell = pageShell();
    const root = document.documentElement;
    const previousOverflow = root.style.overflow;
    // The page underneath is out of reach while the viewer is open.
    shell?.setAttribute("inert", "");
    root.style.overflow = "hidden";
    return () => {
      shell?.removeAttribute("inert");
      root.style.overflow = previousOverflow;
    };
  }, [mode]);

  const fallBack = useCallback(() => {
    fellBack.current = true;
    classicRef.current?.removeAttribute("hidden");
    setMode("classic");
    void trackContentView({
      type: initialSlide.targetType,
      id: initialSlide.id,
      source: "page",
      surface: "detail",
    });
  }, [initialSlide]);

  return (
    <ClassicSuppressionProvider value={isSuppressed}>
      <div
        ref={classicRef}
        data-immersive-pending={mode === "pending" ? "" : undefined}
        hidden={mode === "immersive"}
      >
        {children}
      </div>
      {mode === "immersive"
        ? createPortal(
            <ViewerBoundary onFail={fallBack}>
              <ImmersiveViewer
                initialSlide={initialSlide}
                onActiveHrefChange={(href) => {
                  activeHref.current = href;
                }}
              />
            </ViewerBoundary>,
            document.body
          )
        : null}
    </ClassicSuppressionProvider>
  );
}
