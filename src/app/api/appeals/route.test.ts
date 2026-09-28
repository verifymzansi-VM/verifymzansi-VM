import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";
import type * as DecisionLedger from "@/lib/services/decision-ledger";

const { getUser, submitAppeal, rateLimit, notifyStaff } = vi.hoisted(() => ({
  getUser: vi.fn(),
  submitAppeal: vi.fn(),
  rateLimit: vi.fn(),
  notifyStaff: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser } }) }));
vi.mock("@/lib/utils/rate-limit", () => ({ checkRateLimit: rateLimit }));
vi.mock("@/lib/utils/mutation-origin", () => ({ enforceSameOriginMutation: () => null }));
vi.mock("@/lib/utils/csrf", () => ({ enforceCsrfToken: () => null }));
vi.mock("@/lib/notifications", () => ({ notifyStaffForAdminEvent: notifyStaff }));
vi.mock("@/lib/services/decision-ledger", async (importOriginal) => ({
  ...(await importOriginal<typeof DecisionLedger>()),
  submitAppeal,
}));

import { POST } from "./route";

const MEMBER = "11111111-1111-4111-8111-111111111111";
const DECISION = "22222222-2222-4222-8222-222222222222";
const REASON = "I never posted this listing; my account was used without permission.";

const request = (body: unknown) =>
  new Request("https://verifymzansi.com/api/appeals", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as NextRequest;

describe("POST /api/appeals", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getUser.mockResolvedValue({ data: { user: { id: MEMBER, is_anonymous: false } } });
    rateLimit.mockResolvedValue({ limited: false });
    submitAppeal.mockResolvedValue({ ok: true, status: "submitted", appeal_id: "appeal-1" });
    notifyStaff.mockResolvedValue(true);
  });

  it("files the appeal for the signed-in member, never an id from the body", async () => {
    const res = await POST(
      request({ decisionId: DECISION, reason: REASON, userId: "someone-else" })
    );
    expect(res.status).toBe(201);
    expect(submitAppeal).toHaveBeenCalledWith(MEMBER, DECISION, REASON);
    expect(notifyStaff).toHaveBeenCalledWith(
      expect.objectContaining({
        capability: "appeal:decide",
        href: "/admin/governance/appeals/appeal-1",
      })
    );
  });

  it("requires sign-in", async () => {
    getUser.mockResolvedValue({ data: { user: null } });
    expect((await POST(request({ decisionId: DECISION, reason: REASON }))).status).toBe(401);
    expect(submitAppeal).not.toHaveBeenCalled();
  });

  it("rate-limits repeated attempts", async () => {
    rateLimit.mockResolvedValue({ limited: true, retryAfter: 60 });
    expect((await POST(request({ decisionId: DECISION, reason: REASON }))).status).toBe(429);
    expect(rateLimit).toHaveBeenCalledWith({
      key: MEMBER,
      action: "appeals:submit",
      degradedMode: "local",
    });
  });

  it("asks for a real explanation", async () => {
    expect((await POST(request({ decisionId: DECISION, reason: "unfair" }))).status).toBe(400);
    expect(submitAppeal).not.toHaveBeenCalled();
  });

  it.each([
    ["not_found", 404],
    ["appeal_open", 409],
    ["already_appealed", 409],
    ["not_appealable", 409],
  ])("maps the %s refusal to %i", async (error, status) => {
    submitAppeal.mockResolvedValue({ ok: false, error });
    expect((await POST(request({ decisionId: DECISION, reason: REASON }))).status).toBe(status);
    expect(notifyStaff).not.toHaveBeenCalled();
  });

  it("still succeeds when staff cannot be notified", async () => {
    notifyStaff.mockRejectedValue(new Error("down"));
    expect((await POST(request({ decisionId: DECISION, reason: REASON }))).status).toBe(201);
  });
});
