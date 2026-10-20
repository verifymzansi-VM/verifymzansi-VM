"use client";

import { useEffect, useRef } from "react";

/** Each canvas pixel covers at least this many CSS pixels; the canvas is scaled up, which softens the waves. */
const CELL = 3;
/** Upper bound on canvas pixels per side, so very large panels stay cheap. */
const MAX_CELLS = 300;

/**
 * Shield contacts with the water, as shares of the drop animation
 * (.emblem-shield / emblem-drop in globals.css): the landing at 55% and the
 * smaller touch-down after its first bounce at 84%.
 */
const CONTACTS = [
  { at: 0.55, impact: "landing" },
  { at: 0.84, impact: "settle" },
] as const;

type Impact = {
  /** Height of the ring. Scales with how hard the shield hits. */
  amplitude: number;
  /** Distance between crests, CSS px. */
  wavelength: number;
  /** Length of the wave train behind the leading crest, CSS px. */
  train: number;
  /** Speed the ring leaves the rim at, CSS px per second. It slows as it spreads. */
  speed: number;
  /** Seconds for the ring to lose about two thirds of its height. */
  fade: number;
};

/** Ring size and speed follow the touch: the landing is the hardest, a bob the softest. */
const IMPACTS: Record<"landing" | "rebound" | "settle" | "bob" | "tap", Impact> = {
  landing: { amplitude: 1, wavelength: 38, train: 52, speed: 170, fade: 2 },
  rebound: { amplitude: 0.45, wavelength: 28, train: 34, speed: 105, fade: 1.3 },
  settle: { amplitude: 0.35, wavelength: 30, train: 36, speed: 95, fade: 1.4 },
  bob: { amplitude: 0.22, wavelength: 30, train: 36, speed: 80, fade: 1.6 },
  // A press on the shield pushes it into the water: firmer than a bob, gentler than the landing.
  tap: { amplitude: 0.6, wavelength: 34, train: 44, speed: 140, fade: 1.7 },
};
/** Most rings alive at once. */
const MAX_RIPPLES = 8;

/** After the landing, the water under the shield springs back and sends a second, weaker ring. */
const REBOUND_DELAY_MS = 320;

/** Share of the shield image's width that touches the water (the shield art inside its padding). */
const FOOTPRINT = 0.34;

const HIGHLIGHT = [255, 220, 160] as const; // light caught on a crest
const SHADOW = [0, 22, 15] as const; // deep green in the trough
const SHADE = 120;

type Ripple = Impact & { born: number };

/**
 * Water height at `rim` CSS px outside the shield's footprint, `age` seconds
 * after a touch: a short train of crests that leaves the rim fast and slows as
 * it spreads, thinning with distance and fading with time.
 */
function rippleHeight(ripple: Ripple, rim: number, age: number) {
  const front = (ripple.speed * age) / Math.sqrt(1 + age * 1.2);
  const behind = front - rim; // 0 at the leading crest, growing towards the shield
  if (behind < -ripple.wavelength || behind > ripple.train * 2.2) return 0;
  const envelope = Math.exp(
    -((behind - ripple.train * 0.45) ** 2) / (ripple.train * ripple.train * 0.35)
  );
  const strength = (ripple.amplitude * Math.exp(-age / ripple.fade)) / Math.sqrt(1 + rim / 48);
  return strength * envelope * Math.sin((behind / ripple.wavelength) * Math.PI * 2);
}

/** The running CSS animation by name, where the browser can report it (older ones cannot). */
function findAnimation(element: Element | null | undefined, name: string) {
  if (typeof element?.getAnimations !== "function") return undefined;
  return element
    .getAnimations()
    .find((animation) => (animation as CSSAnimation).animationName === name);
}

/**
 * Water seen from above, under the verification shield and across the whole
 * green brand surface it sits on. Every touch of the shield sends a ring out
 * from the shield's own rim at that instant: quick at first, slowing as it
 * spreads, sized by how hard the shield hit. The rings are computed, not simulated in a box, so they
 * thin out and fade long before any edge and never bounce back. Each frame the
 * slope of the water is shaded with light on the crests and shadow in the
 * troughs; flat water stays transparent so the surface shows through.
 *
 * Touches are timed from the shield's own drop animation, so the water answers
 * at the instant it lands. Nothing runs for reduced motion, in hidden tabs or
 * while the surface is off screen.
 */
