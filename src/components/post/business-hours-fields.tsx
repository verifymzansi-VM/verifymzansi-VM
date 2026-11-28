"use client";

import { Input } from "@/components/ui/input";
import {
  BUSINESS_HOURS_GROUPS,
  type BusinessHours,
  type DayHours,
} from "@/lib/forms/business-form";

function Check({
  id,
  label,
  checked,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label
      htmlFor={id}
      className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-input bg-card px-3 text-sm"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="h-4 w-4 rounded accent-brand-green-600"
      />
      {label}
    </label>
  );
}

/**
 * Opening hours with the phone's own time picker: open and close per group,
 * a Closed tick, plus "Open 24 hours" and "By appointment".
 */
export function BusinessHoursFields({
  value,
  onChange,
}: {
  value: BusinessHours;
  onChange: (next: BusinessHours) => void;
}) {
  const setDay = (key: (typeof BUSINESS_HOURS_GROUPS)[number]["key"], patch: Partial<DayHours>) =>
    onChange({ ...value, [key]: { ...value[key], ...patch } });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Check
          id="hours-open-24"
          label="Open 24 hours"
          checked={value.open24}
          onChange={(open24) => onChange({ ...value, open24 })}
        />
        <Check
          id="hours-by-appointment"
          label="By appointment"
          checked={value.byAppointment}
          onChange={(byAppointment) => onChange({ ...value, byAppointment })}
        />
      </div>
      {value.open24 ? null : (
        <ul className="divide-y divide-border/70 rounded-2xl border border-border">
          {BUSINESS_HOURS_GROUPS.map(({ key, label }) => {
            const day = value[key];
            const id = `hours-${key}`;
            return (
              <li
                key={key}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:grid-cols-[8rem_1fr_1fr_auto]"
              >
                <p className="text-sm font-medium text-foreground">{label}</p>
                <label
                  htmlFor={`${id}-open`}
                  className="order-last col-span-2 flex items-center gap-2 text-xs text-muted-foreground sm:order-none sm:col-span-1"
                >
                  Opens
                  <Input
                    id={`${id}-open`}
                    type="time"
                    step={300}
                    aria-label={`${label} opens`}
                    value={day.open}
                    disabled={day.closed}
                    onChange={(event) => setDay(key, { open: event.target.value })}
                  />
                </label>
                <label
                  htmlFor={`${id}-close`}
                  className="order-last col-span-2 flex items-center gap-2 text-xs text-muted-foreground sm:order-none sm:col-span-1"
                >
                  Closes
                  <Input
                    id={`${id}-close`}
                    type="time"
                    step={300}
                    aria-label={`${label} closes`}
                    value={day.close}
                    disabled={day.closed}
                    onChange={(event) => setDay(key, { close: event.target.value })}
                  />
                </label>
                <label className="flex min-h-11 items-center justify-end gap-2 text-sm">
                  <input
                    type="checkbox"
                    aria-label={`${label} closed`}
                    checked={day.closed}
                    onChange={(event) => setDay(key, { closed: event.target.checked })}
                    className="h-4 w-4 rounded accent-brand-green-600"
                  />
                  Closed
                </label>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
