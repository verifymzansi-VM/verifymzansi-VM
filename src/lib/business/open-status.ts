/**
 * Live "Open now" status from the free-text opening hours owners enter
 * (Mon_Fri / Sat / Sun, e.g. "08:00-17:00", "8am - 1pm, 2pm - 5pm", "Closed").
 * Always evaluated in South African time. Text we cannot read never claims
 * the business is open.
 */

export interface OpeningHoursInput {
  Mon_Fri?: string | null;
  Sat?: string | null;
  Sun?: string | null;
}

export type OpenState = "open" | "closed" | "appointment" | "unknown";

export interface OpenStatus {
  state: OpenState;
  label: string;
}

const DAY_MINUTES = 24 * 60;
const TIME_ZONE = "Africa/Johannesburg";
const RANGE_PATTERN =
  /(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to|until)\s*(\d{1,2})(?:[:h.](\d{2}))?\s*(am|pm)?/gi;

type DayKey = keyof OpeningHoursInput;

function dayKey(weekday: number): DayKey {
  if (weekday === 0) return "Sun";
  if (weekday === 6) return "Sat";
  return "Mon_Fri";
}

function toMinutes(hourText: string, minuteText: string | undefined, meridiem: string | undefined) {
  let hour = Number(hourText);
  const minute = minuteText ? Number(minuteText) : 0;
  if (!Number.isInteger(hour) || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const pm = meridiem.toLowerCase() === "pm";
    if (hour === 12) hour = pm ? 12 : 0;
    else if (pm) hour += 12;
  }
  if (hour > 24 || (hour === 24 && minute > 0)) return null;
  return hour * 60 + minute;
}

interface Interval {
  start: number;
  end: number;
}

/** Ranges in a day's text; an end at or before the start runs past midnight. */
export function parseIntervals(text: string): Interval[] {
  const intervals: Interval[] = [];
  for (const match of text.matchAll(RANGE_PATTERN)) {
    const [, startHour, startMinute, startMeridiem, endHour, endMinute, endMeridiem] = match;
    const end = toMinutes(endHour, endMinute, endMeridiem);
    // "1 - 5pm" borrows the end's pm; "8 - 5pm" cannot, so 8 stays a morning hour.
    let start = toMinutes(startHour, startMinute, startMeridiem ?? endMeridiem);
    if (!startMeridiem && endMeridiem && (start == null || end == null || start >= end)) {
      start = toMinutes(startHour, startMinute, undefined);
    }
    if (start == null || end == null) continue;
    intervals.push({ start, end: end <= start ? end + DAY_MINUTES : end });
  }
  return intervals;
}

function formatClock(minutes: number) {
  const normalized = ((minutes % DAY_MINUTES) + DAY_MINUTES) % DAY_MINUTES;
  const hour = Math.floor(normalized / 60);
  const minute = normalized % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function southAfricanClock(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(read("weekday"));
  return { weekday, minutes: Number(read("hour")) * 60 + Number(read("minute")) };
}

/**
 * The form offers 30-minute slots and no "24 hours" choice, so owners who never
 * close pick the same opening and closing time ("00:00 - 00:00"). Say what they meant.
 */
export function displayHoursText(text: string): string {
  const match = text.trim().match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
  return match && match[1] === match[2] ? "Open 24 hours" : text;
}

function classify(text: string | null | undefined) {
  const value = displayHoursText(text ?? "")
    .trim()
    .toLowerCase();
  if (!value) return { kind: "missing" as const, intervals: [] };
  if (/\b24\s*(hours|hrs|h|\/7)\b/.test(value)) {
    return { kind: "always" as const, intervals: [{ start: 0, end: DAY_MINUTES }] };
  }
  const intervals = parseIntervals(value);
  if (intervals.length > 0) return { kind: "hours" as const, intervals };
  if (/\bclosed\b/.test(value)) return { kind: "closed" as const, intervals: [] };
  if (/appointment|by booking|on request/.test(value)) {
    return { kind: "appointment" as const, intervals: [] };
  }
  return { kind: "unknown" as const, intervals: [] };
}

export function getOpenStatus(
  hours: OpeningHoursInput | null | undefined,
  now: Date = new Date()
): OpenStatus {
  if (!hours) return { state: "unknown", label: "" };
  const { weekday, minutes } = southAfricanClock(now);
  if (weekday < 0) return { state: "unknown", label: "" };

  // Last night's late hours can still be running after midnight.
  const yesterday = classify(hours[dayKey((weekday + 6) % 7)]);
  const spill = yesterday.intervals.find(
    (interval) => interval.end > DAY_MINUTES && minutes + DAY_MINUTES < interval.end
  );
  if (spill && yesterday.kind === "hours") {
    return { state: "open", label: `Open now, closes ${formatClock(spill.end)}` };
  }

  const today = classify(hours[dayKey(weekday)]);
  switch (today.kind) {
    case "always":
      return { state: "open", label: "Open 24 hours" };
    case "closed":
      return { state: "closed", label: "Closed today" };
    case "appointment":
      return { state: "appointment", label: "By appointment" };
    case "missing":
    case "unknown":
      return { state: "unknown", label: "" };
    case "hours": {
      const current = today.intervals.find(
        (interval) => minutes >= interval.start && minutes < interval.end
      );
      if (current) {
        return { state: "open", label: `Open now, closes ${formatClock(current.end)}` };
      }
      const next = today.intervals
        .filter((interval) => interval.start > minutes)
        .sort((a, b) => a.start - b.start)[0];
      return next
        ? { state: "closed", label: `Closed, opens ${formatClock(next.start)}` }
        : { state: "closed", label: "Closed now" };
    }
  }
}
