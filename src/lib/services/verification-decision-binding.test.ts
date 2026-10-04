// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { createPlaywrightStubSupabaseClient } from "@/lib/supabase/playwright-stub";
import {
  listPlaywrightTableRows,
  writePlaywrightTableRows,
} from "@/lib/supabase/playwright-fixture-store";

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => createPlaywrightStubSupabaseClient(),
}));
vi.mock("@/lib/services/audit", () => ({ logAuditEvent: vi.fn() }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn() }));
vi.mock("@/lib/supabase/auth-admin-user", () => ({
  getAuthAdminUserSummary: vi.fn(async () => ({ email: null })),
}));

import { applyVerificationDecision } from "./verification-decision";

const reviewedVersion = "2026-10-04T08:00:00.123456Z";
function fixture(status = "pending", appliedDecision?: string) {
  const step = {
    id: crypto.randomUUID(),
    user_id: crypto.randomUUID(),
    step_type: "selfie",
    status,
    updated_at: reviewedVersion,
    override_decision_id: appliedDecision ?? null,
  };
  writePlaywrightTableRows("verification_steps", [
    ...listPlaywrightTableRows("verification_steps"),
    step,
  ]);
  return step;
}
function decide(step: ReturnType<typeof fixture>, decisionId: string, retry = false) {
  return applyVerificationDecision({
    step,
    decision: "approved",
    reviewerId: crypto.randomUUID(),
    reviewerRole: "governance_controller",
    overrideDecisionId: decisionId,
    expectedSubmissionUpdatedAt: reviewedVersion,
    allowAlreadyApplied: retry,
  });
}

describe("KYC override submission binding", () => {
  it("pins the original version at the final write, even when a fresh row is read", async () => {
    const step = fixture();
    step.updated_at = "2026-10-04T08:00:00.123457Z";
    writePlaywrightTableRows(
      "verification_steps",
      listPlaywrightTableRows("verification_steps").map((row) => (row.id === step.id ? step : row))
    );
    const result = await decide(step, crypto.randomUUID());
    expect(result).toMatchObject({ ok: false, status: 409 });
    expect(
      listPlaywrightTableRows("verification_steps").find((row) => row.id === step.id)?.status
    ).toBe("pending");
  });
  it("records the approving decision on the exact accepted submission", async () => {
    const step = fixture();
    const decisionId = crypto.randomUUID();
    expect(await decide(step, decisionId)).toEqual({ ok: true });
    expect(
      listPlaywrightTableRows("verification_steps").find((row) => row.id === step.id)
    ).toMatchObject({ status: "approved", override_decision_id: decisionId });
  });
  it("continues a partial execution only for the same applied decision", async () => {
    const decisionId = crypto.randomUUID();
    const step = fixture("approved", decisionId);
    expect(await decide(step, decisionId, true)).toEqual({ ok: true });
    expect(await decide(step, crypto.randomUUID(), true)).toMatchObject({ ok: false, status: 409 });
  });
  it("rechecks the stored approval rather than trusting an outdated caller row", async () => {
    const decisionId = crypto.randomUUID();
    const step = fixture("approved", decisionId);
    writePlaywrightTableRows(
      "verification_steps",
      listPlaywrightTableRows("verification_steps").map((row) =>
        row.id === step.id ? { ...row, status: "pending", updated_at: "2026-10-04T09:00:00Z" } : row
      )
    );
    expect(await decide(step, decisionId, true)).toMatchObject({ ok: false, status: 409 });
  });
  it("refuses legacy retry requests with no original submission version", async () => {
    const step = fixture("approved");
    expect(
      await applyVerificationDecision({
        step,
        decision: "approved",
        reviewerId: crypto.randomUUID(),
        reviewerRole: "admin",
        allowAlreadyApplied: true,
      })
    ).toMatchObject({ ok: false, code: "step_changed" });
  });
});
