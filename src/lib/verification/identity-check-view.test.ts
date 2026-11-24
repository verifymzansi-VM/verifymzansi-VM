import { describe, expect, it } from "vitest";
import {
  IDENTITY_CHECK_POLL_MS,
  formatAskByDate,
  identityCheckView,
  identityCheckWaiting,
  type IdentityCheckAvailability,
} from "./identity-check-view";

const id = "22222222-2222-4222-8222-222222222222";
const route = (
  value: "manual" | "automatic",
  reason: string | null,
  check: Record<string, unknown> | null = null
) => ({ route: value, reason, check }) as IdentityCheckAvailability;

describe("the ID step's view of the independent check", () => {
  it("stays today's camera route on the Manual setting, and while the route is unknown", () => {
    expect(identityCheckView(null)).toEqual({ kind: "manual", fallback: false });
    expect(identityCheckView(route("manual", "mode"))).toEqual({ kind: "manual", fallback: false });
  });

  it("adds the 'isn't available right now' line when paused or over the limit (08)", () => {
    expect(identityCheckView(route("manual", "paused"))).toEqual({
      kind: "manual",
      fallback: true,
    });
    expect(identityCheckView(route("manual", "limit"))).toEqual({ kind: "manual", fallback: true });
  });

  it("offers the start screen on a Didit setting (02)", () => {
    expect(identityCheckView(route("automatic", null))).toEqual({ kind: "start" });
    expect(identityCheckView(route("automatic", null, { id, status: "not_finished" }))).toEqual({
      kind: "start",
    });
    // Started but no session attached yet: starting again attaches one.
    expect(
      identityCheckView(route("automatic", null, { id, status: "started", session_url: null }))
    ).toEqual({ kind: "start" });
  });

  it("shows the check in the page, then 'checking' once the frame says it finished (02b, 03)", () => {
    const started = route("automatic", null, {
      id,
      status: "started",
      session_url: "https://verify.didit.me/session/abc",
    });
    expect(identityCheckView(started)).toEqual({
      kind: "frame",
      url: "https://verify.didit.me/session/abc",
    });
    expect(identityCheckView(started, { finished: true })).toEqual({ kind: "checking" });
    // An unfinished check resumes whatever the setting now says.
    expect(identityCheckView({ ...started, route: "manual", reason: "mode" }).kind).toBe("frame");
  });

  it("shows a verified result (04)", () => {
    expect(identityCheckView(route("automatic", null, { id, status: "approved" }))).toEqual({
      kind: "approved",
    });
  });

  it("shows 'a person will check' while the ID step waits for staff, or after asking (05)", () => {
    const withStaff = route("automatic", null, { id, status: "with_staff" });
    expect(identityCheckView(withStaff, { idStepPending: true })).toEqual({ kind: "with_staff" });
    // Staff already decided (sent back): the member can start again.
    expect(identityCheckView(withStaff, { idStepPending: false })).toEqual({ kind: "start" });
    expect(
      identityCheckView(
        route("automatic", null, {
          id,
          status: "declined",
          asked_at: "2026-11-21T10:00:00Z",
          with_person: true,
        })
      )
    ).toEqual({ kind: "with_staff" });
  });

  it("shows a decline with 'try again' and 'ask a person' while each is allowed (06)", () => {
    const declined = {
      id,
      status: "declined",
      decline_reason: "names_differ",
      can_ask_person: true,
      ask_person_until: "2026-11-25T10:00:00Z",
      asked_at: null,
    };
    expect(identityCheckView(route("automatic", null, declined))).toEqual({
      kind: "declined",
      checkId: id,
      reason: "names_differ",
      canRetry: true,
      canAsk: true,
      askBy: "2026-11-25T10:00:00Z",
    });
    // Over the weekly limit: asking is still offered, trying again is not.
    expect(identityCheckView(route("manual", "limit", declined))).toMatchObject({
      kind: "declined",
      canRetry: false,
      canAsk: true,
    });
    // An unknown reason is worded as "couldn't confirm".
    expect(
      identityCheckView(route("automatic", null, { ...declined, decline_reason: "banned" }))
    ).toMatchObject({ reason: "not_confirmed" });
    // "Try the ID check again" goes back to the start screen.
    expect(identityCheckView(route("automatic", null, declined), { tryAgain: true })).toEqual({
      kind: "start",
    });
    // An old decline on the Manual setting is today's camera route.
    expect(
      identityCheckView(route("manual", "mode", { ...declined, can_ask_person: false }))
    ).toEqual({ kind: "manual", fallback: false });
  });

  it("asks for the result only while a check runs, 4 times a minute", () => {
    expect(identityCheckWaiting({ kind: "frame", url: "x" })).toBe(true);
    expect(identityCheckWaiting({ kind: "checking" })).toBe(true);
    for (const kind of ["start", "approved", "with_staff"] as const)
      expect(identityCheckWaiting({ kind })).toBe(false);
    expect(identityCheckWaiting({ kind: "manual", fallback: false })).toBe(false);
    expect(identityCheckWaiting(null)).toBe(false);
    expect(60_000 / IDENTITY_CHECK_POLL_MS).toBeLessThanOrEqual(4);
  });

  it("words the ask-by date in South African time", () => {
    expect(formatAskByDate("2026-11-25T23:30:00Z")).toBe("26 November");
    expect(formatAskByDate(null)).toBe("");
    expect(formatAskByDate("not a date")).toBe("");
  });
});
