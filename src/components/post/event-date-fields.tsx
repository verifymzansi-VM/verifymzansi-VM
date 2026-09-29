"use client";
import { FieldHelp } from "./field-help";

export function EventDateFields({
  start,
  end,
  onStart,
  onEnd,
}: {
  start: string;
  end: string;
  onStart: (value: string) => void;
  onEnd: (value: string) => void;
}) {
  const inputClass = "mt-1 h-11 w-full rounded-md border bg-background px-3";
  return (
    <fieldset className="space-y-3">
      <legend className="font-medium">When is your event?</legend>
      <p className="text-sm text-muted-foreground">
        All times are South African Standard Time (SAST).
      </p>
      <FieldHelp label="event dates">
        Leave the end date blank for a single-day event. You can still give an end time on that day.
        An end time must be after the start time.
      </FieldHelp>
      <div className="grid gap-3 sm:grid-cols-2">
        <label>
          Start date (Required)
          <input
            id="start_date"
            type="date"
            className={inputClass}
            value={start.slice(0, 10)}
            onChange={(e) =>
              onStart(
                e.target.value
                  ? `${e.target.value}${start.includes("T") ? `T${start.slice(11, 16)}` : ""}`
                  : ""
              )
            }
          />
        </label>
        <label>
          Start time (Required)
          <input
            id="start_time"
            type="time"
            className={inputClass}
            value={start.slice(11, 16)}
            disabled={!start}
            onChange={(e) => onStart(`${start.slice(0, 10)}T${e.target.value}`)}
          />
        </label>
        <label>
          End date (Optional)
          <input
            id="end_date"
            type="date"
            className={inputClass}
            value={end.slice(0, 10) === start.slice(0, 10) ? "" : end.slice(0, 10)}
            onChange={(e) =>
              onEnd(
                e.target.value
                  ? `${e.target.value}${end.includes("T") ? `T${end.slice(11, 16)}` : ""}`
                  : ""
              )
            }
          />
        </label>
        <label>
          End time (Optional)
          <input
            id="end_time"
            type="time"
            className={inputClass}
            disabled={!start}
            value={end.slice(11, 16)}
            onChange={(e) =>
              onEnd(
                e.target.value
                  ? `${end.slice(0, 10) || start.slice(0, 10)}T${e.target.value}`
                  : end.slice(0, 10)
              )
            }
          />
        </label>
      </div>
    </fieldset>
  );
}
