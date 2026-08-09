"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Building2, ShoppingBag, TreePalm, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "vmz-home-onboarding-order";
const DRAG_ACTIVATION_PX = 10;
const TOUCH_REORDER_HOLD_MS = 280;

type IconKey = "market" | "business" | "tourism";

export interface HomeOnboardingDestination {
  id: string;
  title: string;
  description: string;
  href: string;
  iconKey: IconKey;
  accentClass: string;
  iconBgClass: string;
}

const ICONS: Record<IconKey, LucideIcon> = {
  market: ShoppingBag,
  business: Building2,
  tourism: TreePalm,
};

function reorderItems<T>(items: T[], from: number, to: number) {
  if (from === to) return items;
  const next = items.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

function resolveInitialOrder(destinations: readonly HomeOnboardingDestination[]) {
  if (typeof window === "undefined") {
    return [...destinations];
  }

  const savedOrder = window.sessionStorage.getItem(STORAGE_KEY);
  if (!savedOrder) {
    return [...destinations];
  }

  try {
    const ids = JSON.parse(savedOrder) as string[];
    const byId = new Map(destinations.map((item) => [item.id, item]));
    const restored = ids
      .map((id) => byId.get(id))
      .filter((item): item is HomeOnboardingDestination => Boolean(item));

    const missing = destinations.filter((item) => !ids.includes(item.id));
    return [...restored, ...missing];
  } catch {
    return [...destinations];
  }
}

export function HomeOnboardingDestinations({
  destinations,
}: {
  destinations: readonly HomeOnboardingDestination[];
}) {
  const [orderedItems, setOrderedItems] = useState(() => resolveInitialOrder(destinations));
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const dragMovedRef = useRef(false);
  const dragStateRef = useRef<{
    pointerId: number;
    id: string;
    startY: number;
    lastY: number;
    originIndex: number;
    activeIndex: number;
    cardHeight: number;
  } | null>(null);
  const pendingTouchRef = useRef<{
    pointerId: number;
    id: string;
    startY: number;
    index: number;
  } | null>(null);
  const touchHoldTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardRefs = useRef(new Map<string, HTMLAnchorElement>());

  const clearPendingTouch = useCallback(() => {
    pendingTouchRef.current = null;
    if (touchHoldTimeoutRef.current) {
      clearTimeout(touchHoldTimeoutRef.current);
      touchHoldTimeoutRef.current = null;
    }
  }, []);

  const persistOrder = useCallback((items: HomeOnboardingDestination[]) => {
    if (typeof window === "undefined") return;
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(items.map((item) => item.id)));
  }, []);

  const beginDrag = useCallback(
    ({
      pointerId,
      id,
      clientY,
      index,
    }: {
      pointerId: number;
      id: string;
      clientY: number;
      index: number;
    }) => {
      const card = cardRefs.current.get(id);
      const rect = card?.getBoundingClientRect();
      dragMovedRef.current = false;
      dragStateRef.current = {
        pointerId,
        id,
        startY: clientY,
        lastY: clientY,
        originIndex: index,
        activeIndex: index,
        cardHeight: rect?.height ?? 1,
      };
      setDraggedId(id);
      try {
        if (card && !card.hasPointerCapture(pointerId)) {
          card.setPointerCapture(pointerId);
        }
      } catch {
        /* noop */
      }
    },
    []
  );

  const handlePointerMove = useCallback(
    (event: PointerEvent) => {
      const pendingTouch = pendingTouchRef.current;
      if (pendingTouch && pendingTouch.pointerId === event.pointerId && !dragStateRef.current) {
        if (Math.abs(event.clientY - pendingTouch.startY) > DRAG_ACTIVATION_PX) {
          clearPendingTouch();
        }
        return;
      }

      const dragState = dragStateRef.current;
      if (!dragState || dragState.pointerId !== event.pointerId) return;

      const deltaY = event.clientY - dragState.startY;
      dragState.lastY = event.clientY;
      if (Math.abs(deltaY) > DRAG_ACTIVATION_PX) {
        dragMovedRef.current = true;
      }

      const step = Math.max(dragState.cardHeight, 1);
      const slotShift = Math.round(deltaY / step);
      const nextIndex = Math.max(
        0,
        Math.min(dragState.originIndex + slotShift, orderedItems.length - 1)
      );

      if (nextIndex === dragState.activeIndex) return;

      setOrderedItems((current) => {
        const currentIndex = current.findIndex((item) => item.id === dragState.id);
        if (currentIndex === -1) return current;
        dragState.activeIndex = nextIndex;
        return reorderItems(current, currentIndex, nextIndex);
      });
    },
    [clearPendingTouch, orderedItems.length]
  );

  const stopDragging = useCallback(
    (pointerId?: number) => {
      const pendingTouch = pendingTouchRef.current;
      if (pendingTouch && (pointerId == null || pendingTouch.pointerId === pointerId)) {
        clearPendingTouch();
      }

      const dragState = dragStateRef.current;
      if (!dragState || (pointerId != null && dragState.pointerId !== pointerId)) return;

      const activeCard = cardRefs.current.get(dragState.id);
      try {
        if (pointerId != null && activeCard?.hasPointerCapture(pointerId)) {
          activeCard.releasePointerCapture(pointerId);
        }
      } catch {
        /* noop */
      }

      dragStateRef.current = null;
      setDraggedId(null);
      setTimeout(() => {
        dragMovedRef.current = false;
      }, 0);
    },
    [clearPendingTouch]
  );

  useEffect(() => {
    const handlePointerUp = (event: PointerEvent) => {
      stopDragging(event.pointerId);
    };
    const handlePointerCancel = (event: PointerEvent) => {
      stopDragging(event.pointerId);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      window.removeEventListener("pointercancel", handlePointerCancel);
    };
  }, [handlePointerMove, stopDragging]);

  useEffect(() => {
    return () => {
      clearPendingTouch();
    };
  }, [clearPendingTouch]);

  const renderedItems = useMemo(() => orderedItems, [orderedItems]);

  useEffect(() => {
    if (draggedId) return;
    persistOrder(orderedItems);
  }, [draggedId, orderedItems, persistOrder]);

  return (
    <div className="grid w-full max-w-xl gap-3 self-start justify-self-center">
      {renderedItems.map((item, index) => {
        const Icon = ICONS[item.iconKey];
        const isDragging = draggedId === item.id;

        return (
          <Link
            key={item.id}
            ref={(node) => {
              if (node) {
                cardRefs.current.set(item.id, node);
              } else {
                cardRefs.current.delete(item.id);
              }
            }}
            href={item.href}
            prefetch={false}
            draggable={false}
            data-onboarding-card={item.id}
            data-onboarding-index={index}
            onPointerDown={(event) => {
              if (event.button !== 0) return;
              if (event.pointerType === "touch") {
                clearPendingTouch();
                pendingTouchRef.current = {
                  pointerId: event.pointerId,
                  id: item.id,
                  startY: event.clientY,
                  index,
                };
                touchHoldTimeoutRef.current = setTimeout(() => {
                  const pendingTouch = pendingTouchRef.current;
                  if (!pendingTouch || pendingTouch.pointerId !== event.pointerId) return;
                  beginDrag({
                    pointerId: pendingTouch.pointerId,
                    id: pendingTouch.id,
                    clientY: pendingTouch.startY,
                    index: pendingTouch.index,
                  });
                  clearPendingTouch();
                }, TOUCH_REORDER_HOLD_MS);
                return;
              }

              beginDrag({
                pointerId: event.pointerId,
                id: item.id,
                clientY: event.clientY,
                index,
              });
            }}
            onClickCapture={(event) => {
              if (!dragMovedRef.current) return;
              event.preventDefault();
              event.stopPropagation();
              dragMovedRef.current = false;
            }}
            className={cn(
              "group rounded-[1.5rem] border border-slate-200/80 bg-white/88 p-4 elev-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white hover:elev-md dark:border-white/10 dark:bg-white/[0.03] dark:hover:border-white/15 dark:hover:bg-white/[0.05]",
              isDragging &&
                "cursor-grabbing border-brand-green/35 shadow-[0_24px_50px_-26px_rgba(21,128,61,0.35)] ring-1 ring-brand-green/20"
            )}
          >
            <div className="flex items-start gap-4">
              <div
                className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl ring-1 ring-black/5 transition-transform duration-200 group-hover:scale-105 dark:ring-white/10 ${item.iconBgClass} ${item.accentClass}`}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 space-y-2">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-base font-semibold tracking-tight text-slate-950 dark:text-white">
                    {item.title}
                  </p>
                  <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-all duration-200 group-hover:translate-x-1 group-hover:text-slate-600 dark:text-slate-500 dark:group-hover:text-slate-300" />
                </div>
                <p className="text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {item.description}
                </p>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
