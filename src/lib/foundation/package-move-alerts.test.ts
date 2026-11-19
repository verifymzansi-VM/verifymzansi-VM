/** @vitest-environment node */
import { afterEach, describe, expect, it, vi } from "vitest";

const { sendStaffOperationsEmail } = vi.hoisted(() => ({
  sendStaffOperationsEmail: vi.fn(async () => ({ success: true })),
}));
vi.mock("server-only", () => ({}));
vi.mock("../services/email", () => ({ sendStaffOperationsEmail }));

import { emailPackageMoveAlert, readPackageMoves } from "./package-move-alerts";

const move = {
  package_id: "11111111-1111-4111-8111-111111111111",
  post_id: "22222222-2222-4222-8222-222222222222",
  direction: "out_of_package" as const,
  tries: 3,
  first_failed_at: "2026-11-19T10:02:00.000Z",
  reason: "error P0001",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("package move alerts", () => {
  it("returns only the moves not reported before, and nothing from an earlier database", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(readPackageMoves({ package_stuck: 2, package_stuck_moves: [move] })).toEqual([move]);
    expect(readPackageMoves({ package_stuck: 2, package_stuck_moves: [] })).toEqual([]);
    expect(readPackageMoves({ moved: 0 })).toEqual([]);
    expect(readPackageMoves({ package_stuck_moves: [{ ...move, reason: "nope" }] })).toEqual([]);
    vi.restoreAllMocks();
  });

  it("emails the payment alert addresses with ids only, and reports failure without them", async () => {
    vi.stubEnv("PAYMENT_ALERT_EMAILS", "");
    await expect(emailPackageMoveAlert([move])).resolves.toEqual({ success: false });
    expect(sendStaffOperationsEmail).not.toHaveBeenCalled();
    vi.stubEnv("PAYMENT_ALERT_EMAILS", "ops@example.test");
    await expect(emailPackageMoveAlert([move])).resolves.toEqual({ success: true });
    expect(sendStaffOperationsEmail).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        to: ["ops@example.test"],
        subject: "VerifyMzansi: a package move is stuck",
        sections: [
          {
            heading: "Post could not move out of the package",
            rows: [
              ["Package", move.package_id],
              ["Post", move.post_id],
              ["Tries", "3"],
              ["Failing since", move.first_failed_at],
              ["Reason", "error P0001"],
            ],
          },
        ],
      })
    );
  });
});
