"use client";

import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type UploadSlotStatus = "idle" | "uploading" | "done" | "skipped";

export interface UploadSlot {
  key: string;
  label: string;
  doneLabel: string;
  status: UploadSlotStatus;
}

interface UploadProgressPanelProps {
  slots: UploadSlot[];
  visible: boolean;
}

export function UploadProgressPanel({ slots, visible }: UploadProgressPanelProps) {
  if (!visible) return null;

  const activeSlots = slots.filter((s) => s.status !== "skipped");
  if (activeSlots.length === 0) return null;
  const currentIndex = activeSlots.findIndex((slot) => slot.status === "uploading");
  const completedCount = activeSlots.filter((slot) => slot.status === "done").length;

  return (
    <div
      className="space-y-2 border-t pt-3 text-sm text-muted-foreground"
      aria-live="polite"
      aria-label={`Upload progress ${completedCount} of ${activeSlots.length} steps complete`}
    >
      {activeSlots.map((slot, index) => {
        const isActive = slot.status === "uploading";
        const isDone = slot.status === "done";
        const isWaiting = slot.status === "idle";
        const label = isDone ? slot.doneLabel : slot.label;

        return (
          <div
            key={slot.key}
            className={cn(
              "grid grid-cols-[1.5rem_1fr] items-start gap-2",
              isWaiting && "opacity-65"
            )}
          >
            <div className="relative flex h-5 w-5 items-center justify-center">
              {isActive ? (
                <Loader2 className="h-4 w-4 animate-spin text-brand-green" />
              ) : isDone ? (
                <CheckCircle2 className="h-4 w-4 text-brand-green" />
              ) : (
                <CircleDashed className="h-4 w-4 text-muted-foreground/70" />
              )}
            </div>
            <div className="min-w-0">
              <p className={cn("font-medium leading-tight", isActive && "text-foreground")}>
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {label}
              </p>
              {isActive && currentIndex >= 0 && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Step {currentIndex + 1} of {activeSlots.length}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
