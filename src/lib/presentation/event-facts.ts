import { EVENT_AGE_RESTRICTIONS, EVENT_TYPES } from "@/lib/constants/categories";
import { humanizeKey } from "@/lib/presentation/listing-facts";
import { formatSaLongDate } from "@/lib/utils/format";

export type EventState = "upcoming" | "ongoing" | "ended";

export function getEventState(
  startDate: string | null,
  endDate: string | null,
  nowMs: number
): EventState {
  const startsAt = startDate ? new Date(startDate).getTime() : null;
  const endsAt = endDate ? new Date(endDate).getTime() : null;

  if (startsAt != null && startsAt > nowMs) return "upcoming";
  if (endsAt != null && endsAt < nowMs) return "ended";
  return "ongoing";
}

export const EVENT_RECURRING_LABELS: Record<string, string> = {
  one_off: "One-off",
  weekly: "Weekly",
  monthly: "Monthly",
  annual: "Annual",
};

export const EVENT_RAIN_POLICY_LABELS: Record<string, string> = {
  outdoor_rain_or_shine: "Outdoor — rain or shine",
  moved_indoors: "Moved indoors",
  postponed: "Postponed",
  refunded: "Refunded",
};

/** Early-bird deadlines are free text; show a real date consistently when we can parse one. */
export function formatLooseDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}/.test(value) ? formatSaLongDate(value) || value : value;
}

export function getEventTypeLabel(eventType: string | null | undefined) {
  if (!eventType) return null;
  return EVENT_TYPES.find((type) => type.value === eventType)?.label ?? humanizeKey(eventType);
}

export function getEventAgeLabel(ageRestriction: string | null | undefined) {
  if (!ageRestriction) return null;
  return (
    EVENT_AGE_RESTRICTIONS.find((age) => age.value === ageRestriction)?.label ??
    humanizeKey(ageRestriction)
  );
}

/** Google Calendar wants UTC "20261001T100000Z"; timestamptz strings carry "+00:00". */
function toGoogleCalendarDate(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
}

export function buildEventCalendarUrl(event: {
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  venueName?: string | null;
  location: Array<string | null | undefined>;
}): string | null {
  const calendarStart = event.start_date ? toGoogleCalendarDate(event.start_date) : null;
  if (!calendarStart) return null;
  const calendarEnd = event.end_date ? toGoogleCalendarDate(event.end_date) : null;
  const location = [event.venueName, ...event.location].filter(Boolean).join(", ");
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(event.title)}&dates=${calendarStart}/${calendarEnd ?? calendarStart}&details=${encodeURIComponent(event.description?.slice(0, 500) ?? "")}&location=${encodeURIComponent(location)}`;
}

const SA_DAY_PARTS = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "Sat 31 Oct": built from parts so locale punctuation never doubles up commas. */
function saDay(date: Date) {
  const parts = SA_DAY_PARTS.formatToParts(date);
  const read = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${read("weekday")} ${Number(read("day"))} ${read("month")}`;
}
const SA_TIME = new Intl.DateTimeFormat("en-ZA", {
  timeZone: "Africa/Johannesburg",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

function validDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * "Sat 31 Oct, 18:00 – 23:00" or "Sat 31 Oct, 18:00 – Sun 1 Nov, 02:00", in
 * South African time. Midnight is treated as "no time given" (date-only posts).
 */
export function formatEventWhen(start: string | null, end: string | null): string | null {
  const startDate = validDate(start);
  if (!startDate) return null;
  const endDate = validDate(end);
  const time = (date: Date) => {
    const text = SA_TIME.format(date);
    return text === "00:00" ? null : text;
  };
  const startDay = saDay(startDate);
  const startTime = time(startDate);
  const head = startTime ? `${startDay}, ${startTime}` : startDay;
  if (!endDate || endDate.getTime() <= startDate.getTime()) return head;
  const endDay = saDay(endDate);
  const endTime = time(endDate);
  if (endDay === startDay) return endTime ? `${head} – ${endTime}` : head;
  return `${head} – ${endTime ? `${endDay}, ${endTime}` : endDay}`;
}
