import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom, mockLogAuditEvent } = vi.hoisted(() => ({
  mockRpc: vi.fn(),
  mockFrom: vi.fn(),
  mockLogAuditEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mockRpc, from: mockFrom }),
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: mockLogAuditEvent }));

import {
  approveDecision,
  decisionRefusalResponse,
  escalateDecision,
  getPendingDecisions,
  liftRestriction,
  markDecisionExecution,
  moderateReport,
  rejectDecision,
  resolveAppeal,
  submitAppeal,
} from "@/lib/services/decision-ledger";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const DECISION = "22222222-2222-4222-8222-222222222222";

describe("decision ledger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockResolvedValue({ data: { ok: true, status: "applied" }, error: null });
  });

  it("passes the verified actor and inputs to each transactional RPC", async () => {
    await moderateReport(ACTOR, { reportId: DECISION, action: "ban", reason: "Scam" });
    expect(mockRpc).toHaveBeenLastCalledWith("moderate_report", {
      p_actor: ACTOR,
      p_report: DECISION,
      p_action: "ban",
      p_reason: "Scam",
      p_duration_days: null,
      p_emergency: false,
    });

    await approveDecision(ACTOR, DECISION, 3, "Looks right");
    expect(mockRpc).toHaveBeenLastCalledWith("approve_decision", {
      p_actor: ACTOR,
      p_decision: DECISION,
      p_payload_version: 3,
      p_note: "Looks right",
    });

    await rejectDecision(ACTOR, DECISION, "No");
    expect(mockRpc).toHaveBeenLastCalledWith("reject_decision", {
      p_actor: ACTOR,
      p_decision: DECISION,
      p_note: "No",
    });

    await liftRestriction(ACTOR, DECISION, "Served early");
    expect(mockRpc).toHaveBeenLastCalledWith("lift_restriction", {
      p_actor: ACTOR,
      p_restriction: DECISION,
      p_reason: "Served early",
    });

    await submitAppeal(ACTOR, DECISION, "I did not post this listing");
    expect(mockRpc).toHaveBeenLastCalledWith("submit_appeal", {
      p_user: ACTOR,
      p_decision: DECISION,
      p_reason: "I did not post this listing",
      p_evidence: [],
    });

    await resolveAppeal(
      ACTOR,
      DECISION,
      "partially_overturned",
      "Shorter is fair",
      "2026-10-01T00:00:00Z"
    );
    expect(mockRpc).toHaveBeenLastCalledWith("resolve_appeal", {
      p_actor: ACTOR,
      p_appeal: DECISION,
      p_outcome: "partially_overturned",
      p_rationale: "Shorter is fair",
      p_shorten_to: "2026-10-01T00:00:00Z",
    });
  });

  it("returns refusals from the database as data", async () => {
    mockRpc.mockResolvedValue({ data: { ok: false, error: "not_independent" }, error: null });
    await expect(approveDecision(ACTOR, DECISION, 1, "x")).resolves.toEqual({
      ok: false,
      error: "not_independent",
    });
  });

  it("throws on transport errors so routes return a 500", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "connection lost" } });
    await expect(
      moderateReport(ACTOR, { reportId: DECISION, action: "warn", reason: null })
    ).rejects.toThrow("Decision RPC moderate_report failed");
  });

  it("maps refusal codes to statuses and plain messages", async () => {
    const res = decisionRefusalResponse("not_independent");
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toMatchObject({ code: "not_independent" });
    expect(decisionRefusalResponse("expired").status).toBe(410);
    expect(decisionRefusalResponse("something_new").status).toBe(400);
  });

  it("records execution outcomes without throwing", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(markDecisionExecution(DECISION, false, "timeout")).resolves.toBeUndefined();
    expect(mockRpc).toHaveBeenCalledWith("mark_decision_execution", {
      p_decision: DECISION,
      p_ok: false,
      p_error: "timeout",
    });
  });

  it("escalates only pending, non-role decisions and audits it", async () => {
    const select = vi.fn().mockResolvedValue({ data: [{ id: DECISION }], error: null });
    const neq = vi.fn(() => ({ select }));
    const inFn = vi.fn(() => ({ neq }));
    const eq = vi.fn(() => ({ in: inFn }));
    const insert = vi.fn().mockResolvedValue({ error: null });
    mockFrom.mockImplementation((table: string) =>
      table === "decision_records" ? { update: vi.fn(() => ({ eq })) } : { insert }
    );

    await expect(
      escalateDecision({
        decisionId: DECISION,
        actorId: ACTOR,
        actorRole: "moderator",
        reason: "Unsure",
      })
    ).resolves.toEqual({ decisionId: DECISION, status: "escalated" });
    expect(neq).toHaveBeenCalledWith("case_type", "staff_role");
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ event_type: "escalated" }));
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "decision_escalated" })
    );
  });

  it("lists pending decisions without staff role changes", async () => {
    const limit = vi.fn().mockResolvedValue({ data: [{ id: DECISION }], error: null });
    const neq = vi.fn(() => ({ order: vi.fn(() => ({ limit })) }));
    mockFrom.mockReturnValue({ select: vi.fn(() => ({ in: vi.fn(() => ({ neq })) })) });

    await expect(getPendingDecisions(25)).resolves.toEqual([{ id: DECISION }]);
    expect(neq).toHaveBeenCalledWith("case_type", "staff_role");
    expect(limit).toHaveBeenCalledWith(25);
  });
});
