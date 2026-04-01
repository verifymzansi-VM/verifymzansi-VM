"use client";

import Image from "next/image";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useReducedMotion } from "@/hooks/use-reduced-motion";
import { cn } from "@/lib/utils";

export interface SideCardItem {
  id: string;
  imageUrl: string;
  /** Override the default /promotion/:id link target */
  href?: string;
}

interface ShowroomSideCardProps {
  items: SideCardItem[];
  /** Delay in ms before the first rotation (used to stagger left/right cards) */
  initialDelayMs?: number;
}

export function ShowroomSideCard({ items, initialDelayMs = 0 }: ShowroomSideCardProps) {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);
  const prefersReducedMotion = useReducedMotion();
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const delayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const advance = useCallback(() => {
    setFading(true);
    fadeRef.current = setTimeout(() => {
      setCurrent((prev) => (prev + 1) % items.length);
      setFading(false);
    }, 300);
  }, [items.length]);

  useEffect(() => {
    if (items.length <= 1 || prefersReducedMotion) return;

    if (initialDelayMs > 0) {
      // Delay the first transition on one side so both cards do not advance in sync.
      delayRef.current = setTimeout(() => {
        advance();
        timerRef.current = setInterval(advance, 6000);
      }, initialDelayMs);
    } else {
      timerRef.current = setInterval(advance, 6000);
    }

    return () => {
      if (delayRef.current) clearTimeout(delayRef.current);
      if (timerRef.current) clearInterval(timerRef.current);
      if (fadeRef.current) clearTimeout(fadeRef.current);
    };
  }, [items.length, prefersReducedMotion, initialDelayMs, advance]);

  if (items.length === 0) return null;

  // Safety: clamp current to valid range
  const safeIndex = current % items.length;
  const item = items[safeIndex];

  return (
    <Link
      href={item.href || `/promotion/${item.id}`}
      className={cn(
        "relative block h-full w-full overflow-hidden rounded-lg border",
        "border-warm-200 bg-warm-100",
        "dark:border-warm-800 dark:bg-warm-900",
        "transition-shadow hover:shadow-md"
      )}
      aria-label="View promotion"
    >
      <div
        className={cn(
          "absolute inset-0 transition-opacity duration-300",
          fading ? "opacity-0" : "opacity-100"
        )}
      >
        <Image
          src={item.imageUrl}
          alt=""
          fill
          sizes="(min-width: 1024px) 15vw, 0px"
          className="object-cover"
          unoptimized
        />
      </div>
    </Link>
  );
}
