/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";
import type { FoundationAuthenticatedApi } from "./authenticated-api";
import {
  identityCheckModeRequest,
  identityCheckSettingRefusal,
  readIdentityCheckSettings,
  setIdentityCheckMode,
} from "./identity-check-staff";
import { roleHasCapability } from "@/lib/auth/admin-access";

vi.mock("server-only", () => ({}));

const api = (answer: { data: unknown; error: unknown }) => {
  const rpc = vi.fn().mockResolvedValue(answer);
  return { api: { rpc } as unknown as FoundationAuthenticatedApi, rpc };
};
/** What a refused command answers on the route. */
async function refusalOf(promise: Promise<unknown>) {
  try {
    await promise;
  } catch (error) {
    return identityCheckSettingRefusal(error);
  }
  throw new Error("expected a refusal");
}

describe("the ID check setting", () => {
  it("is read with its pause, counts and latest changes", async () => {
    const { api: reader, rpc } = api({
      data: {
        account_id: "11111111-1111-4111-8111-111111111111",
        mode: "staff_final",
        changed_at: "2026-11-20T10:00:00Z",
        paused_until: "2026-11-20T12:15:00Z",
        pause_reason: "no_credit",
        last_7_days: {
          checks: 42,
          approved: 36,
          with_staff: 6,
          declined: 0,
          asked_person: 0,
          unavailable: 1,
        },
        recent_changes: [
          {
            from_mode: "manual",
            to_mode: "staff_final",
            changed_by: "11111111-1111-4111-8111-111111111111",
            reason: "Launch: Didit on",
            changed_at: "2026-11-20T10:00:00Z",
          },
        ],
      },
      error: null,
    });
    expect(await readIdentityCheckSettings(reader)).toEqual({
      mode: "staff_final",
      pausedUntil: "2026-11-20T12:15:00Z",
      pauseReason: "no_credit",
      last7Days: { checks: 42, approved: 36, withStaff: 6, declined: 0, askedPerson: 0 },
      recentChanges: [
        {
          fromMode: "manual",
          toMode: "staff_final",
          reason: "Launch: Didit on",
          changedAt: "2026-11-20T10:00:00Z",
        },
      ],
    });
    expect(rpc).toHaveBeenCalledWith("get_identity_check_settings", {}, { get: false });
  });

  it("is changed with the chosen mode and the reason", async () => {
    const { api: writer, rpc } = api({
      data: { mode: "automatic", changed: true, resumed: false },
      error: null,
    });
    const input = identityCheckModeRequest.parse({ mode: "automatic", reason: "  Go live  " });
    expect(await setIdentityCheckMode(writer, input)).toEqual({
      mode: "automatic",
      changed: true,
      resumed: false,
    });
    expect(rpc).toHaveBeenCalledWith(
      "set_identity_check_mode",
      { p_mode: "automatic", p_reason: "Go live" },
      { get: false }
    );
  });

  it("can be changed only by staff with a recent 2-step check: an expired one is sent to verify again", async () => {
    const { api: writer } = api({
      data: null,
      error: { code: "42501", message: "staff second-factor verification expired" },
    });
    expect(
      await refusalOf(setIdentityCheckMode(writer, { mode: "staff_final", reason: "Launch" }))
    ).toMatchObject({ status: 403, code: "step_up_required", redirectUrl: "/staff/two-step" });
  });

  it("can be changed only by admins: other staff are refused", async () => {
    const { api: writer } = api({
      data: null,
      error: { code: "42501", message: "capability not granted" },
    });
    expect(
      await refusalOf(setIdentityCheckMode(writer, { mode: "staff_final", reason: "Launch" }))
    ).toMatchObject({ status: 403, reason: "identity_check_not_allowed" });
    expect(roleHasCapability("admin", "identity_check:configure")).toBe(true);
    expect(roleHasCapability("governance_controller", "identity_check:configure")).toBe(false);
    expect(roleHasCapability("moderator", "identity_check:configure")).toBe(false);
  });

  it("refuses an unknown mode, a short reason and extra fields before the database", () => {
    for (const body of [
      { mode: "off", reason: "A good reason" },
      { mode: "manual", reason: "abc" },
      { mode: "manual", reason: "A good reason", by: "someone" },
    ]) {
      const parsed = identityCheckModeRequest.safeParse(body);
      expect(parsed.success).toBe(false);
      expect(identityCheckSettingRefusal(parsed.error)).toMatchObject({ status: 422 });
    }
  });
});
