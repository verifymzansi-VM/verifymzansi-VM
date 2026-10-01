"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import { ArrowRight } from "lucide-react";
import { AnalyticsImpressions } from "@/components/analytics/analytics-impressions";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { trackSponsorClick } from "@/lib/analytics/commercial-events";
import { cn } from "@/lib/utils";
import { SponsorLogo } from "./sponsor-logo";

export interface StripSponsor {
  id: string;
  slug: string;
  name: string;
  logo_url: string | null;
}

/** Fewer chips than this sit still and centred: motion with two items looks broken. */
const MIN_ANIMATED = 3;
const PIXELS_PER_SECOND = 28;
const RESUME_AFTER_TOUCH_MS = 3000;

function Chips({
  sponsors,
  copy,
  centred = false,
}: {
  sponsors: StripSponsor[];
  copy: boolean;
  centred?: boolean;
}) {
  return (
    // Auto margins centre a short row without clipping a long one (justify-center
    // inside a scroller hides the first chips once they overflow).
    <ul
      className={cn("flex shrink-0 items-center gap-2 pr-2", centred && "sm:mx-auto")}
      aria-hidden={copy || undefined}
    >
      {sponsors.map((sponsor) => (
        <li key={sponsor.id} className="shrink-0">
          <Link
            href={`/organisation/${sponsor.slug}`}
            tabIndex={copy ? -1 : undefined}
            aria-label={`${sponsor.name} — view supported businesses`}
            onClick={() => trackSponsorClick(sponsor.id, "sponsor_strip")}
            className="flex h-11 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] py-1.5 pl-1.5 pr-3.5 text-sm font-medium text-white/90 transition-colors hover:border-brand-gold-300/60 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 focus-visible:ring-offset-2 focus-visible:ring-offset-brand-green-950"
          >
            <SponsorLogo src={sponsor.logo_url} name={sponsor.name} size={32} />
            <span className="max-w-[12rem] truncate">{sponsor.name}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * The moving row of programme partners. It scrolls the container (not a CSS
 * transform) so phones can drag it natively; it pauses on hover, keyboard
 * focus and touch, and sits still under reduced motion or with few sponsors.
 */
export function SponsorStripTrack({ sponsors }: { sponsors: StripSponsor[] }) {
  const reducedMotion = useReducedMotion();
  const animate = sponsors.length >= MIN_ANIMATED && !reducedMotion;
  const scroller = useRef<HTMLDivElement>(null);
  const paused = useRef(false);
  const resumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const el = scroller.current;
    if (!animate || !el) return;
    // scrollLeft is rounded by some engines; keep the exact position here.
    let position = el.scrollLeft;
    let last = performance.now();
    let frame = 0;
    const onScroll = () => {
      if (paused.current) position = el.scrollLeft;
    };
    const step = (now: number) => {
      const elapsed = Math.min(now - last, 100);
      last = now;
      if (!paused.current && !document.hidden) {
        const loop = el.scrollWidth / 2;
        position += (elapsed / 1000) * PIXELS_PER_SECOND;
        if (loop > 0 && position >= loop) position -= loop;
        el.scrollLeft = position;
      }
      frame = requestAnimationFrame(step);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    frame = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(frame);
      el.removeEventListener("scroll", onScroll);
      if (resumeTimer.current) clearTimeout(resumeTimer.current);
    };
  }, [animate]);

  const pause = () => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    paused.current = true;
  };
  const resume = (delay = 0) => {
    if (resumeTimer.current) clearTimeout(resumeTimer.current);
    resumeTimer.current = setTimeout(() => {
      paused.current = false;
    }, delay);
  };

  return (
    <>
      <div
        ref={scroller}
        className={cn(
          "scrollbar-hide flex min-w-0 flex-1 items-center overflow-x-auto overscroll-x-contain",
          animate &&
            "[mask-image:linear-gradient(to_right,transparent,black_24px,black_calc(100%-24px),transparent)]"
        )}
        onMouseEnter={pause}
        onMouseLeave={() => resume()}
        onFocus={pause}
        onBlur={() => resume()}
        onTouchStart={pause}
        onTouchEnd={() => resume(RESUME_AFTER_TOUCH_MS)}
      >
        <Chips sponsors={sponsors} copy={false} centred={!animate} />
        {animate ? <Chips sponsors={sponsors} copy /> : null}
      </div>
      <Link
        href="/sponsors"
        className="inline-flex h-11 shrink-0 items-center gap-1 rounded-full px-2 text-sm font-semibold text-brand-gold-300 underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300"
      >
        <span className="sm:hidden">All</span>
        <span className="hidden sm:inline">View all partners</span>
        <ArrowRight aria-hidden="true" className="h-4 w-4" />
      </Link>
      <AnalyticsImpressions
        items={sponsors.map((sponsor) => ({ table: "organisations", id: sponsor.id }))}
        surface="sponsor_strip"
      />
    </>
  );
}
