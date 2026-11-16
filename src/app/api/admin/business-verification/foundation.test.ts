/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST as adminCopy } from "./[id]/admin-copy/route";
import { POST as decide } from "./[id]/decide/route";
import { POST as message } from "./[id]/message/route";
import { PATCH as office } from "./[id]/office/route";
import { POST as representative } from "./[id]/representative/route";
import { POST as visitPhoto } from "./[id]/visit-photo/route";
import { POST as visit } from "./[id]/visit/route";
import { GET as file } from "./files/[fileId]/route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { handleNativeCipcStaffAction } from "@/lib/foundation/cipc-commands";
import { attachNativeOfficialCipc } from "@/lib/foundation/cipc-document-route";
import { readSeenEvidenceFile, uploadSeenPhoto } from "@/lib/foundation/seen-media-route";
import { currentBusinessClaim, readStaffSeenCase } from "@/lib/foundation/business-seen";
import { createAdminClient } from "@/lib/supabase/admin";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/cipc-commands", () => ({ handleNativeCipcStaffAction: vi.fn() }));
vi.mock("@/lib/foundation/cipc-document-route", () => ({ attachNativeOfficialCipc: vi.fn() }));
vi.mock("@/lib/foundation/seen-media-route", () => ({
  readSeenEvidenceFile: vi.fn(),
  uploadSeenPhoto: vi.fn(),
}));
vi.mock("@/lib/foundation/business-seen", () => ({
  currentBusinessClaim: vi.fn(),
  readStaffSeenCase: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => {
    throw new Error("Retired backend used");
  }),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const id = "00000000-0000-4000-8000-000000000001";
const staff = { accountId: "00000000-0000-4000-8000-000000000002", sessionId: "s" };
const updatedAt = "2026-11-10T08:00:00.000Z";
const answer = NextResponse.json({ ok: true });
const params = { params: Promise.resolve({ id }) };
const rpc = vi.fn();
const api = { rpc } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const request = (path: string, method = "POST") =>
  new Request(`https://verifymzansi.com/api/admin/business-verification/${id}/${path}`, {
    method,
  });

/** The options the route passed to the foundation owner route. */
function routeOptions(): OwnerRouteOptions {
  return vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(answer);
  vi.mocked(handleNativeCipcStaffAction).mockResolvedValue(answer);
  vi.mocked(attachNativeOfficialCipc).mockResolvedValue(answer);
  vi.mocked(uploadSeenPhoto).mockResolvedValue(answer);
  vi.mocked(readSeenEvidenceFile).mockResolvedValue(answer);
  vi.mocked(readStaffSeenCase).mockResolvedValue(null as never);
  vi.mocked(currentBusinessClaim).mockResolvedValue({ generation: "4", nonce: id });
});

describe("staff business-verification routes on foundation", () => {
  it("hands document, photo and file requests to the foundation handlers", async () => {
    const copy = request("admin-copy");
    expect(await adminCopy(copy, params)).toBe(answer);
    expect(attachNativeOfficialCipc).toHaveBeenCalledExactlyOnceWith(copy, id);

    const photo = request("visit-photo");
    expect(await visitPhoto(photo, params)).toBe(answer);
    expect(uploadSeenPhoto).toHaveBeenCalledExactlyOnceWith(photo, id);

    const read = new NextRequest(
      `https://verifymzansi.com/api/admin/business-verification/files/${id}`
    );
    expect(await file(read, { params: Promise.resolve({ fileId: id }) })).toBe(answer);
    expect(readSeenEvidenceFile).toHaveBeenCalledExactlyOnceWith(read, id);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("sends office and representative corrections as strict staff actions", async () => {
    const patch = request("office", "PATCH");
    expect(await office(patch, params)).toBe(answer);
    const [, officeId, officeAction, officeSchema] = vi.mocked(handleNativeCipcStaffAction).mock
      .calls[0];
    expect([officeId, officeAction]).toEqual([id, "office"]);
    const correction = {
      expectedUpdatedAt: updatedAt,
      streetLines: ["1 Main Road"],
      suburb: null,
      city: "Johannesburg",
      province: "Gauteng",
      postalCode: "2001",
    };
    expect(officeSchema.safeParse(correction).success).toBe(true);
    expect(officeSchema.safeParse({ ...correction, extra: true }).success).toBe(false);
    expect(officeSchema.safeParse({ ...correction, postalCode: "20011" }).success).toBe(false);

    expect(await representative(request("representative"), params)).toBe(answer);
    const [, , repAction, repSchema] = vi.mocked(handleNativeCipcStaffAction).mock.calls[1];
    expect(repAction).toBe("representative");
    const callback = {
      numberSource: "Company website",
      spokeTo: "Reception",
      confirmedPosition: "Director",
      confirmed: true,
      notes: null,
    };
    expect(
      repSchema.safeParse({ expectedUpdatedAt: updatedAt, domainConfirmed: true, callback }).success
    ).toBe(true);
    expect(repSchema.safeParse({ expectedUpdatedAt: updatedAt, callback }).success).toBe(false);
  });

  it("decides a CIPC case with the reviewer's current claim", async () => {
    expect(await decide(request("decide"), params)).toBe(answer);
    const options = routeOptions();
    expect(options).toMatchObject({ action: "business-verification:decide", mutate: true });
    expect(options.request).toBeInstanceOf(NextRequest);
    rpc.mockResolvedValue({ data: { caseId: id, status: "approved" }, error: null });
    await expect(
      options.command(
        api,
        {
          action: "approve",
          expectedUpdatedAt: updatedAt,
          checks: { inBusiness: true, ownerConfirmed: true },
        },
        staff
      )
    ).resolves.toEqual({ caseId: id, status: "approved" });
    expect(currentBusinessClaim).toHaveBeenCalledWith(api, staff.accountId, id, true);
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "decide_frontend_cipc",
      {
        p_case: id,
        p_expected: updatedAt,
        p_action: "approve",
        p_generation: "4",
        p_nonce: id,
        p_confirmed: true,
      },
      { get: false }
    );
  });

  it("revokes a seen check without a claim and refuses exception actions on it", async () => {
    await decide(request("decide"), params);
    const options = routeOptions();
    vi.mocked(readStaffSeenCase).mockResolvedValue({ id } as never);
    rpc.mockResolvedValue({ data: { caseId: id, status: "withdrawn" }, error: null });
    await options.command(
      api,
      { action: "revoke", expectedUpdatedAt: updatedAt, note: "Closed" },
      staff
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "revoke_frontend_seen_check",
      { p_case: id, p_expected: updatedAt, p_note: "Closed", p_reason: "other" },
      { get: false }
    );
    expect(currentBusinessClaim).not.toHaveBeenCalled();
    await expect(
      options.command(api, { action: "propose_exception", expectedUpdatedAt: updatedAt }, staff)
    ).rejects.toMatchObject({ status: 422 });
    await expect(
      options.command(api, { action: "approve", expectedUpdatedAt: updatedAt })
    ).rejects.toThrow("Verified reviewer required");
  });

  it("sends a note to the owner without changing the case", async () => {
    await message(request("message"), params);
    const options = routeOptions();
    expect(options).toMatchObject({ successStatus: 201, maxBytes: 13500 });
    rpc.mockResolvedValue({ data: { ok: true }, error: null });
    await expect(options.command(api, { body: " Please call us " })).resolves.toEqual({
      ok: true,
    });
    expect(rpc).toHaveBeenCalledExactlyOnceWith(
      "send_frontend_seen_message",
      { p_case: id, p_body: "Please call us" },
      { get: false }
    );
    await expect(options.command(api, { body: "" })).rejects.toThrow();
  });

  it("schedules and reports a visit", async () => {
    await visit(request("visit"), params);
    const options = routeOptions();
    const result = { ok: true, updatedAt };
    rpc.mockResolvedValue({ data: result, error: null });
    vi.mocked(currentBusinessClaim).mockResolvedValueOnce(null);
    await options.command(
      api,
      { action: "schedule", expectedUpdatedAt: updatedAt, scheduledFor: updatedAt },
      staff
    );
    expect(rpc).toHaveBeenLastCalledWith(
      "schedule_frontend_seen_check",
      { p_case: id, p_expected: updatedAt, p_scheduled: updatedAt },
      { get: false }
    );
    const report = {
      outcome: "seen",
      identityConfirmed: true,
      signage: true,
      productsSeen: "Bread",
      premisesType: "shop",
      notes: null,
    };
    await expect(
      options.command(api, { action: "report", expectedUpdatedAt: updatedAt, ...report }, staff)
    ).resolves.toEqual(result);
    expect(rpc).toHaveBeenLastCalledWith(
      "report_frontend_seen_check",
      { p_case: id, p_expected: updatedAt, p_report: report },
      { get: false }
    );
  });
});
