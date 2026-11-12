// Fields a restored screen's data shape still carries but the live backend
// cannot provide on that path. The screen keeps receiving the placeholder it
// has always tolerated (null, false, 0, an empty list or a fixed word), so
// nothing people see changes. What changes is that the gap is declared, with
// its reason, next to the adapter that fills it: the screen contract tests
// (src/test/contracts/screen-data.ts, run on canned data and in the live
// backend lane) read these declarations, so a field an adapter blanks without
// declaring it fails a test instead of disappearing silently.

/** A value a screen already tolerates in place of a missing fact. */
export type Placeholder = null | boolean | number | string | readonly never[];

export type NotAvailableField<V extends Placeholder = Placeholder> = {
  readonly placeholder: V;
  /** Why the live backend cannot provide it here (for tests and reviews). */
  readonly reason: string;
};

/** One field the live backend cannot provide, with the placeholder sent instead. */
export function notAvailable<const V extends Placeholder>(
  placeholder: V,
  reason: string
): NotAvailableField<V> {
  return Object.freeze({ placeholder, reason });
}

type Fresh<V> = V extends readonly never[] ? never[] : V;
export type NotAvailableFields = Readonly<Record<string, NotAvailableField>>;
export type NotAvailableSet<T extends NotAvailableFields = NotAvailableFields> = {
  /** The declarations, for tests. */
  readonly fields: T;
  /** Fresh placeholder values for a row (lists are new each call). */
  values(): { [K in keyof T]: Fresh<T[K]["placeholder"]> };
};

/** Declares the fields one screen shape cannot get from the live backend. */
export function declareNotAvailable<const T extends NotAvailableFields>(
  fields: T
): NotAvailableSet<T> {
  const frozen = Object.freeze({ ...fields });
  return Object.freeze({
    fields: frozen,
    values() {
      return Object.fromEntries(
        Object.entries(frozen).map(([key, field]) => [
          key,
          Array.isArray(field.placeholder) ? [] : field.placeholder,
        ])
      ) as { [K in keyof T]: Fresh<T[K]["placeholder"]> };
    },
  });
}
