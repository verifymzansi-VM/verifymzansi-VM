/** Interpret form dates in SAST, independently of the browser's timezone. */
export function eventTimeToIso(value: string, endOfDay = false): string {
  if (/Z$|[+-]\d\d:\d\d$/.test(value)) return new Date(value).toISOString();
  const local = value.includes("T") ? value : `${value}T${endOfDay ? "23:59" : "00:00"}`;
  return new Date(`${local.length === 16 ? `${local}:00` : local}+02:00`).toISOString();
}

export function eventTimeForInput(value: string): string {
  if (!value || !/Z$|[+-]\d\d:\d\d$/.test(value)) return value;
  return new Date(new Date(value).getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 16);
}
