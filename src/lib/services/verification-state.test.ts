import { describe, it, expect } from "vitest";
import {
  buildVerificationStep,
  buildPendingVerificationStep,
  buildVerificationSessionResumePatch,
} from "./verification-state";

describe("buildVerificationStep", () => {
  const baseStep = {
    user_id: "user-1",
    step_type: "identity",
    submitted_at: "2026-01-01T00:00:00Z",
  };

  it("defaults to pending status", () => {
    const result = buildVerificationStep(baseStep);
    expect(result.status).toBe("pending");
  });

  it("allows explicit approved status", () => {
    const result = buildVerificationStep(baseStep, "approved");
    expect(result.status).toBe("approved");
  });

  it("nullifies review fields", () => {
    const stepWithReviewData = {
      ...baseStep,
      reviewed_by: "admin-1",
      reviewed_at: "2026-01-02T00:00:00Z",
      reason_code: "R001",
      reason_note: "Previously rejected",
      override_reason_code: "OR001",
    };
    const result = buildVerificationStep(stepWithReviewData) as Record<string, unknown>;

    expect(result.reviewed_by).toBeNull();
    expect(result.reviewed_at).toBeNull();
    expect(result.reason_code).toBeNull();
    expect(result.reason_note).toBeNull();
    expect(result.override_reason_code).toBeNull();
  });

  it("preserves other fields from the input", () => {
    const result = buildVerificationStep(baseStep);
    expect(result.user_id).toBe("user-1");
    expect(result.step_type).toBe("identity");
    expect(result.submitted_at).toBe("2026-01-01T00:00:00Z");
  });
});

describe("buildPendingVerificationStep", () => {
  it("delegates to buildVerificationStep with pending status", () => {
    const result = buildPendingVerificationStep({
      user_id: "user-2",
      step_type: "location",
    });
    expect(result.status).toBe("pending");
    expect(result.reviewed_by).toBeNull();
  });
});

describe("buildVerificationSessionResumePatch", () => {
  it("sets user_id and finalized_at correctly", () => {
    const patch = { some_field: "value", other: 42 };
    const result = buildVerificationSessionResumePatch("user-3", patch);

    expect(result.user_id).toBe("user-3");
    expect(result.finalized_at).toBeNull();
    expect(result.some_field).toBe("value");
    expect(result.other).toBe(42);
  });

  it("prevents caller from overriding user_id via patch", () => {
    const patch = { user_id: "attacker-id" };
    const result = buildVerificationSessionResumePatch("real-user", patch);
    expect(result.user_id).toBe("real-user");
  });

  it("prevents caller from overriding finalized_at via patch", () => {
    const patch = { finalized_at: "2026-01-01T00:00:00Z" };
    const result = buildVerificationSessionResumePatch("user-4", patch) as Record<string, unknown>;
    expect(result.finalized_at).toBeNull();
  });
});
