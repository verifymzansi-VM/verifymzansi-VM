/** @vitest-environment node */
import { beforeEach, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";
import { GET as organisations, POST as createOrganisation } from "./organisations/route";
import { PATCH as updateOrganisation } from "./organisations/[id]/route";
import { GET as showcases, POST as saveShowcase } from "./organisations/[id]/showcases/route";
import { GET as partners, POST as savePartner } from "./partners/route";
import { GET as commissions, POST as decideCommission } from "./commissions/route";
import { createFoundationRouteContext } from "@/lib/foundation/request-route";
import { FoundationSessionError } from "@/lib/foundation/request-api";
import { readFoundationRuntimeConnection } from "@/lib/foundation/runtime-connection";
import { checkRateLimit } from "@/lib/utils/rate-limit";

vi.mock("@/lib/foundation/request-route", () => ({ createFoundationRouteContext: vi.fn() }));
vi.mock("@/lib/foundation/runtime-connection", () => ({
  readFoundationRuntimeConnection: vi.fn(),
}));
vi.mock("@/lib/utils/rate-limit", () => ({
  checkRateLimit: vi.fn(),
  getClientRateLimitIdentity: () => ({ key: "synthetic-client" }),
}));

const id = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";
const csrf = "a".repeat(64);
const rpc = vi.fn();
const authenticate = vi.fn();
const respond = vi.fn(async (response: NextResponse) => {
  response.headers.set("Cache-Control", "private, no-store");
  response.cookies.set("synthetic-refresh", "retained", { httpOnly: true });
  return response;
});
const context = { params: Promise.resolve({ id }) };
const request = (
  path: string,
  method = "GET",
  body?: unknown,
  origin = "https://verifymzansi.com"
) =>
  new NextRequest("https://verifymzansi.com/api/foundation/staff/" + path, {
    method,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    headers: {
      origin,
      "content-type": "application/json",
      cookie: `vm_csrf=${csrf}`,
      "x-csrf-token": csrf,
    },
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(readFoundationRuntimeConnection).mockReturnValue({
    url: "https://gntzjtuncsyefujajmjy.supabase.co",
    expectedProjectRef: "gntzjtuncsyefujajmjy",
    publishableKey: "sb_publishable_synthetic",
  });
  vi.mocked(createFoundationRouteContext).mockReturnValue({
    authenticate,
    authenticateCaller: async () => ({ api: await authenticate(), accountId: id }),
    respond,
  } as unknown as ReturnType<typeof createFoundationRouteContext>);
  vi.mocked(checkRateLimit).mockResolvedValue({ limited: false });
  authenticate.mockResolvedValue({ rpc });
  rpc.mockResolvedValue({ data: [], error: null });
});

it.each([
  ["organisations", organisations, "staff_list_organisations"],
  ["partners", partners, "staff_list_partners"],
  ["commissions", commissions, "staff_list_commissions"],
] as const)(
  "reads %s with the caller session and private refreshed responses",
  async (path, handler, command) => {
    const response = await handler(request(path));
    expect(response.status).toBe(200);
    expect(rpc.mock.calls[0][0]).toBe(command);
    expect(authenticate).toHaveBeenCalledTimes(1);
    expect(response.headers.get("Cache-Control")).toContain("no-store");
    expect(response.cookies.get("synthetic-refresh")?.value).toBe("retained");
  }
);

it("returns database staff/MFA refusals without private details", async () => {
  rpc.mockResolvedValue({
    data: null,
    error: { code: "42501", message: "synthetic sensitive detail" },
  });
  for (const handler of [organisations, partners, commissions]) {
    const response = await handler(request("organisations"));
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("synthetic sensitive detail");
    expect(response.headers.get("Cache-Control")).toContain("no-store");
  }
});

it("fails closed for absent bindings, expired sessions, and degraded protection", async () => {
  vi.mocked(readFoundationRuntimeConnection).mockImplementationOnce(() => {
    throw new Error("unconfigured");
  });
  expect((await organisations(request("organisations"))).status).toBe(503);
  expect(authenticate).not.toHaveBeenCalled();
  authenticate.mockRejectedValueOnce(new FoundationSessionError(401));
  expect((await organisations(request("organisations"))).status).toBe(401);
  vi.mocked(checkRateLimit).mockResolvedValueOnce({
    limited: true,
    degraded: true,
    retryAfter: 30,
  });
  const response = await partners(request("partners"));
  expect(response.status).toBe(503);
  expect(response.headers.get("Retry-After")).toBe("30");
  expect(rpc).not.toHaveBeenCalled();
});

it("filters commissions strictly and rejects unknown, repeated or forged identity fields", async () => {
  expect((await commissions(request(`commissions?partner_id=${id}&status=approved`))).status).toBe(
    200
  );
  expect(rpc).toHaveBeenCalledWith("staff_list_commissions", {
    p_partner: id,
    p_status: "approved",
  });
  for (const query of [
    "status=unknown",
    "partner_id=bad",
    "status=paid&status=approved",
    `referred_account_id=${id}`,
  ])
    expect((await commissions(request("commissions?" + query))).status).toBe(400);
  expect(rpc).toHaveBeenCalledTimes(1);
});

it("refuses unexpected private fields from read commands", async () => {
  rpc.mockResolvedValue({ data: [{ email: "synthetic@example.invalid" }], error: null });
  for (const handler of [organisations, partners, commissions]) {
    const response = await handler(request("partners"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic@example.invalid");
  }
});

it("creates and updates organisations with reasons and revision fencing", async () => {
  rpc.mockResolvedValueOnce({ data: { id, slug: "test-programme", revision: 1 }, error: null });
  const creation = {
    slug: "test-programme",
    name: "Test programme",
    organisation_type: "ngo",
    reason: "Approved programme",
  };
  expect((await createOrganisation(request("organisations", "POST", creation))).status).toBe(200);
  rpc.mockResolvedValueOnce({ data: { id, slug: "test-programme", revision: 2 }, error: null });
  const update = {
    expected_revision: 1,
    patch: { is_public: true },
    reason: "Publish approved programme",
  };
  expect(
    (await updateOrganisation(request(`organisations/${id}`, "PATCH", update), context)).status
  ).toBe(200);
  expect(rpc.mock.calls[1]).toEqual([
    "update_organisation",
    { p_id: id, p_expected_revision: 1, p_patch: { is_public: true }, p_reason: update.reason },
  ]);
  expect(
    (await updateOrganisation(request(`organisations/${id}`, "PATCH", { ...update, id }), context))
      .status
  ).toBe(400);
  expect(
    (await createOrganisation(request("organisations", "POST", { ...creation, created_by: id })))
      .status
  ).toBe(400);
  expect(rpc).toHaveBeenCalledTimes(2);
});

it("binds showcases to the path and accepts all four reviewed placements", async () => {
  const at = "2026-10-23T00:00:00Z",
    until = "2026-10-24T00:00:00Z";
  for (const placement of ["home", "business", "tourism", "market"]) {
    rpc.mockResolvedValueOnce({
      data: [
        {
          id,
          programme_id: null,
          title: "Programme",
          placement,
          enabled: true,
          starts_at: at,
          ends_at: until,
          max_cards: 3,
          province: null,
          city: null,
          display_order: 0,
          sponsored_only: false,
          revision: 1,
          updated_at: at,
        },
      ],
      error: null,
    });
    expect((await showcases(request(`organisations/${id}/showcases`), context)).status).toBe(200);
  }
  const body = {
    showcase_id: null,
    expected_revision: null,
    title: "Programme",
    placement: "market",
    enabled: true,
    starts_at: at,
    ends_at: until,
    max_cards: 3,
    display_order: 0,
    sponsored_only: false,
    reason: "Approved display",
  };
  rpc.mockResolvedValueOnce({ data: { id, revision: 1 }, error: null });
  expect(
    (await saveShowcase(request(`organisations/${id}/showcases`, "POST", body), context)).status
  ).toBe(200);
  expect(rpc.mock.calls.at(-1)?.[1].p_org).toBe(id);
  expect(
    (
      await saveShowcase(
        request(`organisations/${id}/showcases`, "POST", { ...body, organisation_id: id }),
        context
      )
    ).status
  ).toBe(400);
});

it("records partner changes and external payout references without trusting actor fields", async () => {
  rpc.mockResolvedValueOnce({
    data: { id, code: "TEST123", status: "pending", commission_bps: null, revision: 1 },
    error: null,
  });
  expect(
    (
      await savePartner(
        request("partners", "POST", {
          account_id: id,
          action: "create",
          code: "TEST123",
          reason: "Reviewed new partner",
        })
      )
    ).status
  ).toBe(200);
  rpc.mockResolvedValueOnce({ data: { id, status: "paid" }, error: null });
  expect(
    (
      await decideCommission(
        request("commissions", "POST", {
          commission_id: id,
          action: "mark_paid",
          reference: "BANK-001",
          reason: "External transfer checked",
        })
      )
    ).status
  ).toBe(200);
  expect(rpc.mock.calls.at(-1)?.[1]).not.toHaveProperty("p_actor");
  expect(
    (
      await decideCommission(
        request("commissions", "POST", {
          commission_id: id,
          action: "mark_paid",
          reason: "External transfer checked",
        })
      )
    ).status
  ).toBe(400);
});

it("binds mutation acknowledgments to the verified caller rather than the target account", async () => {
  const target = "00000000-0000-4000-8000-000000000002";
  rpc.mockResolvedValueOnce({
    data: { id, code: "TARGET01", status: "pending", commission_bps: null, revision: 1 },
    error: null,
  });
  const response = await savePartner(
    request("partners", "POST", {
      account_id: target,
      action: "create",
      code: "TARGET01",
      reason: "Reviewed referral partner",
    })
  );
  expect(response.status).toBe(200);
  expect((await response.json()).account_id).toBe(id);
  expect(rpc).toHaveBeenCalledWith(
    "staff_save_partner",
    expect.objectContaining({ p_account: target })
  );
});

it("accepts a bounded multilingual organisation profile rather than truncating a valid form", async () => {
  const description = "é".repeat(1200);
  rpc.mockResolvedValueOnce({ data: { id, slug: "example-org", revision: 2 }, error: null });
  const response = await updateOrganisation(
    request(`organisations/${id}`, "PATCH", {
      expected_revision: 1,
      patch: { description, programme_description: description },
      reason: "Reviewed programme descriptions",
    }),
    context
  );
  expect(response.status).toBe(200);
  expect(rpc).toHaveBeenCalledWith(
    "update_organisation",
    expect.objectContaining({
      p_patch: { description, programme_description: description },
    })
  );
});

it("rejects cross-site writes before authentication and never retries uncertain mutations", async () => {
  const body = { account_id: id, action: "suspend", reason: "Reviewed suspension" };
  expect(
    (await savePartner(request("partners", "POST", body, "https://evil.example"))).status
  ).toBe(403);
  expect(authenticate).not.toHaveBeenCalled();
  rpc.mockRejectedValueOnce(new Error("uncertain provider response"));
  expect((await savePartner(request("partners", "POST", body))).status).toBe(503);
  expect(rpc).toHaveBeenCalledTimes(1);
});
