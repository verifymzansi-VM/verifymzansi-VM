"use client";

import type { ElementType, PointerEvent, ReactNode } from "react";
import { cn } from "@/lib/utils";

/** A card that lifts on hover (see `.spotlight` in globals.css). */
export function SpotlightCard({
  as: Tag = "div",
  className,
  children,
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
}) {
  function track(event: PointerEvent<HTMLElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    event.currentTarget.style.setProperty("--mx", `${event.clientX - rect.left}px`);
    event.currentTarget.style.setProperty("--my", `${event.clientY - rect.top}px`);
  }

  return (
    <Tag onPointerMove={track} className={cn("spotlight", className)}>
      {children}
    </Tag>
  );
}
