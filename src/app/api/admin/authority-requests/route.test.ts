/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import { POST } from "./route";
import { handleFoundationOwnerRoute } from "@/lib/foundation/owner-route";
import {
  authorityRequestRefusal,
  closeIdentityDisclosure,
  openIdentityDisclosure,
} from "@/lib/foundation/identity-disclosures";

vi.mock("@/lib/foundation/owner-route", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  handleFoundationOwnerRoute: vi.fn(),
}));
vi.mock("@/lib/foundation/identity-disclosures", async (original) => ({
  ...(await original<Record<string, unknown>>()),
  openIdentityDisclosure: vi.fn(),
  closeIdentityDisclosure: vi.fn(),
}));

type OwnerRouteOptions = Parameters<typeof handleFoundationOwnerRoute>[0];
const api = { rpc: vi.fn() } as unknown as Parameters<OwnerRouteOptions["command"]>[0];
const DISCLOSURE = "00000000-0000-4000-8000-000000000001";
const OPEN = {
  action: "open",
  requestType: "subpoena",
  reference: " CAS 123/11/2026 ",
  requestedBy: "Det. Sgt. Synthetic",
  requestDate: "2026-11-19",
  reason: "Fraud investigation into a reported listing.",
  lookupKind: "post",
  lookupValue: "https://verifymzansi.co.za/listing/red-bicycle",
  attested: true,
};

async function options() {
  await POST(
    new NextRequest("https://verifymzansi.com/api/admin/authority-requests", { method: "POST" })
  );
  return vi.mocked(handleFoundationOwnerRoute).mock.calls[0][0] as OwnerRouteOptions;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(handleFoundationOwnerRoute).mockResolvedValue(NextResponse.json({ ok: true }));
});

// handleFoundationOwnerRoute owns same-origin, CSRF, the per-client rate
// limit, sign-in and body limits (src/lib/foundation/owner-route.test.ts).
describe("POST /api/admin/authority-requests", () => {
  it("is a guarded write with its own rate-limit bucket and refusal map", async () => {
    expect(await options()).toMatchObject({
      action: "admin:authority-requests",
      mutate: true,
      maxBytes: 8192,
      refusal: authorityRequestRefusal,
    });
  });

  it("opens a record with exactly the typed request", async () => {
    const route = await options();
    vi.mocked(openIdentityDisclosure).mockResolvedValue({
      id: DISCLOSURE,
      number: 42,
      outcome: "record",
      matchCount: 1,
      closesAt: "2026-11-21T08:15:00Z",
    });
    await expect(route.command(api, OPEN)).resolves.toMatchObject({ id: DISCLOSURE });
    expect(openIdentityDisclosure).toHaveBeenCalledExactlyOnceWith(api, {
      requestType: "subpoena",
      reference: "CAS 123/11/2026",
      requestedBy: "Det. Sgt. Synthetic",
      requestDate: "2026-11-19",
      reason: "Fraud investigation into a reported listing.",
      lookupKind: "post",
      lookupValue: "https://verifymzansi.co.za/listing/red-bicycle",
      attested: true,
    });
  });

  it("closes a record early", async () => {
    const route = await options();
    vi.mocked(closeIdentityDisclosure).mockResolvedValue({
      disclosure_id: DISCLOSURE,
      closed: true,
    });
    await route.command(api, { action: "close", disclosureId: DISCLOSURE });
    expect(closeIdentityDisclosure).toHaveBeenCalledExactlyOnceWith(api, DISCLOSURE);
  });

  it("refuses a search by name, unknown fields and control characters before the database", async () => {
    const route = await options();
    for (const input of [
      { ...OPEN, lookupKind: "name", lookupValue: "Thando Dlamini" },
      { ...OPEN, surname: "Dlamini" },
      { ...OPEN, reason: "line\u0000break" },
      { ...OPEN, requestDate: "19 Nov 2026" },
      { action: "close", disclosureId: "D-0042" },
    ]) {
      await expect(route.command(api, input)).rejects.toThrow();
      const thrown = await route.command(api, input).catch((error: unknown) => error);
      expect(route.refusal(thrown)).toMatchObject({ status: 422 });
    }
    expect(openIdentityDisclosure).not.toHaveBeenCalled();
    expect(closeIdentityDisclosure).not.toHaveBeenCalled();
  });
});
