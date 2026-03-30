/**
 * Shared date defaults for promotion/event forms.
 */

function toDateInputValue(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function addDaysToDateInput(dateInput: string, days: number): string {
  const base = new Date(`${dateInput}T00:00:00`);
  base.setDate(base.getDate() + days);
  return toDateInputValue(base);
}

export function getDefaultEventDates(
  startDate: string,
  endDate: string,
  now: Date = new Date()
): { startDate: string; endDate: string } {
  const nextStartDate = startDate || toDateInputValue(now);
  const nextEndDate = endDate || addDaysToDateInput(nextStartDate, 7);
  return { startDate: nextStartDate, endDate: nextEndDate };
}
