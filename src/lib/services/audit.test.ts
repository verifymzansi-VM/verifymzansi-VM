import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the admin client before importing the module
const mockInsert = vi.fn().mockResolvedValue({ error: null });
const mockFrom = vi.fn().mockReturnValue({ insert: mockInsert });

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

import { logAuditEvent } from "./audit";

describe("audit service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("inserts audit log entry with correct fields", async () => {
    await logAuditEvent({
      actorId: "user-123",
      actorRole: "admin",
      action: "user_login",
      targetType: "session",
      targetId: "sess-456",
      metadata: { browser: "Chrome" },
    });

    expect(mockFrom).toHaveBeenCalledWith("audit_logs");
    expect(mockInsert).toHaveBeenCalledWith({
      actor_id: "user-123",
      actor_role: "admin",
      action: "user_login",
      target_type: "session",
      target_id: "sess-456",
      area: null,
      metadata: { browser: "Chrome" },
    });
  });

  it("defaults metadata to empty object when not provided", async () => {
    await logAuditEvent({
      actorId: "user-123",
      action: "user_registered",
    });

    expect(mockInsert).toHaveBeenCalledWith(expect.objectContaining({ metadata: {} }));
  });

  it("does not throw when insert fails", async () => {
    mockInsert.mockRejectedValueOnce(new Error("DB Error"));

    // Should not throw
    await expect(
      logAuditEvent({
        actorId: "user-123",
        action: "user_login",
      })
    ).resolves.toBeUndefined();
  });

  it("logs to console.error on failure", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockRejectedValueOnce(new Error("DB Error"));

    await logAuditEvent({ actorId: "u1", action: "user_login" });

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining("Audit log exception (POPIA compliance risk)")
    );
    consoleSpy.mockRestore();
  });
});
