"use client";

import { useCallback, useMemo, useRef, useState } from "react";
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
   * Progress by slot key (the hook already combines a slot's requests). Raw
   * sub-keys ("photos:cover") are averaged when no slot value is given.
   */
  progress?: Record<string, UploadProgressValue>;
}

interface ProgressPart {
  percent: number;
  phase?: "preparing" | "uploading";
}

interface ProgressState {
  parts: Record<string, ProgressPart>;
  shown: Record<string, UploadProgressValue>;
}

const EMPTY_STATE: ProgressState = { parts: {}, shown: {} };

/**
 * One value per slot. With known byte sizes it is bytes sent over the bytes of
 * every file queued for the slot (so a small cover cannot show 100% while the
 * gallery waits); without sizes it is the plain average. It never goes back
 * within a phase, so a retry that restarts a request does not move the bar.
 */
function computeShown(
  state: ProgressState,
  weights: Record<string, number>
): Record<string, UploadProgressValue> {
  const slots = new Set<string>();
  for (const name of [...Object.keys(state.parts), ...Object.keys(weights)]) {
    slots.add(name.split(":")[0]);
  }
  const shown: Record<string, UploadProgressValue> = {};
  for (const slot of slots) {
    const inSlot = (name: string) => name === slot || name.startsWith(`${slot}:`);
    const reported = Object.entries(state.parts).filter(([name]) => inSlot(name));
    if (reported.length === 0) continue;
    const queued = Object.entries(weights).filter(([name]) => inSlot(name));
    const totalBytes = queued.reduce((sum, [, bytes]) => sum + bytes, 0);
    let percent: number;
    if (totalBytes > 0) {
      const sent = queued.reduce(
        (sum, [name, bytes]) => sum + (bytes * (state.parts[name]?.percent ?? 0)) / 100,
        0
      );
      percent = (sent / totalBytes) * 100;
    } else {
      percent = reported.reduce((sum, [, part]) => sum + part.percent, 0) / reported.length;
    }
    percent = Math.min(100, Math.round(percent));
    const phase = reported.some(([, part]) => part.phase === "preparing")
      ? "preparing"
      : reported[0][1].phase;
    const previous = state.shown[slot];
    if (previous && previous.phase === phase && previous.percent > percent) {
      percent = previous.percent;
    }
    shown[slot] = { percent, phase };
  }
  return shown;
}

/**
 * Progress state for the panel. Callbacks skip unchanged values to limit re-renders.
 * Pass the files of a request to track()/trackVideo() so the slot's bar is
 * weighted by bytes; call them before the uploads start.
 */
export function useUploadProgress() {
  const [state, setState] = useState<ProgressState>(EMPTY_STATE);
  const weights = useRef<Record<string, number>>({});

  const setPart = useCallback((key: string, part: ProgressPart) => {
    setState((current) => {
      const previous = current.parts[key];
      if (previous && previous.percent === part.percent && previous.phase === part.phase) {
        return current;
      }
      const next = { ...current, parts: { ...current.parts, [key]: part } };
      next.shown = computeShown(next, weights.current);
      return next;
    });
  }, []);

  return useMemo(
    () => ({
      values: state.shown,
      reset: () => {
        weights.current = {};
        setState(EMPTY_STATE);
      },
      track: (key: string, files?: File[]) => {
        if (files) weights.current[key] = files.reduce((sum, file) => sum + file.size, 0);
        return (percent: number) => setPart(key, { percent });
      },
      /** Several videos share one slot; each reports with its own file. */
      trackVideo: (key: string, files?: File[]) => {
        files?.forEach((file, index) => {
          weights.current[`${key}:${index}`] = file.size;
        });
        return (
          value: Required<Pick<UploadProgressValue, "percent" | "phase">> & { file?: File }
        ) => {
          const index = files && value.file ? files.indexOf(value.file) : -1;
          setPart(index >= 0 ? `${key}:${index}` : key, {
            percent: value.percent,
            phase: value.phase,
          });
        };
      },
    }),
    [state.shown, setPart]
  );
}

function slotProgress(
  key: string,
  progress: Record<string, UploadProgressValue> | undefined
): UploadProgressValue | null {
  if (!progress) return null;
  if (progress[key]) return progress[key];
  const parts = Object.entries(progress)
    .filter(([name]) => name.startsWith(`${key}:`))
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
                        ? // Only a video has an uploading phase; at 100% the server is still checking it.
                          current.percent >= 100
                          ? "Checking video…"
                          : `Uploading ${current.percent}%`
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
