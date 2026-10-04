"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useHydrated } from "@/hooks/use-hydrated";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

/**
 * A control drawn as a drop of liquid clinging to the right edge of the screen
 * (Video mode's show/hide tab, the lists' filters). Pulling it away from the
 * wall stretches and thins it; letting go past a point activates it, as does a
 * tap. It slides along the wall when dragged up or down and remembers where it
 * was left. A spring, not a timed animation, drives the shape, so it settles
 * naturally from wherever the finger let go.
 */

/** The drawing: the wall is the right edge of a 72 × 112 box. */
const BOX_W = 72;
const BOX_H = 112;
const WALL = BOX_W;
const CY = BOX_H / 2;
/** How far the drop bulges from the wall at rest, and its height at rest. */
const REST_W = 26;
const REST_H = 48;
const MAX_PULL = 44;
/** Pull further than this (after the rubber band) and let go to activate. */
const PULL_TO_ACTIVATE = 20;
const AXIS_LOCK = 6;
/** Spring: stiff enough to snap back, loose enough to wobble twice. */
const STIFFNESS = 320;
const DAMPING = 13;
const IDLE_RIPPLE_MS = 5200;

/** Liquid keeps its volume: a longer drop is a thinner drop. */
function heightFor(width: number) {
  return Math.min(66, Math.max(28, REST_H * Math.sqrt(REST_W / Math.max(width, 8))));
}

function dropPath(width: number) {
  const h = heightFor(width);
  // The base spreads along the wall like a meniscus, wider than the bulb.
  const base = h + 30;
  const k = base * 0.32;
  const tip = WALL - width;
  return [
    `M ${WALL} ${CY - base / 2}`,
    `C ${WALL} ${CY - base / 2 + k} ${tip} ${CY - h / 2} ${tip} ${CY}`,
    `C ${tip} ${CY + h / 2} ${WALL} ${CY + base / 2 - k} ${WALL} ${CY + base / 2}`,
    "Z",
  ].join(" ");
}

/** A damped spring for the drop's bulge, run frame by frame only while it moves. */
function createDropSpring(draw: (width: number) => void) {
  const state = { w: REST_W, v: 0, frame: 0, last: 0, held: false };
  const step = (time: number) => {
    const dt = Math.min(0.032, (time - (state.last || time)) / 1000);
    state.last = time;
    if (!state.held) {
      const force = -STIFFNESS * (state.w - REST_W) - DAMPING * state.v;
      state.v += force * dt;
      state.w += state.v * dt;
    }
    draw(state.w);
    if (state.held || Math.abs(state.v) > 0.5 || Math.abs(state.w - REST_W) > 0.15) {
      state.frame = requestAnimationFrame(step);
      return;
    }
    Object.assign(state, { w: REST_W, v: 0, frame: 0, last: 0 });
    draw(REST_W);
  };
  const run = () => {
    if (!state.frame) state.frame = requestAnimationFrame(step);
  };
  return {
    /** Push the bulge outwards (positive) or inwards and let it settle. */
    kick(velocity: number) {
      state.v += velocity;
      run();
    },
    /** Follow the finger exactly while it pulls. */
    hold(width: number) {
      state.held = true;
      state.w = width;
      state.v = 0;
      run();
    },
    release() {
      state.held = false;
      run();
      return state.w - REST_W;
    },
    get held() {
      return state.held;
    },
    stop() {
      cancelAnimationFrame(state.frame);
      state.frame = 0;
    },
  };
}

function readStoredY(key: string) {
  if (typeof window === "undefined") return 0;
  try {
    const value = Number(window.sessionStorage.getItem(key));
    return Number.isFinite(value) ? value : 0;
  } catch {
    return 0;
  }
}

export interface LiquidEdgeTabProps {
  label: string;
  onActivate: () => void;
  /** The symbol in the drop. */
  children: ReactNode;
  /** Gold rim: the tab holds something (controls tucked away, filters on). */
  highlighted?: boolean;
  /** A small count on the drop (filters in use). */
  badge?: number;
  /** Each change makes the drop swell (a value, not an event). */
  pulse?: unknown;
  /** Wait this long before swelling, e.g. until controls have flowed in. */
  pulseDelayMs?: number;
  /** A soft ripple every few seconds while it waits to be found. */
  ripple?: boolean;
  /** sessionStorage key for where along the wall it was left. */
  storageKey: string;
  /** Where it may slide, as offsets from its own resting place. */
  bounds: (restingTop: number, height: number) => { min: number; max: number };
  ariaExpanded?: boolean;
  ariaHasPopup?: "dialog";
  /** Positioning: `absolute`/`fixed`, right edge and resting top. */
  className?: string;
}