export function WaterSurface() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    const emblem = canvas?.closest<HTMLElement>("[data-emblem]");
    // The green surface the water fills: the nearest BrandSurface, else the emblem itself.
    const surface = emblem?.closest<HTMLElement>(".brand-alive") ?? emblem;
    const shield = emblem?.querySelector<HTMLElement>(".emblem-shield");
    // The shield stays hidden until the water is ready (see .emblem-shield in
    // globals.css), so the splash never misses the landing. Its fallback fade-in
    // waits 3 s; once that has begun, the shield is already resting on the water
    // and skips the drop. Measured on the shield's own clock, not the page's.
    const fallback = findAnimation(shield, "emblem-fade-in");
    const late = typeof fallback?.currentTime === "number" && fallback.currentTime >= 3000;
    const release = () => emblem?.setAttribute("data-water-ready", late ? "late" : "");
    if (!canvas || !context || !emblem || !surface || !shield) return release();
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return release();
    if (document.documentElement.dataset.playwright === "1") return release();

    let cols = 0;
    let rows = 0;
    let scale = CELL;
    let heights = new Float32Array(0);
    let image: ImageData | null = null;
    // Where the shield sits (canvas pixels) and the radius of its footprint (CSS px).
    let originX = 0;
    let originY = 0;
    let footprint = 0;
    let ripples: Ripple[] = [];
    let frame = 0;
    let running = false;
    let visible = true;
    const timers: number[] = [];

    /** Stretches the canvas over the whole surface and sizes it to match. */
    function layout() {
      const area = surface!.getBoundingClientRect();
      const box = emblem!.getBoundingClientRect();
      if (area.width === 0 || area.height === 0) return;
      canvas!.style.left = `${area.left - box.left}px`;
      canvas!.style.top = `${area.top - box.top}px`;
      canvas!.style.width = `${area.width}px`;
      canvas!.style.height = `${area.height}px`;

      scale = Math.max(CELL, Math.max(area.width, area.height) / MAX_CELLS);
      originX = (box.left + box.width / 2 - area.left) / scale;
      originY = (box.top + box.height / 2 - area.top) / scale;
      // Layout width, not the on-screen box, which the drop animation scales.
      footprint = shield!.offsetWidth * FOOTPRINT;
      const nextCols = Math.max(8, Math.round(area.width / scale));
      const nextRows = Math.max(8, Math.round(area.height / scale));
      if (nextCols === cols && nextRows === rows) return;
      cols = nextCols;
      rows = nextRows;
      canvas!.width = cols;
      canvas!.height = rows;
      heights = new Float32Array(cols * rows);
      image = context!.createImageData(cols, rows);
    }

    function touch(kind: keyof typeof IMPACTS) {
      ripples.push({ ...IMPACTS[kind], born: performance.now() / 1000 });
      // Rapid taps layer up; keep the newest few so the frame cost stays flat.
      if (ripples.length > MAX_RIPPLES) ripples.splice(0, ripples.length - MAX_RIPPLES);
      wake();
    }

    /** Height of the water at every pixel: the sum of the live ripples. Returns false once all have faded. */
    function fill(now: number) {
      heights.fill(0);
      ripples = ripples.filter((ripple) => now - ripple.born < ripple.fade * 4);
      if (ripples.length === 0) return false;
      for (let y = 1; y < rows - 1; y++) {
        const dy = (y - originY) * scale;
        for (let x = 1; x < cols - 1; x++) {
          const dx = (x - originX) * scale;
          const rim = Math.sqrt(dx * dx + dy * dy) - footprint;
          if (rim < 0) continue; // under the shield
          let height = 0;
          for (const ripple of ripples) height += rippleHeight(ripple, rim, now - ripple.born);
          heights[y * cols + x] = height;
        }
      }
      return true;
    }

    /** Shades the slope facing the light (from the top left). */
    function paint() {
      const pixels = image!.data;
      for (let y = 1; y < rows - 1; y++) {
        for (let x = 1; x < cols - 1; x++) {
          const i = y * cols + x;
          const slope =
            (heights[i - cols] - heights[i + cols] + heights[i - 1] - heights[i + 1]) * SHADE;
          const o = i * 4;
          if (slope > 0) {
            pixels[o] = HIGHLIGHT[0];
            pixels[o + 1] = HIGHLIGHT[1];
            pixels[o + 2] = HIGHLIGHT[2];
            pixels[o + 3] = Math.min(190, slope);
          } else {
            pixels[o] = SHADOW[0];
            pixels[o + 1] = SHADOW[1];
            pixels[o + 2] = SHADOW[2];
            pixels[o + 3] = Math.min(130, -slope * 0.8);
          }
        }
      }
      context!.putImageData(image!, 0, 0);
    }

    function tick() {
      if (!fill(performance.now() / 1000)) {
        running = false;
        context!.clearRect(0, 0, cols, rows);
        return;
      }
      paint();
      if (!visible || document.hidden) {
        running = false;
        return;
      }
      frame = requestAnimationFrame(tick);
    }

    function wake() {
      if (running || !visible || document.hidden || !image) return;
      running = true;
      frame = requestAnimationFrame(tick);
    }

    layout();
    const resize = new ResizeObserver(layout);
    resize.observe(surface);

    // Let the shield fall now, and time the touches from its own drop animation.
    release();
    const drop = late ? undefined : findAnimation(shield, "emblem-drop");
    const elapsed = typeof drop?.currentTime === "number" ? drop.currentTime : 0;
    const duration = Number(drop?.effect?.getComputedTiming().duration) || 2600;
    // It can be pressed once it is resting on the water, not while it is still falling.
    const settle = () => shield.setAttribute("data-pressable", "");
    function onDropEnd(event: AnimationEvent) {
      if (event.animationName === "emblem-drop") settle();
    }
    if (late || drop?.playState === "finished") settle();
    else shield.addEventListener("animationend", onDropEnd);

    // Without the animation to read (older browsers), the drop starts now, at release.
    for (const contact of late ? [] : CONTACTS) {
      const wait = contact.at * duration - elapsed;
      if (wait < -200) continue; // already happened before the page came alive
      timers.push(window.setTimeout(() => touch(contact.impact), Math.max(0, wait)));
      if (contact.impact === "landing") {
        timers.push(
          window.setTimeout(() => touch("rebound"), Math.max(0, wait) + REBOUND_DELAY_MS)
        );
      }
    }

    // Each time the floating shield settles back onto the water, it disturbs it softly.
    function onFloat(event: Event) {
      if ((event as AnimationEvent).animationName === "emblem-float") touch("bob");
    }
    shield.addEventListener("animationiteration", onFloat);

    // Pressing the shield dips it into the water and sends a ring out from its rim.
    function onPress(event: PointerEvent) {
      if (event.button !== 0) return;
      shield!.setAttribute("data-pressed", "");
      touch("tap");
    }
    function onLift() {
      shield!.removeAttribute("data-pressed");
    }
    shield.addEventListener("pointerdown", onPress);
    shield.addEventListener("pointerup", onLift);
    shield.addEventListener("pointerleave", onLift);
    shield.addEventListener("pointercancel", onLift);

    const observer = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible) wake();
    });
    observer.observe(surface);
    const onVisibility = () => wake();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelAnimationFrame(frame);
      timers.forEach((timer) => window.clearTimeout(timer));
      resize.disconnect();
      shield.removeEventListener("animationiteration", onFloat);
      shield.removeEventListener("animationend", onDropEnd);
      shield.removeAttribute("data-pressed");
      shield.removeEventListener("pointerdown", onPress);
      shield.removeEventListener("pointerup", onLift);
      shield.removeEventListener("pointerleave", onLift);
      shield.removeEventListener("pointercancel", onLift);
      observer.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className="water-surface" />;
}
