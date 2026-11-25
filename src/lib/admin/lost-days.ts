/**
 * What the staff "Add lost days" panel on Payments & refunds shows (database
 * update 20261125113433_add_lost_days.sql). Safe in client components: no
 * locale or time-zone APIs, so the server and the browser agree.
 *
 * The posting terms promise that when we fail to provide what a member paid
 * for, we first add the days they lost. Staff add 1 to 30 days at a time to
 * every running paid Individual slot and Multi-listing package of one member;
 * a slot's queued renewal moves with it and a package's slots still end
 * together. An ended slot gets a refund instead.
 */

/** The bounds the database enforces (internal.add_lost_days). */
export const LOST_DAYS = { min: 1, max: 30 } as const;
export const LOST_DAYS_REASON = { min: 5, max: 500 } as const;

/** One running paid term of the member, as the preview lists it. */
export interface LostDaysTerm {
  kind: "individual" | "package";
  /** The slot's first grant, or the package. */
  id: string;
  slots: number;
  /** Renewals queued after the running period (an Individual slot only). */
  renewals: number;
  endsAt: string;
}

/** One term as the command moved it. */
export interface LostDaysMove {
  kind: "individual" | "package";
  id: string;
  slots: number;
  renewals: number;
  endsBefore: string;
  endsAfter: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** The end a term gets when `days` are added (the database adds whole days). */
export function endAfterDays(endsAt: string, days: number): string {
  const time = new Date(endsAt).getTime();
  return Number.isNaN(time) ? "" : new Date(time + days * DAY_MS).toISOString();
}

/** "Individual slot", "Package of 12 slots", with a queued renewal noted. */
export function lostDaysTermLabel(term: {
  kind: "individual" | "package";
  slots: number;
  renewals: number;
}): string {
  if (term.kind === "package") return `Package of ${term.slots} slots`;
  const name = term.slots === 1 ? "Individual slot" : `Individual plan of ${term.slots} slots`;
  if (term.renewals === 0) return name;
  return `${name} (${term.renewals === 1 ? "renewal" : `${term.renewals} renewals`} queued)`;
}

/** The days a form may be sent with, or null. */
export function lostDaysValue(value: string): number | null {
  const days = Number(value);
  return Number.isInteger(days) && days >= LOST_DAYS.min && days <= LOST_DAYS.max ? days : null;
}

/** The reason a form may be sent with (the database rechecks it). */
export function lostDaysReasonValid(value: string): boolean {
  const reason = value.trim();
  return (
    reason.length >= LOST_DAYS_REASON.min &&
    reason.length <= LOST_DAYS_REASON.max &&
    !reason.includes("\n")
  );
}
