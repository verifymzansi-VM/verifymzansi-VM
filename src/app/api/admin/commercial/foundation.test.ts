/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import { decideRestoredCommission, saveRestoredPartner } from "@/lib/foundation/partners";
import { recordFrontendStaffPaymentReversal } from "@/lib/foundation/staff-payments";
import {
  inviteFrontendStaffOrganisationAdmin,
  manageFrontendStaffOrganisation,
  revokeFrontendStaffOrganisationInvite,
  saveFrontendStaffOrganisation,
} from "@/lib/foundation/staff-organisation-commands";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/partners", () => ({
  decideRestoredCommission: vi.fn(),
  saveRestoredPartner: vi.fn(),
}));
vi.mock("@/lib/foundation/staff-payments", () => ({
  recordFrontendStaffPaymentReversal: vi.fn(),
}));
vi.mock("@/lib/foundation/staff-organisation-commands", () => ({
  inviteFrontendStaffOrganisationAdmin: vi.fn(),
  manageFrontendStaffOrganisation: vi.fn(),
  revokeFrontendStaffOrganisationInvite: vi.fn(),
  saveFrontendStaffOrganisation: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];

const id = "00000000-0000-4000-8000-000000000001";
const reason = "Agreed with finance";
const done = { done: true };
const api = { rpc: vi.fn() } as unknown as Parameters<OwnerRouteOptions["command"]>[0];

async function command() {
  const answer = NextResponse.json({ ok: true });
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValueOnce(answer);
  const request = new Request("https://verifymzansi.com/api/admin/commercial", { method: "POST" });
  expect(await POST(request)).toBe(answer);
  const options = vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
  expect(options).toMatchObject({ action: "admin:commercial", mutate: true, maxBytes: 16000 });
  expect(options.request).toBeInstanceOf(NextRequest);
  return options.command;
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const helper of [
    decideRestoredCommission,
    saveRestoredPartner,
    recordFrontendStaffPaymentReversal,
    inviteFrontendStaffOrganisationAdmin,
    manageFrontendStaffOrganisation,
    revokeFrontendStaffOrganisationInvite,
    saveFrontendStaffOrganisation,
  ])
    vi.mocked(helper).mockResolvedValue(done as never);
});

// handleFoundationOwnerRoute owns CSRF, sign-in and body limits; staff
// commands check the role and two-step policy in the database.
describe("POST /api/admin/commercial on foundation", () => {
  it("records a payment reversal", async () => {
    const run = await command();
    await expect(
      run(api, { action: "payment.reverse", paymentId: id.toUpperCase(), kind: "refunded", reason })
    ).resolves.toEqual({ success: true, data: done });
    expect(recordFrontendStaffPaymentReversal).toHaveBeenCalledExactlyOnceWith(
      api,
      id,
      "refunded",
      reason
    );
  });

  it("routes organisation actions to the staff organisation commands", async () => {
    const run = await command();
    const upsert = { action: "organisation.upsert", values: { name: "Org" }, reason };
    await run(api, upsert);
    expect(saveFrontendStaffOrganisation).toHaveBeenCalledWith(api, upsert);
    const manage = { action: "organisation.manage", organisationId: id, operation: "note", reason };
    await run(api, manage);
    expect(manageFrontendStaffOrganisation).toHaveBeenCalledWith(api, { ...manage, values: {} });
    const invite = {
      action: "organisation.invite_admin",
      organisationId: id,
      email: "admin@example.com",
      reason,
    };
    await run(api, invite);
    expect(inviteFrontendStaffOrganisationAdmin).toHaveBeenCalledWith(api, invite);
    await run(api, { action: "organisation.revoke_invite", inviteId: id, reason });
    expect(revokeFrontendStaffOrganisationInvite).toHaveBeenCalledWith(api, id, reason);
  });

  it("saves partners and decides commissions", async () => {
    const run = await command();
    await run(api, {
      action: "partner.manage",
      userId: id,
      operation: "rate",
      values: { commissionBps: 250, notes: "  " },
      reason,
    });
    expect(saveRestoredPartner).toHaveBeenCalledExactlyOnceWith(api, {
      account_id: id,
      action: "set_rate",
      reason,
      code: undefined,
      commission_bps: 250,
      note: undefined,
    });
    await run(api, {
      action: "commission.manage",
      commissionId: id,
      operation: "mark_paid",
      values: { reference: "EFT-1" },
      reason,
    });
    expect(decideRestoredCommission).toHaveBeenCalledExactlyOnceWith(api, {
      commission_id: id,
      action: "mark_paid",
      reason,
      reference: "EFT-1",
    });
    await expect(
      run(api, {
        action: "commission.manage",
        commissionId: id,
        operation: "approve",
        values: { amountCents: 100 },
        reason,
      })
    ).rejects.toMatchObject({ status: 422 });
  });

  it("refuses actions the foundation backend does not offer, and invalid input", async () => {
    const run = await command();
    await expect(
      run(api, { action: "trial.override", userId: id, kind: "NONE", reason })
    ).rejects.toMatchObject({ status: 501 });
    await expect(run(api, { action: "payment.reverse", paymentId: id, reason })).rejects.toThrow();
  });
});
