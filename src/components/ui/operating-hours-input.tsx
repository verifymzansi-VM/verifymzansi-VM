"use client";

import { cn } from "@/lib/utils";
import { Label } from "@/components/ui/label";

/* ------------------------------------------------------------------ */
/*  Time-slot constants                                               */
/* ------------------------------------------------------------------ */

/** 30-minute intervals from 00:00 to 23:30 (48 slots). */
export const TIME_SLOTS: string[] = Array.from({ length: 48 }, (_, i) => {
  const h = String(Math.floor(i / 2)).padStart(2, "0");
  const m = i % 2 === 0 ? "00" : "30";
  return `${h}:${m}`;
});

/* ------------------------------------------------------------------ */
/*  Helpers shared across forms                                       */
/* ------------------------------------------------------------------ */

/** Compose a display string from structured values. */
export function formatHoursValue(open: string, close: string, closed: boolean): string {
  if (closed) return "Closed";
  if (open && close) return `${open} - ${close}`;
  return "";
}

/** Decompose a stored string into structured values (for edit-form hydration). */
export function parseHoursValue(raw: string): { open: string; close: string; closed: boolean } {
  if (!raw) return { open: "", close: "", closed: false };
  const trimmed = raw.trim();
  if (/^closed$/i.test(trimmed)) return { open: "", close: "", closed: true };

  // Match "HH:MM - HH:MM"
  const match = trimmed.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
  if (match) {
    const open = TIME_SLOTS.includes(match[1]) ? match[1] : "";
    const close = TIME_SLOTS.includes(match[2]) ? match[2] : "";
    return { open, close, closed: false };
  }

  // Unrecognised legacy freeform – fall back to empty selects
  return { open: "", close: "", closed: false };
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export interface OperatingHoursInputProps {
  id: string;
  label: string;
  open: string;
  close: string;
  closed: boolean;
  onOpenChange: (value: string) => void;
  onCloseChange: (value: string) => void;
  onClosedChange: (value: boolean) => void;
  /** Hide the "Closed" toggle (e.g. for required fields like market stall trading hours). */
  hideClosed?: boolean;
  selectClassName?: string;
}

export function OperatingHoursInput({
  id,
  label,
  open,
  close,
  closed,
  onOpenChange,
  onCloseChange,
  onClosedChange,
  hideClosed = false,
  selectClassName,
}: OperatingHoursInputProps) {
  const baseSelect = cn(
    "flex h-10 w-full rounded-md border border-input bg-background px-2 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 transition-colors duration-normal",
    selectClassName
  );

  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${id}-open`} className="text-xs text-muted-foreground">
        {label}
      </Label>

      {!hideClosed && (
        <label
          htmlFor={`${id}-closed`}
          className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer"
        >
          <input
            id={`${id}-closed`}
            type="checkbox"
            checked={closed}
            onChange={(e) => onClosedChange(e.target.checked)}
            className="rounded"
          />
          Closed
        </label>
      )}

      {!closed && (
        <div className="flex items-center gap-2">
          <select
            id={`${id}-open`}
            aria-label={`${label} opening time`}
            className={baseSelect}
            value={open}
            onChange={(e) => onOpenChange(e.target.value)}
          >
            <option value="">Open</option>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <span className="text-xs text-muted-foreground">to</span>
          <select
            id={`${id}-close`}
            aria-label={`${label} closing time`}
            className={baseSelect}
            value={close}
            onChange={(e) => onCloseChange(e.target.value)}
          >
            <option value="">Close</option>
            {TIME_SLOTS.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
