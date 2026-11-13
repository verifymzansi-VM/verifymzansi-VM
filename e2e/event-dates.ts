/**
 * A date input value (YYYY-MM-DD) a number of days from today. Events may be
 * posted at most 12 months ahead, so fixtures use a near-future date.
 */
export function eventDateInput(daysAhead = 30): string {
  const date = new Date(Date.now() + daysAhead * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}