export function LiquidEdgeTab({
  label,
  onActivate,
  children,
  highlighted = false,
  badge = 0,
  pulse,
  pulseDelayMs = 0,
  ripple = false,
  storageKey,
  bounds,
  ariaExpanded,
  ariaHasPopup,
  className,
}: LiquidEdgeTabProps) {
  const hydrated = useHydrated();
  const reducedMotion = useReducedMotion();
  const gradientId = useId();
  const pathRef = useRef<SVGPathElement>(null);
  const iconRef = useRef<HTMLSpanElement>(null);
  const spring = useRef<ReturnType<typeof createDropSpring> | null>(null);
  const [offsetY, setOffsetY] = useState(() => readStoredY(storageKey));
  const buttonRef = useRef<HTMLButtonElement>(null);
  const boundsRef = useRef(bounds);
  useEffect(() => {
    boundsRef.current = bounds;
  });

  // A spot remembered on a taller screen (or before rotating) is pulled back into view.
  useEffect(() => {
    if (!hydrated) return;
    const clamp = () =>
      setOffsetY((current) => {
        const element = buttonRef.current;
        if (!element) return current;
        const restingTop = element.getBoundingClientRect().top - current;
        const { min, max } = boundsRef.current(restingTop, element.offsetHeight);
        return Math.min(Math.max(current, Math.min(min, max)), max);
      });
    const frame = requestAnimationFrame(clamp);
    window.addEventListener("resize", clamp);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", clamp);
    };
  }, [hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    const instance = createDropSpring((width) => {
      pathRef.current?.setAttribute("d", dropPath(width));
      // The symbol rides at the centre of the bulb.
      if (iconRef.current) {
        iconRef.current.style.transform = `translateX(${-(width - REST_W) / 2}px)`;
      }
    });
    spring.current = instance;
    return () => instance.stop();
  }, [hydrated]);

  const kick = useCallback(
    (velocity: number) => {
      if (!reducedMotion) spring.current?.kick(velocity);
    },
    [reducedMotion]
  );

  const firstPulse = useRef(true);
  useEffect(() => {
    if (firstPulse.current) {
      firstPulse.current = false;
      return;
    }
    if (!pulseDelayMs) {
      kick(520);
      return;
    }
    const timer = window.setTimeout(() => kick(420), pulseDelayMs);
    return () => window.clearTimeout(timer);
  }, [pulse, pulseDelayMs, kick]);

  useEffect(() => {
    if (!ripple || reducedMotion) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && !spring.current?.held) kick(150);
    }, IDLE_RIPPLE_MS);
    return () => window.clearInterval(timer);
  }, [ripple, reducedMotion, kick]);

  /* ── Pull it away from the wall to activate, or slide it along the wall ── */
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    baseY: number;
    min: number;
    max: number;
    axis: "x" | "y" | null;
  } | null>(null);
  const suppressClick = useRef(false);

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary) return;
    const element = event.currentTarget;
    const restingTop = element.getBoundingClientRect().top - offsetY;
    const { min, max } = bounds(restingTop, element.offsetHeight);
    drag.current = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      baseY: offsetY,
      min: Math.min(min, max),
      max,
      axis: null,
    };
    // Pressed: the drop gives a little under the finger.
    kick(-90);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.id !== event.pointerId) return;
    const pull = state.x - event.clientX;
    const dy = event.clientY - state.y;
    if (!state.axis) {
      if (Math.max(Math.abs(pull), Math.abs(dy)) < AXIS_LOCK) return;
      state.axis = Math.abs(pull) > Math.abs(dy) ? "x" : "y";
      suppressClick.current = true;
      try {
        event.currentTarget.setPointerCapture(event.pointerId);
      } catch {
        // The pointer already ended.
      }
    }
    if (state.axis === "x") {
      // Rubber band: easy at first, harder the further it goes.
      const stretch = MAX_PULL * (1 - Math.exp(-Math.max(0, pull) / MAX_PULL));
      spring.current?.hold(REST_W + stretch);
    } else {
      setOffsetY(Math.min(state.max, Math.max(state.min, state.baseY + dy)));
    }
  };

  const onPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    drag.current = null;
    if (!state || state.id !== event.pointerId) return;
    if (state.axis === "x") {
      // Let go: the stretched drop snaps back to the wall.
      const stretched = spring.current?.release() ?? 0;
      if (stretched >= PULL_TO_ACTIVATE) onActivate();
    } else if (state.axis === "y") {
      try {
        window.sessionStorage.setItem(storageKey, String(Math.round(offsetY)));
      } catch {
        // Only the position is lost.
      }
      kick(200);
    }
  };

  if (!hydrated) return null;

  return (
    <button
      ref={buttonRef}
      type="button"
      data-vm-control
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        onActivate();
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      aria-label={badge > 0 ? `${label}, ${badge} on` : label}
      aria-expanded={ariaExpanded}
      aria-haspopup={ariaHasPopup}
      title={label}
      style={{ transform: `translate3d(0, ${offsetY}px, 0)`, touchAction: "none" }}
      className={cn("group h-[72px] w-12 focus-visible:outline-none", className)}
    >
      <svg
        viewBox={`0 0 ${BOX_W} ${BOX_H}`}
        width={BOX_W}
        height={BOX_H}
        className="pointer-events-none absolute right-0 top-1/2 -translate-y-1/2 overflow-visible drop-shadow-[0_2px_6px_rgba(0,0,0,0.45)]"
        aria-hidden="true"
      >
        <defs>
          {/* A faint highlight across the top makes it read as a drop, not a flat tab. */}
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#0b4a3b" />
            <stop offset="0.55" stopColor="#03241d" />
            <stop offset="1" stopColor="#021a15" />
          </linearGradient>
        </defs>
        <path
          ref={pathRef}
          d={dropPath(REST_W)}
          fill={`url(#${gradientId})`}
          fillOpacity={0.9}
          stroke={highlighted ? "rgb(245 204 112 / 0.85)" : "rgb(255 255 255 / 0.3)"}
          strokeWidth={1.2}
          className="transition-[stroke] duration-500 group-focus-visible:stroke-brand-gold-300 group-focus-visible:[stroke-width:2.5]"
        />
      </svg>
      <span
        ref={iconRef}
        className="pointer-events-none absolute right-[3px] top-[calc(50%-10px)] flex h-5 w-5 items-center justify-center text-white"
        aria-hidden="true"
      >
        {children}
        {badge > 0 ? (
          <span className="absolute -left-2 -top-3 flex h-4 min-w-4 items-center justify-center rounded-full bg-brand-gold-300 px-1 text-[10px] font-bold leading-none text-brand-gold-950">
            {badge}
          </span>
        ) : null}
      </span>
    </button>
  );
}
