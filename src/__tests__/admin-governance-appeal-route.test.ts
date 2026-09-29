import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DecisionLedger from "@/lib/services/decision-ledger";

const { guard, resolveAppeal } = vi.hoisted(() => ({ guard: vi.fn(), resolveAppeal: vi.fn() }));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/services/decision-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof DecisionLedger>()),
  resolveAppeal,
}));

import { POST } from "@/app/api/admin/governance/appeal/route";

const GOV = "11111111-1111-4111-8111-111111111111";
const APPEAL = "a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11";

const request = (body: Record<string, unknown>) =>
  new Request("http://localhost:3000/api/admin/governance/appeal", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/governance/appeal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({
      success: true,
      user: { id: GOV },
      actorRole: "governance_controller",
    });
    resolveAppeal.mockResolvedValue({ ok: true, status: "overturned", restrictions_changed: 1 });
  });

  it("requires appeal:decide", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect(
      (await POST(request({ appealId: APPEAL, status: "upheld", rationale: "Evidence holds" })))
        .status
    ).toBe(403);
    expect(guard).toHaveBeenCalledWith(expect.objectContaining({ capability: "appeal:decide" }));
  });

  it("resolves with the verified reviewer and reports what changed", async () => {
    const res = await POST(
      request({ appealId: APPEAL, status: "overturned", rationale: "ID was stolen" })
    );
    expect(res.status).toBe(200);
    expect(resolveAppeal).toHaveBeenCalledWith(
      GOV,
      APPEAL,
      "overturned",
      "ID was stolen",
      undefined
    );
    await expect(res.json()).resolves.toMatchObject({ restrictionsChanged: 1 });
  });

  it("needs a new end date for a partial overturn", async () => {
    const missing = await POST(
      request({
        appealId: APPEAL,
        status: "partially_overturned",
        rationale: "Too long for a first offence",
      })
    );
    expect(missing.status).toBe(400);

    const shortenTo = "2026-10-05T10:00:00.000Z";
    await POST(
      request({
        appealId: APPEAL,
        status: "partially_overturned",
        rationale: "Too long for a first offence",
        shortenTo,
      })
    );
    expect(resolveAppeal).toHaveBeenCalledWith(
      GOV,
      APPEAL,
      "partially_overturned",
      "Too long for a first offence",
      shortenTo
    );
  });

  it("refuses a reviewer who took part in the decision", async () => {
    resolveAppeal.mockResolvedValue({ ok: false, error: "not_independent" });
    const res = await POST(
      request({ appealId: APPEAL, status: "overturned", rationale: "ID was stolen" })
    );
    expect(res.status).toBe(403);
  });

  it("requires a real rationale", async () => {
    expect(
      (await POST(request({ appealId: APPEAL, status: "upheld", rationale: "ok" }))).status
    ).toBe(400);
    expect(resolveAppeal).not.toHaveBeenCalled();
  });

  it("returns 500 when the database fails", async () => {
    resolveAppeal.mockRejectedValue(new Error("Decision RPC resolve_appeal failed"));
    expect(
      (await POST(request({ appealId: APPEAL, status: "upheld", rationale: "Evidence holds" })))
        .status
    ).toBe(500);
  });
});
