import { z } from "zod";

/**
 * What the ID step of Get verified shows (Didit plan, section 3), worked out
 * from GET /api/verification/identity-check. Safe in client components.
 *
 * The staff setting decides the route. On "manual" (the starting value) the
 * database answers route "manual" with reason "mode" and the step stays the
 * camera route members see today. A pause or the spending limit also answers
 * "manual" (reason "paused" or "limit"): the camera route, with one line
 * saying the automatic check isn't available right now (picture 08).
 */
const check = z
  .object({
    id: z.string(),
    status: z.string(),
    session_url: z.string().nullable().optional(),
    ask_person_until: z.string().nullable().optional(),
    decline_reason: z.string().nullable().optional(),
    can_ask_person: z.boolean().optional(),
    asked_at: z.string().nullable().optional(),
    with_person: z.boolean().optional(),
  })
  .passthrough();

export const identityCheckAvailabilitySchema = z
  .object({
    route: z.enum(["manual", "automatic"]),
    reason: z.string().nullable().optional(),
    check: check.nullable().optional(),
  })
  .passthrough();
export type IdentityCheckAvailability = z.infer<typeof identityCheckAvailabilitySchema>;

/** Why an automatic check declined, in the member's words (the database
 * never names a ban, a duplicate or a risk score). */
export type DeclineReason =
  "id_unreadable" | "names_differ" | "under_18" | "photo_not_matched" | "not_confirmed";

export type IdentityCheckView =
  /** Today's camera route; `fallback` adds the picture 08 line. */
  | { kind: "manual"; fallback: boolean }
  /** Picture 02: what the check asks, the consent tick, Start ID check. */
  | { kind: "start" }
  /** Picture 02b: the check inside the page. */
  | { kind: "frame"; url: string }
  /** Picture 03: the photos are in, the result is on its way. */
  | { kind: "checking" }
  /** Picture 04. */
  | { kind: "approved" }
  /** Picture 05: a person looks (staff final say, or the member asked). */
  | { kind: "with_staff" }
  /** Picture 06: fully automatic decline. */
  | {
      kind: "declined";
      checkId: string;
      reason: DeclineReason;
      canRetry: boolean;
      canAsk: boolean;
      askBy: string | null;
    };

const DECLINE_REASONS: readonly DeclineReason[] = [
  "id_unreadable",
  "names_differ",
  "under_18",
  "photo_not_matched",
  "not_confirmed",
];

export function identityCheckView(
  availability: IdentityCheckAvailability | null,
  {
    finished = false,
    tryAgain = false,
    idStepSettled = false,
  }: {
    /** The frame said the member finished (a hint: the server has the result). */
    finished?: boolean;
    /** The member chose "Try the ID check again" after a decline. */
    tryAgain?: boolean;
    /** The steps, read again after this check's result, show the ID step
     * no longer waits for staff (sent back, rejected, or no entry): a check
     * that went to staff is then settled. Until that read succeeds, the
     * check counts as with staff, so no second check can start meanwhile. */
    idStepSettled?: boolean;
  } = {}
): IdentityCheckView {
  if (!availability) return { kind: "manual", fallback: false };
  const automatic = availability.route === "automatic";
  const latest = availability.check ?? null;
  if (latest?.status === "started" && latest.session_url)
    return finished ? { kind: "checking" } : { kind: "frame", url: latest.session_url };
  if (latest?.status === "approved") return { kind: "approved" };
  // A person is still to decide: the member asked, or (staff final say) the
  // check went to staff and the steps do not show it settled.
  if (latest?.with_person || (latest?.status === "with_staff" && !idStepSettled))
    return { kind: "with_staff" };
  if (latest?.status === "declined" && !latest.asked_at && !tryAgain) {
    const canAsk = latest.can_ask_person === true;
    if (automatic || canAsk)
      return {
        kind: "declined",
        checkId: latest.id,
        reason:
          DECLINE_REASONS.find((reason) => reason === latest.decline_reason) ?? "not_confirmed",
        canRetry: automatic,
        canAsk,
        askBy: canAsk ? (latest.ask_person_until ?? null) : null,
      };
  }
  if (automatic) return { kind: "start" };
  return {
    kind: "manual",
    fallback: availability.reason === "paused" || availability.reason === "limit",
  };
}

/** True while the page should ask again for the result. */
export function identityCheckWaiting(view: IdentityCheckView | null) {
  return view?.kind === "frame" || view?.kind === "checking";
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "25 November", in South African time; empty for an unreadable date. */
export function formatAskByDate(value: string | null): string {
  const time = value ? Date.parse(value) : NaN;
  if (Number.isNaN(time)) return "";
  const sast = new Date(time + 2 * 60 * 60 * 1000);
  return `${sast.getUTCDate()} ${MONTHS[sast.getUTCMonth()]}`;
}

/** How often the page asks for the result while it waits: 4 times a minute,
 * well under the 30 a minute the status routes allow. */
export const IDENTITY_CHECK_POLL_MS = 15_000;
