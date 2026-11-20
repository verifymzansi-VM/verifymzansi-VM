import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isOwnApiRequest, StaffTwoStepReturn, staffTwoStepTarget } from "./staff-two-step-return";

const HERE = "/admin/member-invitations?tab=open";
const BACK = encodeURIComponent(HERE);

describe("staffTwoStepTarget", () => {
  it("sends the proxy's expired-check answer to the two-step page and back", () => {
    expect(
      staffTwoStepTarget(
        403,
        { code: "mfa_required", verifyUrl: "/staff/two-step", redirectUrl: "/staff/two-step" },
        HERE
      )
    ).toBe(`/staff/two-step?next=${BACK}`);
  });

  it("keeps the confirm step of a sensitive action", () => {
    expect(
      staffTwoStepTarget(
        403,
        { code: "step_up_required", verifyUrl: "/staff/two-step?confirm=1" },
        HERE
      )
    ).toBe(`/staff/two-step?confirm=1&next=${BACK}`);
  });

  it("follows a database refusal of the staff check (staffCommandRefusal)", () => {
    expect(
      staffTwoStepTarget(
        403,
        { reason: "staff_mfa_required", code: "step_up_required", redirectUrl: "/staff/two-step" },
        HERE
      )
    ).toBe(`/staff/two-step?next=${BACK}`);
  });

  it.each([
    "https://example.com/staff/two-step",
    "//example.com/staff/two-step",
    "/login",
    "/staff/two-stepper",
    "/staff/two-step?next=/admin/other",
  ])("never follows another address (%s)", (url) => {
    expect(staffTwoStepTarget(403, { code: "mfa_required", verifyUrl: url }, HERE)).toBe(
      `/staff/two-step?next=${BACK}`
    );
  });

  it.each([
    [403, { error: "Forbidden" }],
    [403, { code: "other" }],
    [403, null],
    [401, { code: "mfa_required" }],
    [500, { reason: "staff_mfa_required" }],
  ])("leaves other answers to the screen (%s)", (status, body) => {
    expect(staffTwoStepTarget(status, body, HERE)).toBeNull();
  });
});

describe("isOwnApiRequest", () => {
  const origin = "https://verifymzansi.com";
  it("matches only this site's API", () => {
    expect(isOwnApiRequest("/api/admin/member-invitations", origin)).toBe(true);
    expect(isOwnApiRequest(new URL("/api/admin/x", origin), origin)).toBe(true);
    expect(isOwnApiRequest(new Request(`${origin}/api/admin/x`), origin)).toBe(true);
    expect(isOwnApiRequest("/admin/moderation", origin)).toBe(false);
    expect(isOwnApiRequest("https://example.com/api/admin/x", origin)).toBe(false);
  });
});

describe("StaffTwoStepReturn", () => {
  const assign = vi.fn();
  let realFetch: typeof window.fetch;
  let realLocation: Location;

  beforeEach(() => {
    realFetch = window.fetch;
    realLocation = window.location;
    Object.defineProperty(window, "location", {
      configurable: true,
      value: {
        origin: "https://verifymzansi.com",
        pathname: "/admin/member-invitations",
        search: "?tab=open",
        assign,
      },
    });
  });

  afterEach(() => {
    window.fetch = realFetch;
    Object.defineProperty(window, "location", { configurable: true, value: realLocation });
    vi.clearAllMocks();
  });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  it("goes to the two-step page when a staff write finds the check expired, and still returns the answer", async () => {
    window.fetch = vi
      .fn()
      .mockResolvedValue(
        json(403, { error: "x", code: "mfa_required", verifyUrl: "/staff/two-step" })
      );
    const { unmount } = render(<StaffTwoStepReturn />);
    const response = await window.fetch("/api/admin/member-invitations", { method: "POST" });
    expect(assign).toHaveBeenCalledWith(`/staff/two-step?next=${BACK}`);
    // The screen can still read the answer it asked for.
    expect((await response.json()).code).toBe("mfa_required");
    unmount();
  });

  it("leaves ordinary refusals and other sites alone", async () => {
    window.fetch = vi
      .fn()
      .mockResolvedValueOnce(json(403, { error: "Forbidden" }))
      .mockResolvedValueOnce(json(403, { code: "mfa_required" }))
      .mockResolvedValueOnce(json(200, { code: "mfa_required" }));
    render(<StaffTwoStepReturn />);
    await window.fetch("/api/admin/commercial", { method: "POST" });
    await window.fetch("https://example.com/api/admin", { method: "POST" });
    await window.fetch("/api/admin/commercial", { method: "POST" });
    expect(assign).not.toHaveBeenCalled();
  });

  it("puts the original fetch back when the staff area closes", () => {
    const original = vi.fn();
    window.fetch = original;
    const { unmount } = render(<StaffTwoStepReturn />);
    expect(window.fetch).not.toBe(original);
    unmount();
    expect(window.fetch).toBe(original);
  });
});
