import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateAdminClient, mockLogAuditEvent, mockLoggerError } = vi.hoisted(() => ({
  mockCreateAdminClient: vi.fn(),
  mockLogAuditEvent: vi.fn().mockResolvedValue(undefined),
  mockLoggerError: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("@/lib/services/audit", () => ({
  logAuditEvent: mockLogAuditEvent,
}));

vi.mock("@/lib/utils/logger", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: mockLoggerError,
  }),
}));

import {
  approveDecision,
  createAppeal,
  createDecisionRecord,
  getPendingDecisions,
  recordRoleChange,
  rejectDecision,
  resolveAppeal,
} from "@/lib/services/decision-ledger";

function createEqSingle(data: unknown, error: unknown = null) {
  return vi.fn().mockReturnValue({
    single: vi.fn().mockResolvedValue({ data, error }),
  });
}

describe("decision-ledger service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a decision record and appends an event plus audit entry", async () => {
    const decisionInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({
          data: { id: "decision-1", correlation_id: "corr-1" },
          error: null,
        }),
      }),
    });
    const eventInsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "decision_records") {
          return { insert: decisionInsert };
        }
        if (table === "decision_record_events") {
          return { insert: eventInsert };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const result = await createDecisionRecord({
      caseType: "report",
      caseId: "report-1",
      actionCategory: "account_suspend",
      recommenderId: "mod-1",
      recommenderRole: "moderator",
      recommendation: "suspend",
      rationale: "Clear fraud pattern",
      evidenceRefs: ["report-1"],
      beforeState: { status: "open" },
    });

    expect(result).toEqual({ id: "decision-1", correlation_id: "corr-1" });
    expect(decisionInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        case_type: "report",
        case_id: "report-1",
        action_category: "account_suspend",
        status: "pending_approval",
      })
    );
    expect(eventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_id: "decision-1",
        actor_id: "mod-1",
        actor_role: "moderator",
        event_type: "recommended",
      })
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "mod-1",
        actorRole: "moderator",
        action: "decision_recommended",
      })
    );
  });

  it("approves a pending decision and records the approval event", async () => {
    const updateEq = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: "decision-1" }], error: null }),
      }),
    });
    const eventInsert = vi.fn().mockResolvedValue({ error: null });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "decision_records") {
          return {
            select: vi.fn().mockReturnValue({
              eq: createEqSingle({
                id: "decision-1",
                status: "pending_approval",
                case_type: "report",
                case_id: "report-1",
                recommender_id: "mod-1",
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: updateEq }),
          };
        }
        if (table === "decision_record_events") {
          return { insert: eventInsert };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const result = await approveDecision({
      decisionId: "decision-1",
      approverId: "gov-1",
      approverRole: "governance_controller",
      rationale: "Meets approval threshold",
      afterState: { account_status: "suspended" },
    });

    expect(result).toEqual({ decisionId: "decision-1", status: "approved" });
    expect(updateEq).toHaveBeenCalledWith("id", "decision-1");
    expect(eventInsert).toHaveBeenCalledWith(
      expect.objectContaining({
        decision_id: "decision-1",
        event_type: "approved",
      })
    );
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "decision_approved",
        actorRole: "governance_controller",
      })
    );
  });

  it("returns null when rejecting an already-finalized decision", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn(() => ({
        select: vi.fn().mockReturnValue({
          eq: createEqSingle({
            id: "decision-1",
            status: "approved",
            case_type: "report",
            case_id: "report-1",
          }),
        }),
        update: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            in: vi.fn().mockReturnValue({
              select: vi.fn().mockResolvedValue({ data: [], error: null }),
            }),
          }),
        }),
      })),
    });

    const result = await rejectDecision({
      decisionId: "decision-1",
      approverId: "gov-1",
      approverRole: "governance_controller",
      rationale: "Late rejection",
    });

    expect(result).toBeNull();
  });

  it("creates an appeal and audits the submission", async () => {
    const decisionUpdateEq = vi.fn().mockResolvedValue({ error: null });
    const appealInsert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        single: vi.fn().mockResolvedValue({ data: { id: "appeal-1" }, error: null }),
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "decision_records") {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                single: vi.fn().mockResolvedValue({
                  data: { id: "decision-1", parent_decision_id: null },
                  error: null,
                }),
              }),
            }),
            update: vi.fn().mockReturnValue({ eq: decisionUpdateEq }),
          };
        }
        if (table === "appeal_cases") {
          return { insert: appealInsert };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const result = await createAppeal({
      decisionId: "decision-1",
      appellantId: "user-1",
      reason: "New supporting evidence",
      evidenceRefs: ["artifact-1"],
    });

    expect(result).toEqual({ id: "appeal-1" });
    expect(decisionUpdateEq).toHaveBeenCalledWith("id", "decision-1");
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "user-1",
        actorRole: "member",
        action: "appeal_submitted",
      })
    );
  });

  it("resolves an appeal and writes the correct audit action", async () => {
    const updateEq = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        select: vi.fn().mockResolvedValue({ data: [{ id: "appeal-1" }], error: null }),
      }),
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "appeal_cases") {
          return { update: vi.fn().mockReturnValue({ eq: updateEq }) };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const result = await resolveAppeal({
      appealId: "appeal-1",
      reviewerId: "gov-1",
      reviewerRole: "governance_controller",
      status: "upheld",
      rationale: "Original decision stands",
      outcomeDetail: { note: "confirmed" },
    });

    expect(result).toEqual({ appealId: "appeal-1", status: "upheld" });
    expect(updateEq).toHaveBeenCalledWith("id", "appeal-1");
    expect(mockLogAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "gov-1",
        action: "appeal_upheld",
      })
    );
  });

  it("records role changes and throws when history insert fails", async () => {
    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "role_assignments_history") {
          return {
            insert: vi.fn().mockResolvedValue({ error: { message: "insert failed" } }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    await expect(
      recordRoleChange({
        targetUserId: "user-1",
        previousRole: "moderator",
        newRole: "governance_controller",
        assignedBy: "admin-1",
        assignerRole: "admin",
        reason: "Promotion",
      })
    ).rejects.toThrow("Failed to record role change");

    expect(mockLoggerError).toHaveBeenCalledWith(
      "Failed to record role change",
      expect.objectContaining({ error: "insert failed" })
    );
  });

  it("fetches pending decisions ordered by status set", async () => {
    const limit = vi.fn().mockResolvedValue({
      data: [{ id: "decision-1", status: "pending_approval" }],
      error: null,
    });

    mockCreateAdminClient.mockReturnValue({
      from: vi.fn((table: string) => {
        if (table === "decision_records") {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockReturnValue({
                order: vi.fn().mockReturnValue({
                  limit,
                }),
              }),
            }),
          };
        }
        throw new Error(`Unexpected table ${table}`);
      }),
    });

    const result = await getPendingDecisions(25);

    expect(result).toEqual([{ id: "decision-1", status: "pending_approval" }]);
    expect(limit).toHaveBeenCalledWith(25);
  });
});
