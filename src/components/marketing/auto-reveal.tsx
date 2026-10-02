"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";

/** Content blocks that rise into view as the visitor scrolls down any page. */
const CANDIDATES = "main .surface-card, main .hero-panel, main .spotlight, main [data-reveal]";
/** Places where hiding content would fight another behaviour (Reveal, dialogs, sideways rails). */
const SKIP_INSIDE =
  '.reveal, [role="dialog"], [role="alertdialog"], [data-no-reveal], .scrollbar-hide, [class*="overflow-x-auto"], [class*="overflow-x-scroll"], [class*="snap-x"]';
const STAGGER_MS = 70;
const MAX_STAGGER_STEPS = 5;
const KEYFRAMES: Keyframe[] = [
  { opacity: 0, transform: "translateY(26px)" },
  { opacity: 1, transform: "none" },
];

/**
 * Site-wide scroll entrance. After each navigation it finds the cards below the fold and
 * lets them fade up as they arrive, staggering neighbours. It uses the Web Animations API
 * and never writes classes or attributes, so it can't disturb hydration or React renders.
 * Nothing is hidden on the server, without JavaScript, above the fold, under reduced
 * motion or in Playwright runs, and a finished entrance leaves no styles behind.
 */
export function AutoReveal() {
  const pathname = usePathname();

  useEffect(() => {
    if (typeof IntersectionObserver === "undefined") return;
    if (typeof Element.prototype.animate !== "function") return;
    if (document.documentElement.dataset.playwright === "1") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const seen = new WeakSet<Element>();
    const pending = new Map<Element, Animation>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          pending.get(entry.target)?.play();
          pending.delete(entry.target);
        }
      },
      { rootMargin: "0px 0px -6% 0px" }
    );

    const scan = () => {
      const fold = window.innerHeight;
      // A hidden or zero-height viewport has no fold to measure against.
      if (fold <= 0) return;
      const picked = Array.from(document.querySelectorAll<HTMLElement>(CANDIDATES)).filter((el) => {
        if (seen.has(el)) return false;
        seen.add(el);
        if (el.closest(SKIP_INSIDE)) return false;
        // Only the outermost card animates; nested cards ride along with it.
        if (el.parentElement?.closest(CANDIDATES)) return false;
        return el.getBoundingClientRect().top > fold;
      });

      const stepByParent = new Map<Element | null, number>();
      for (const el of picked) {
        const step = stepByParent.get(el.parentElement) ?? 0;
        stepByParent.set(el.parentElement, step + 1);
        // Paused at the start of a backwards-filled animation, the card holds its hidden
        // first frame until it scrolls into view and the animation plays.
        const animation = el.animate(KEYFRAMES, {
          duration: 650,
          delay: Math.min(step, MAX_STAGGER_STEPS) * STAGGER_MS,
          easing: "cubic-bezier(0.2, 0.7, 0.2, 1)",
          fill: "backwards",
        });
        animation.pause();
        pending.set(el, animation);
        observer.observe(el);
      }
    };

    const showAll = () => {
      for (const animation of pending.values()) animation.finish();
      pending.clear();
      observer.disconnect();
    };

    // Once now, and again after streamed sections have had a moment to land.
    const first = requestAnimationFrame(scan);
    const late = window.setTimeout(scan, 900);
    window.addEventListener("beforeprint", showAll);

    return () => {
      cancelAnimationFrame(first);
      window.clearTimeout(late);
      window.removeEventListener("beforeprint", showAll);
      for (const animation of pending.values()) animation.cancel();
      pending.clear();
      observer.disconnect();
    };
  }, [pathname]);

  return null;
}
