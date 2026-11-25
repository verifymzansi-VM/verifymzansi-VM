/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { FoundationStaffCommandError, staffCommandRefusal } from "@/lib/foundation/staff-command";
import { readPhoneReleases } from "@/lib/foundation/phone-releases";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];
type Api = Parameters<OwnerRouteOptions["command"]>[0];

const rpc = vi.fn();
const api = { rpc } as unknown as Api;
const PHONE = "+27821234567";
const AT = "2026-11-25T21:36:54.793502+00:00";

async function options() {
  await POST(
    new NextRequest("https://verifymzansi.com/api/admin/governance/phone-releases", {
      method: "POST",
    })
  );
  return vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
}

/** The refusal the route answers for a database error. */
async function refusalFor(error: { code: string; message: string; details?: string }) {
  const route = await options();
  rpc.mockResolvedValue({ data: null, error });
  const thrown = await route.command(api, { action: "approve", phone: PHONE, proposedAt: AT }).then(
    () => null,
    (e: unknown) => e
  );
  expect(thrown).toBeInstanceOf(FoundationStaffCommandError);
  return staffCommandRefusal(thrown);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(NextResponse.json({ ok: true }));
});

describe("POST /api/admin/governance/phone-releases", () => {
  it("is a protected staff mutation", async () => {
    const route = await options();
    expect(route).toMatchObject({ action: "admin:governance:phone-release", mutate: true });
    expect(route.refusal).toBe(staffCommandRefusal);
  });

  it("asks to release a number written the local way", async () => {
    const route = await options();
    rpc.mockResolvedValue({ data: { phone: PHONE, status: "proposed" }, error: null });
    await expect(
      route.command(api, {
        action: "propose",
        phone: "082 123 4567",
        reason: "  The network re-issued this number  ",
      })
    ).resolves.toEqual({ status: "proposed" });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "propose_phone_number_release",
      { p_phone: PHONE, p_reason: "The network re-issued this number" },
      { get: false }
    );
  });

  it("approves and rejects a waiting request", async () => {
    const route = await options();
    rpc.mockResolvedValueOnce({ data: { phone: PHONE, status: "released" }, error: null });
    await expect(
      route.command(api, { action: "approve", phone: "+27 82 123 4567", proposedAt: AT })
    ).resolves.toEqual({
      status: "released",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "review_phone_number_release",
      { p_phone: PHONE, p_proposed_at: AT, p_approve: true },
      { get: false }
    );
    rpc.mockResolvedValueOnce({ data: { phone: PHONE, status: "rejected" }, error: null });
    await expect(
      route.command(api, { action: "reject", phone: "27821234567", proposedAt: AT })
    ).resolves.toEqual({
      status: "rejected",
    });
    expect(rpc).toHaveBeenLastCalledWith(
      "review_phone_number_release",
      { p_phone: PHONE, p_proposed_at: AT, p_approve: false },
      { get: false }
    );
  });

  it("refuses bad input before any database call", async () => {
    const route = await options();
    for (const body of [
      { action: "propose", phone: "12345", reason: "A long enough reason" },
      { action: "propose", phone: PHONE, reason: "short" },
      { action: "approve", phone: PHONE, proposedAt: AT, reason: "not expected here" },
      { action: "approve", phone: PHONE },
      { action: "reject", phone: PHONE, proposedAt: "yesterday" },
      { action: "delete", phone: PHONE },
    ])
      await expect(route.command(api, body)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses an answer for another number", async () => {
    const route = await options();
    rpc.mockResolvedValue({ data: { phone: "+27820000000", status: "released" }, error: null });
    await expect(
      route.command(api, { action: "approve", phone: PHONE, proposedAt: AT })
    ).rejects.toThrow("could not be confirmed");
  });

  it("words each database refusal", async () => {
    expect(
      await refusalFor({
        code: "42501",
        message: "a different staff member must approve this release",
        details: "phone_release_same_staff",
      })
    ).toMatchObject({
      status: 403,
      error: "A different staff member must approve a release you asked for.",
    });
    expect(
      await refusalFor({
        code: "PT404",
        message: "phone number not blocked",
        details: "phone_not_blocked",
      })
    ).toMatchObject({ status: 404 });
    expect(
      await refusalFor({
        code: "PT409",
        message: "no release is waiting",
        details: "phone_release_not_pending",
      })
    ).toMatchObject({ status: 409 });
    expect(
      await refusalFor({ code: "42501", message: "recent second-factor verification required" })
    ).toMatchObject({ status: 403, reason: "staff_mfa_required", redirectUrl: "/staff/two-step" });
    expect(await refusalFor({ code: "42501", message: "capability not granted" })).toMatchObject({
      status: 403,
      error: "Only admins and governors can release numbers.",
    });
  });
});

describe("readPhoneReleases", () => {
  const actor = "00000000-0000-4000-8000-000000000002";
  const waiting = {
    phone: PHONE,
    reason: "The network re-issued this number",
    proposed_at: "2026-11-25T10:00:00Z",
    expires_at: "2026-12-02T10:00:00Z",
    proposed_by_name: "Thando D.",
    proposed_by_me: false,
    conflicted: false,
  };

  it("reads the waiting requests and releases for the signed-in staff member", async () => {
    rpc.mockResolvedValue({
      data: { actor_id: actor, pending: [waiting], released: [] },
      error: null,
    });
    await expect(readPhoneReleases(api, actor)).resolves.toEqual({
      actor_id: actor,
      pending: [waiting],
      released: [],
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_phone_number_releases", {}, { get: false });
  });

  it("refuses an answer for another session or with extra fields", async () => {
    rpc.mockResolvedValue({
      data: { actor_id: "00000000-0000-4000-8000-000000000009", pending: [], released: [] },
      error: null,
    });
    await expect(readPhoneReleases(api, actor)).rejects.toThrow();
    rpc.mockResolvedValue({
      data: { actor_id: actor, pending: [{ ...waiting, identity: "x" }], released: [] },
      error: null,
    });
    await expect(readPhoneReleases(api, actor)).rejects.toThrow();
  });
});
