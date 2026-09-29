import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as DecisionLedger from "@/lib/services/decision-ledger";

const { guard, moderateReport, rateLimit } = vi.hoisted(() => ({
  guard: vi.fn(),
  moderateReport: vi.fn(),
  rateLimit: vi.fn(),
}));

vi.mock("@/lib/utils/admin-route-guard", () => ({ enforceAdminMutationGuard: guard }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkSensitiveActionRateLimit: rateLimit }));
vi.mock("@/lib/services/decision-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof DecisionLedger>()),
  moderateReport,
}));

import { POST } from "@/app/api/admin/flagging/action/route";
import { checkQueueClaim, releaseDecidedClaim } from "@/lib/services/queue-claims";

const STAFF = "11111111-1111-4111-8111-111111111111";
const REPORT = "22222222-2222-4222-8222-222222222222";

const request = (body: Record<string, unknown>) =>
  new Request("https://verifymzansi.com/api/admin/flagging/action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/admin/flagging/action", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    guard.mockResolvedValue({ success: true, user: { id: STAFF }, actorRole: "moderator" });
    rateLimit.mockResolvedValue({ limited: false });
    moderateReport.mockResolvedValue({ ok: true, status: "applied", decision_id: "d-1" });
  });

  it("returns the guard's refusal before doing anything", async () => {
    guard.mockResolvedValue({ success: false, response: new Response(null, { status: 403 }) });
    expect((await POST(request({ reportId: REPORT, action: "warn" }))).status).toBe(403);
    expect(moderateReport).not.toHaveBeenCalled();
  });

  it("passes the verified actor, never an id from the body", async () => {
    await POST(request({ reportId: REPORT, action: "warn", reason: "Rude", actorId: "attacker" }));
    expect(moderateReport).toHaveBeenCalledWith(STAFF, {
      reportId: REPORT,
      action: "warn",
      reason: "Rude",
      durationDays: null,
      emergency: false,
    });
  });

  it("reports a ban proposal as waiting for approval", async () => {
    moderateReport.mockResolvedValue({ ok: true, status: "proposed", decision_id: "d-2" });
    const res = await POST(request({ reportId: REPORT, action: "ban", reason: "Fraud" }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({
      status: "proposed",
      decisionId: "d-2",
      message: expect.stringContaining("approval"),
    });
  });

  it("passes emergency containment through and returns the review decision", async () => {
    moderateReport.mockResolvedValue({
      ok: true,
      status: "emergency_applied",
      decision_id: "d-3",
      review_decision_id: "d-4",
    });
    const res = await POST(
      request({
        reportId: REPORT,
        action: "suspend",
        durationDays: 14,
        emergency: true,
        reason: "Live fraud",
      })
    );
    expect(moderateReport).toHaveBeenCalledWith(
      STAFF,
      expect.objectContaining({ emergency: true, durationDays: 14 })
    );
    await expect(res.json()).resolves.toMatchObject({ reviewDecisionId: "d-4" });
  });

  it("fails closed on bans and suspensions when the shared limiter refuses", async () => {
    rateLimit.mockResolvedValue({ limited: true, retryAfter: 30 });
    expect((await POST(request({ reportId: REPORT, action: "ban", reason: "Fraud" }))).status).toBe(
      429
    );
    expect(rateLimit).toHaveBeenCalledWith(STAFF, "admin:flagging:enforce");
    expect(moderateReport).not.toHaveBeenCalled();
  });

  it("does not rate-limit dismissals through the sensitive limiter", async () => {
    await POST(request({ reportId: REPORT, action: "dismiss", reason: "Not a breach" }));
    expect(rateLimit).not.toHaveBeenCalled();
  });

  it.each([
    ["not_independent", 403],
    ["already_actioned", 409],
    ["forbidden", 403],
    ["target_missing", 404],
    ["unmappable_hide_target", 422],
  ])("maps the %s refusal to %i", async (error, status) => {
    moderateReport.mockResolvedValue({ ok: false, error });
    const res = await POST(request({ reportId: REPORT, action: "hide" }));
    expect(res.status).toBe(status);
    await expect(res.json()).resolves.toMatchObject({ code: error });
  });

  it("validates the body before calling the database", async () => {
    expect((await POST(request({ reportId: REPORT, action: "dismiss" }))).status).toBe(400);
    expect((await POST(request({ reportId: REPORT, action: "suspend", reason: "x" }))).status).toBe(
      400
    );
    expect(
      (await POST(request({ reportId: REPORT, action: "suspend", durationDays: 45, reason: "x" })))
        .status
    ).toBe(400);
    expect(
      (await POST(request({ reportId: REPORT, action: "warn", emergency: true, reason: "x" })))
        .status
    ).toBe(400);
    expect(moderateReport).not.toHaveBeenCalled();
  });

  it("hides database failures behind a 500", async () => {
    moderateReport.mockRejectedValue(new Error("Decision RPC moderate_report failed"));
    const res = await POST(request({ reportId: REPORT, action: "warn" }));
    expect(res.status).toBe(500);
    expect(await res.text()).not.toContain("moderate_report");
  });

  it("requires the moderator's claim on the report, and releases it afterwards", async () => {
    await POST(request({ reportId: REPORT, action: "warn", reason: "Rude" }));
    expect(checkQueueClaim).toHaveBeenCalledWith(STAFF, { type: "report", id: REPORT });
    expect(releaseDecidedClaim).toHaveBeenCalledWith(STAFF, { type: "report", id: REPORT });
  });

  it("stops before acting when someone else holds the report", async () => {
    vi.mocked(checkQueueClaim).mockResolvedValueOnce(
      new Response(JSON.stringify({ code: "claimed_by_other" }), { status: 409 }) as never
    );
    const res = await POST(request({ reportId: REPORT, action: "warn", reason: "Rude" }));
    expect(res.status).toBe(409);
    expect(moderateReport).not.toHaveBeenCalled();
  });
});
