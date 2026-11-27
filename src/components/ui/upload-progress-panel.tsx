"use client";

import { useCallback, useMemo, useState } from "react";
import { CheckCircle2, CircleDashed, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type UploadSlotStatus = "idle" | "uploading" | "done" | "skipped";

export interface UploadSlot {
  key: string;
  label: string;
  doneLabel: string;
  status: UploadSlotStatus;
}

/** How far one upload has got; a video is converted on the phone before it is sent. */
export interface UploadProgressValue {
  percent: number;
  phase?: "preparing" | "uploading";
}

interface UploadProgressPanelProps {
  slots: UploadSlot[];
  visible: boolean;
  /**
   * Progress by slot key. A slot fed by several requests uses sub-keys
   * ("photos:cover", "photos:gallery"); the panel shows their average.
   */
  progress?: Record<string, UploadProgressValue>;
}

/** Progress state for the panel. Callbacks skip unchanged values to limit re-renders. */
export function useUploadProgress() {
  const [values, setValues] = useState<Record<string, UploadProgressValue>>({});
  const setValue = useCallback((key: string, value: UploadProgressValue) => {
    setValues((current) => {
      const previous = current[key];
      if (previous && previous.percent === value.percent && previous.phase === value.phase) {
        return current;
      }
      return { ...current, [key]: value };
    });
  }, []);

  return useMemo(
    () => ({
      values,
      reset: () => setValues({}),
      track: (key: string) => (percent: number) => setValue(key, { percent }),
      trackVideo: (key: string) => (value: Required<UploadProgressValue>) => setValue(key, value),
    }),
    [values, setValue]
  );
}

function slotProgress(
  key: string,
  progress: Record<string, UploadProgressValue> | undefined
): UploadProgressValue | null {
  if (!progress) return null;
  const parts = Object.entries(progress)
    .filter(([name]) => name === key || name.startsWith(`${key}:`))
    .map(([, value]) => value);
  if (parts.length === 0) return null;
  const percent = Math.round(parts.reduce((sum, part) => sum + part.percent, 0) / parts.length);
  return { percent, phase: parts[0].phase };
}

export function UploadProgressPanel({ slots, visible, progress }: UploadProgressPanelProps) {
  if (!visible) return null;

  const activeSlots = slots.filter((s) => s.status !== "skipped");
  if (activeSlots.length === 0) return null;
  const completedCount = activeSlots.filter((slot) => slot.status === "done").length;
  const uploading = activeSlots.some((slot) => slot.key !== "saving" && slot.status !== "done");

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
        const current = isActive ? slotProgress(slot.key, progress) : null;

        return (
          <div
            key={slot.key}
            className={cn(
              "grid grid-cols-[1.5rem_1fr] items-start gap-2",
              isWaiting && "opacity-70"
            )}
          >
            <div className="relative flex h-5 w-5 items-center justify-center">
              {isActive ? (
                <Loader2
                  className="h-4 w-4 animate-spin text-brand-green-700 motion-reduce:animate-none dark:text-brand-gold-300"
                  aria-hidden="true"
                />
              ) : isDone ? (
                <CheckCircle2
                  className="h-4 w-4 text-brand-green-700 dark:text-brand-gold-300"
                  aria-hidden="true"
                />
              ) : (
                <CircleDashed className="h-4 w-4 text-muted-foreground/70" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0">
              <p className={cn("font-medium leading-tight", isActive && "text-foreground")}>
                <span className="sr-only">{`Step ${index + 1}: `}</span>
                {label}
              </p>
              {isActive && (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Step {index + 1} of {activeSlots.length}
                </p>
              )}
              {current && (
                // Hidden from screen readers: a changing number would be read out
                // many times a second inside this live region.
                <div className="mt-1.5 flex items-center gap-2" aria-hidden="true">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-brand-green-700 transition-[width] duration-300 motion-reduce:transition-none dark:bg-brand-gold-300"
                      style={{ width: `${current.percent}%` }}
                      data-testid={`upload-progress-${slot.key}`}
                    />
                  </div>
                  <span className="w-24 shrink-0 text-right text-xs tabular-nums text-foreground">
                    {current.phase === "preparing"
                      ? `Converting ${current.percent}%`
                      : current.phase === "uploading"
                        ? `Uploading ${current.percent}%`
                        : `${current.percent}%`}
                  </span>
                </div>
              )}
            </div>
          </div>
        );
      })}
      {uploading && (
        <p className="text-xs text-muted-foreground">Keep this page open until it finishes.</p>
      )}
    </div>
  );
}
