"use client";

import { CheckCircle2, Loader2 } from "lucide-react";

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

  const activeSlots = slots.filter((s) => s.status === "uploading" || s.status === "done");
  if (activeSlots.length === 0) return null;

  return (
    <div className="space-y-1.5 border-t pt-3 text-sm text-muted-foreground">
      {activeSlots.map((slot) => (
        <div key={slot.key} className="flex items-center gap-2">
          {slot.status === "uploading" ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-brand-green" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-brand-green" />
          )}
          {slot.status === "done" ? slot.doneLabel : slot.label}
        </div>
      ))}
    </div>
  );
}
