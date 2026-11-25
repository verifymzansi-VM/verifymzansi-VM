/**
 * What the "ID checks" card on Verify accounts shows (Didit plan, section 6,
 * pictures 09 and 10) and what the case view says about a member's automatic
 * check. Safe in client components: no locale or time-zone APIs. Staff screens
 * may name Didit.
 */

export type IdentityCheckMode = "manual" | "staff_final" | "automatic";
export type IdentityCheckPauseReason = "no_credit" | "outage" | "not_configured";

/** api.get_identity_check_settings(), as the website passes it on. */
export interface IdentityCheckSettings {
  mode: IdentityCheckMode;
  pausedUntil: string | null;
  pauseReason: IdentityCheckPauseReason | null;
  last7Days: {
    checks: number;
    approved: number;
    withStaff: number;
    declined: number;
    askedPerson: number;
  };
  /** The latest 5 changes of mode, newest first. */
  recentChanges: Array<{
    fromMode: IdentityCheckMode;
    toMode: IdentityCheckMode;
    reason: string;
    changedAt: string;
  }>;
}

export const IDENTITY_CHECK_MODES: ReadonlyArray<{
  mode: IdentityCheckMode;
  title: string;
  lines: string[];
}> = [
  {
    mode: "manual",
    title: "Manual",
    lines: ["Members take photos with the in-page camera. Staff decide every case."],
  },
  {
    mode: "staff_final",
    title: "Didit, staff have the final say",
    lines: [
      "Didit approves clear cases at once.",
      "Anything unclear or declined comes to this queue.",
    ],
  },
  {
    mode: "automatic",
    title: "Didit fully automatic",
    lines: [
      "Didit approves and declines. No staff input.",
      "A declined member can ask a person to look again.",
    ],
  },
];

export const IDENTITY_CHECK_PAUSE_TEXT: Record<
  IdentityCheckPauseReason,
  { why: string; next: string }
> = {
  no_credit: {
    why: "the Didit balance has run out",
    next: "Top up in the Didit console, then resume.",
  },
  not_configured: {
    why: "Didit refused our settings",
    next: "Check the Didit Worker settings, then resume.",
  },
  outage: {
    why: "Didit did not answer",
    next: "Checks resume by themselves when the pause ends, or resume now.",
  },
};

/**
 * The Didit settings wait until the database records each member's consent
 * before a check starts (item 61, part 7a; TODO(61 part 7a): remove then).
 * The card shows them, disabled, and the route refuses them.
 */
export const IDENTITY_CHECK_DIDIT_MODES_READY = false;
export const IDENTITY_CHECK_DIDIT_MODES_WAITING =
  "The two Didit settings switch on once consent recording is live.";

/** The bounds the database enforces (internal.set_identity_check_mode). */
export const IDENTITY_CHECK_REASON = { min: 5, max: 500 } as const;

export function identityCheckReasonValid(value: string): boolean {
  const reason = value.trim();
  return (
    reason.length >= IDENTITY_CHECK_REASON.min &&
    reason.length <= IDENTITY_CHECK_REASON.max &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069\ufeff]/.test(reason)
  );
}

/** "Last 7 days: 42 Didit checks · 36 approved · 6 sent to staff". */
export function identityCheckCountsLine(counts: IdentityCheckSettings["last7Days"]): string {
  const parts = [
    `${counts.checks} Didit ${counts.checks === 1 ? "check" : "checks"}`,
    `${counts.approved} approved`,
    `${counts.withStaff} sent to staff`,
  ];
  if (counts.declined > 0) parts.push(`${counts.declined} declined`);
  if (counts.askedPerson > 0) parts.push(`${counts.askedPerson} asked a person`);
  return `Last 7 days: ${parts.join(" · ")}`;
}

export const IDENTITY_CHECK_MODE_NAMES: Record<IdentityCheckMode, string> = {
  manual: "Manual",
  staff_final: "Didit, staff final say",
  automatic: "Didit fully automatic",
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "20 Nov 2026, 14:02", in South African time; empty when unreadable. */
export function formatSastDateTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const sast = new Date(time + 2 * 60 * 60 * 1000);
  return `${sast.getUTCDate()} ${MONTHS[sast.getUTCMonth()]} ${sast.getUTCFullYear()}, ${formatSastTime(value)}`;
}

/** "14:02", in South African time; empty for an unreadable time. */
export function formatSastTime(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const sast = new Date(time + 2 * 60 * 60 * 1000);
  return `${String(sast.getUTCHours()).padStart(2, "0")}:${String(sast.getUTCMinutes()).padStart(2, "0")}`;
}

/* ── The case view ────────────────────────────────────────────────────── */

/** api.get_identity_check_for_case(), the latest check of the open case. */
export interface IdentityCheckForCase {
  status: "started" | "unavailable" | "not_finished" | "approved" | "with_staff" | "declined";
  reasons: string[];
  createdAt: string;
  finishedAt: string | null;
  declinedAt: string | null;
  askedAt: string | null;
  askReason: string | null;
}

export const IDENTITY_CHECK_STATUS_LABELS: Record<IdentityCheckForCase["status"], string> = {
  started: "Didit check not finished yet",
  unavailable: "Didit check could not start",
  not_finished: "Didit check not finished",
  approved: "Didit approved",
  with_staff: "Didit sent to staff",
  declined: "Didit declined",
};

/** Why a check did not pass, for staff (the member never sees these). */
export const IDENTITY_CHECK_REASON_LABELS: Record<string, string> = {
  provider_declined: "Didit declined the ID or the selfie",
  provider_in_review: "Didit was unsure",
  names_differ: "Names typed differ from the names on the ID",
  document_not_accepted: "Document not accepted (not an SA ID card, ID book or certificate)",
  id_number_invalid: "ID number missing or invalid",
  under_18: "Under 18 on the ID",
  session_moved: "Check finished on another network or device than it started",
  banned: "ID number or phone is banned",
  duplicate: "ID number verified on another account",
  high_risk: "Risk score above 50",
};
