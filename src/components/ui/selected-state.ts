/**
 * The owner's rule (20 November 2026, ledger group 66): no black on buttons
 * or chips. A selected chip, tab or small action uses a light version of the
 * Tourism & Events teal instead. Teal 800 on teal 50 is about 7.3:1 (6.7:1 on
 * the teal 100 hover); teal 200 on the dark page is above 12:1.
 */
export const lightTealSelectedClassName =
  "border-transparent bg-teal-50 text-teal-800 ring-1 ring-teal-500/40 dark:bg-teal-950/40 dark:text-teal-200";

/** Hover for a light teal action (a button, not a selected state). */
export const lightTealHoverClassName = "hover:bg-teal-100 dark:hover:bg-teal-950/60";
