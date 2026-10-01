"use client";

import { useEffect, useRef, useState } from "react";
import { BadgeCheck, MapPin, MessageCircle, Pause, Phone, Play } from "lucide-react";
import { cn } from "@/lib/utils";

const LENGTH_SECONDS = 12;

function clock(seconds: number) {
  return `0:${String(seconds).padStart(2, "0")}`;
}

/**
 * An illustrated video post, so visitors can see what "video-first" means. It is clearly
 * labelled as an illustration, starts playing when scrolled into view (unless the visitor
 * prefers reduced motion) and can be paused or restarted with a tap.
 */
export function VideoShowcase({ className }: { className?: string }) {
  const frameRef = useRef<HTMLDivElement>(null);
  const [playing, setPlaying] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [tilt, setTilt] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const observer = new IntersectionObserver(
      ([entry]) => setPlaying(Boolean(entry?.isIntersecting)),
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing) return;
    const timer = window.setInterval(
      () => setElapsed((value) => (value + 1) % LENGTH_SECONDS),
      1000
    );
    return () => window.clearInterval(timer);
  }, [playing]);

  function onMove(event: React.PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "mouse") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTilt({
      x: ((event.clientX - rect.left) / rect.width - 0.5) * 10,
      y: ((event.clientY - rect.top) / rect.height - 0.5) * -10,
    });
  }

  return (
    <div
      className={cn("relative mx-auto w-full max-w-[19rem] [perspective:1000px]", className)}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt({ x: 0, y: 0 })}
    >
      <div
        aria-hidden="true"
        className="absolute -inset-6 -z-10 rounded-[3rem] bg-[radial-gradient(circle_at_50%_40%,rgba(249,168,38,0.28),transparent_65%)] blur-2xl"
      />

      <div
        ref={frameRef}
        className="relative aspect-[9/16] overflow-hidden rounded-[2rem] border-[6px] border-brand-green-950 bg-brand-green-900 shadow-2xl transition-transform duration-200 ease-out"
        style={{ transform: `rotateY(${tilt.x}deg) rotateX(${tilt.y}deg)` }}
      >
        {/* Scene: a stylised stand-in for the poster's footage. */}
        <div
          aria-hidden="true"
          className="absolute inset-0 bg-[linear-gradient(160deg,#0b7a55_0%,#08624a_45%,#052e25_100%)]"
        />
        <div
          aria-hidden="true"
          className={cn(
            "absolute -left-10 top-1/4 h-40 w-40 rounded-full bg-brand-gold/40 blur-3xl transition-transform [transition-duration:4000ms] ease-in-out",
            playing && "translate-x-32 translate-y-10"
          )}
        />
        <div
          aria-hidden="true"
          className={cn(
            "absolute -right-8 bottom-1/4 h-44 w-44 rounded-full bg-emerald-300/30 blur-3xl transition-transform [transition-duration:5000ms] ease-in-out",
            playing && "-translate-x-28 -translate-y-12"
          )}
        />
        {playing ? <div aria-hidden="true" className="video-sweep absolute inset-0" /> : null}

        {/* Top bar */}
        <div className="absolute inset-x-3 top-3 flex items-center justify-between text-[11px] font-semibold text-white">
          <span className="inline-flex items-center gap-1 rounded-full bg-black/35 px-2.5 py-1 backdrop-blur-sm">
            <BadgeCheck aria-hidden="true" className="h-3.5 w-3.5 text-brand-gold-300" />
            Identity reviewed
          </span>
          <span className="rounded-full bg-black/35 px-2.5 py-1 tabular-nums backdrop-blur-sm">
            {clock(elapsed)} / {clock(LENGTH_SECONDS)}
          </span>
        </div>

        {/* Play / pause */}
        <button
          type="button"
          onClick={() => setPlaying((value) => !value)}
          aria-pressed={playing}
          aria-label={playing ? "Pause the example video" : "Play the example video"}
          className="group absolute left-1/2 top-[42%] flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-brand-green-900 shadow-lg transition-transform duration-200 hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-gold-300 active:scale-95"
        >
          {!playing ? (
            <span
              aria-hidden="true"
              className="video-ring absolute inset-0 rounded-full border-2 border-white/80"
            />
          ) : null}
          {playing ? (
            <Pause aria-hidden="true" className="h-6 w-6" fill="currentColor" />
          ) : (
            <Play aria-hidden="true" className="ml-0.5 h-6 w-6" fill="currentColor" />
          )}
        </button>

        {/* Post details */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/75 via-black/40 to-transparent px-4 pb-4 pt-16 text-white">
          <p className="font-display text-lg font-bold leading-tight">2019 hatchback, one owner</p>
          <p className="mt-0.5 inline-flex items-center gap-1 text-xs text-white/80">
            <MapPin aria-hidden="true" className="h-3.5 w-3.5" />
            Richards Bay
          </p>
          <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/25" aria-hidden="true">
            {/* Driven by the clock so pausing keeps the bar where the time is. While playing it
                eases toward the next second; the wrap back to the start is instant. */}
            <div
              className="h-full origin-left rounded-full bg-brand-gold-300 transition-transform ease-linear"
              style={{
                transform: `scaleX(${Math.max((elapsed + (playing ? 1 : 0)) / LENGTH_SECONDS, 0.02)})`,
                transitionDuration: playing && elapsed > 0 ? "1000ms" : "0ms",
              }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-xs font-semibold">
            <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-white py-2 text-brand-green-900">
              <Phone aria-hidden="true" className="h-3.5 w-3.5" />
              Call
            </span>
            <span className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#25d366] py-2 text-brand-green-950">
              <MessageCircle aria-hidden="true" className="h-3.5 w-3.5" />
              WhatsApp
            </span>
          </div>
        </div>
      </div>

      <p className="mt-3 text-center text-xs text-muted-foreground">
        Illustration of a video post, not a real listing.
      </p>
    </div>
  );
}
