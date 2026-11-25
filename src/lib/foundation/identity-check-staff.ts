import "server-only";
import { z } from "zod";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import { hasDatabaseMessage, isStaffSecondFactorRefusal } from "./error-reasons";
import type { FoundationRefusal } from "./owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "./staff-command";
import {
  IDENTITY_CHECK_REASON,
  type IdentityCheckForCase,
  type IdentityCheckSettings,
} from "@/lib/admin/identity-check-settings";

/**
 * Staff side of the automatic ID checks (Didit plan, section 6). Reading the
 * setting runs through internal.staff_actor('queue:view'); changing it through
 * 'identity_check:configure': admins with an authenticator code from the last
 * 15 minutes and a reason, logged in private.identity_check_mode_events.
 */

const mode = z.enum(["manual", "staff_final", "automatic"]);
const count = z.number().int().nonnegative();
const timestamp = z.iso.datetime({ offset: true });

const settingsResult = z.object({
  mode,
  paused_until: timestamp.nullable(),
  pause_reason: z.enum(["no_credit", "outage", "not_configured"]).nullable(),
  last_7_days: z.object({
    checks: count,
    approved: count,
    with_staff: count,
    declined: count,
    asked_person: count,
  }),
  recent_changes: z
    .array(
      z.object({
        from_mode: mode,
        to_mode: mode,
        reason: z.string().max(500),
        changed_at: timestamp,
      })
    )
    .max(5),
});

const caseResult = z.object({
  check: z
    .object({
      status: z.enum([
        "started",
        "unavailable",
        "not_finished",
        "approved",
        "with_staff",
        "declined",
      ]),
      reasons: z.array(z.string().max(40)).max(20),
      created_at: timestamp,
      finished_at: timestamp.nullable(),
      declined_at: timestamp.nullable(),
      asked_at: timestamp.nullable(),
      ask_reason: z.string().max(2000).nullable(),
    })
    .nullable(),
});

type DatabaseError = { code?: string; message?: string; details?: string | null };

class IdentityCheckSettingRefused extends Error {
  override name = "IdentityCheckSettingRefused";
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string
  ) {
    super(message);
  }
}

function refuse(error: DatabaseError): never {
  if (error.code === "42501") {
    if (isStaffSecondFactorRefusal(error))
      throw new FoundationStaffCommandError(
        403,
        "Verify your authenticator again, then try again.",
        true
      );
    if (hasDatabaseMessage(error, "capabilityNotGranted"))
      throw new IdentityCheckSettingRefused(
        403,
        "identity_check_not_allowed",
        "Only admins can change where ID checks go."
      );
    throw new FoundationStaffCommandError(
      403,
      "Your staff access changed. Reload the page before continuing."
    );
  }
  if (error.code === "22023")
    throw new IdentityCheckSettingRefused(
      422,
      "identity_check_reason_required",
      `Write a reason of ${IDENTITY_CHECK_REASON.min} to ${IDENTITY_CHECK_REASON.max} characters.`
    );
  throw Object.assign(new Error("Identity check setting command failed"), { cause: error });
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const parsed = schema.safeParse(data);
  if (!parsed.success) throw new Error("Identity check answer could not be confirmed");
  return parsed.data;
}

/** The setting, the current pause and the last 7 days' counts. */
export async function readIdentityCheckSettings(
  api: FoundationAuthenticatedApi
): Promise<IdentityCheckSettings> {
  const { data, error } = await api.rpc("get_identity_check_settings", {}, { get: false });
  if (error) refuse(error);
  const result = parse(settingsResult, data);
  return {
    mode: result.mode,
    pausedUntil: result.paused_until,
    pauseReason: result.pause_reason,
    last7Days: {
      checks: result.last_7_days.checks,
      approved: result.last_7_days.approved,
      withStaff: result.last_7_days.with_staff,
      declined: result.last_7_days.declined,
      askedPerson: result.last_7_days.asked_person,
    },
    recentChanges: result.recent_changes.map((change) => ({
      fromMode: change.from_mode,
      toMode: change.to_mode,
      reason: change.reason,
      changedAt: change.changed_at,
    })),
  };
}

export const identityCheckModeRequest = z.strictObject({
  mode,
  reason: z.string().trim().min(IDENTITY_CHECK_REASON.min).max(IDENTITY_CHECK_REASON.max),
});

/** Sets the mode (setting it again ends a pause early). */
export async function setIdentityCheckMode(
  api: FoundationAuthenticatedApi,
  input: z.infer<typeof identityCheckModeRequest>
) {
  // TODO(61 part 7a): allow the Didit settings once the database records each
  // member's consent before a check starts. Until then the setting stays
  // Manual, whatever the database would accept.
  if (input.mode !== "manual")
    throw new IdentityCheckSettingRefused(
      409,
      "identity_check_consent_pending",
      "The Didit settings switch on once consent recording is live. The setting stays Manual."
    );
  const { data, error } = await api.rpc(
    "set_identity_check_mode",
    { p_mode: input.mode, p_reason: input.reason },
    { get: false }
  );
  if (error) refuse(error);
  return parse(z.object({ mode, changed: z.boolean(), resumed: z.boolean() }), data);
}

/** Route refusals: the card's own reasons, the staff re-verify redirect, and
 * a malformed request. */
export function identityCheckSettingRefusal(error: unknown): FoundationRefusal | null {
  if (error instanceof z.ZodError)
    return {
      status: 422,
      error: `Choose a setting and write a reason of ${IDENTITY_CHECK_REASON.min} to ${IDENTITY_CHECK_REASON.max} characters.`,
      reason: "identity_check_request_invalid",
    };
  if (error instanceof IdentityCheckSettingRefused)
    return { status: error.status, error: error.message, reason: error.reason };
  return staffCommandRefusal(error);
}

/**
 * The latest automatic check of a case the caller holds (null when the case
 * had none). Best effort: the case view works without it.
 */
export async function readIdentityCheckForCase(
  api: FoundationAuthenticatedApi,
  caseId: string
): Promise<IdentityCheckForCase | null> {
  const { data, error } = await api.rpc(
    "get_identity_check_for_case",
    { p_case: caseId },
    { get: false }
  );
  if (error) throw Object.assign(new Error("Identity check read failed"), { cause: error });
  const check = parse(caseResult, data).check;
  return check
    ? {
        status: check.status,
        reasons: check.reasons,
        createdAt: check.created_at,
        finishedAt: check.finished_at,
        declinedAt: check.declined_at,
        askedAt: check.asked_at,
        askReason: check.ask_reason,
      }
    : null;
}
