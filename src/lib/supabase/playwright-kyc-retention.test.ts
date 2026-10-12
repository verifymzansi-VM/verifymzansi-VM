// @vitest-environment node
import { describe, expect, it } from "vitest";

import { listPlaywrightTableRows, writePlaywrightTableRows } from "./playwright-fixture-store";

const DAY = 24 * 60 * 60 * 1000;
const deadlineOf = (id: string) =>
  listPlaywrightTableRows("kyc_artifacts").find((row) => row.id === id)?.purge_after;

describe("Playwright stub verified-KYC retention", () => {
  it("schedules a 30-day deadline when the final step is approved", () => {
    writePlaywrightTableRows("kyc_artifacts", [
      { id: "a-final", user_id: "u-final", purge_after: null, purged_at: null },
    ]);
    const steps = [
      { user_id: "u-final", step_type: "phone", status: "approved" },
      { user_id: "u-final", step_type: "location", status: "approved" },
      { user_id: "u-final", step_type: "id_doc", status: "approved", reviewed_at: "2026-10-12" },
      { user_id: "u-final", step_type: "selfie", status: "pending", reviewed_at: null },
    ];
    writePlaywrightTableRows("verification_steps", steps);
    expect(deadlineOf("a-final")).toBeNull();

    steps[3] = { ...steps[3], status: "approved", reviewed_at: "2026-10-12" };
    writePlaywrightTableRows("verification_steps", steps);
    const deadline = Date.parse(String(deadlineOf("a-final")));
    expect(deadline).toBeGreaterThan(Date.now() + 29 * DAY);
    expect(deadline).toBeLessThan(Date.now() + 31 * DAY);
  });

  it("schedules on a verified profile and never extends an existing deadline", () => {
    const existing = "2026-11-01T00:00:00.000Z";
    writePlaywrightTableRows("kyc_artifacts", [
      { id: "a-new", user_id: "u-profile", purge_after: null, purged_at: null },
      { id: "a-old", user_id: "u-profile", purge_after: existing, purged_at: null },
      { id: "a-other", user_id: "u-other", purge_after: null, purged_at: null },
    ]);
    writePlaywrightTableRows("account_profiles", [
      { user_id: "u-profile", account_verification_status: "verified" },
      { user_id: "u-other", account_verification_status: "incomplete" },
    ]);
    expect(deadlineOf("a-new")).toBeTruthy();
    expect(deadlineOf("a-old")).toBe(existing);
    expect(deadlineOf("a-other")).toBeNull();
  });
});
