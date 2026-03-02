import { describe, it, expect, vi, beforeEach } from "vitest";

const mockUpsert = vi.fn().mockResolvedValue({ error: null });
const mockSelect = vi.fn();
const mockEq = vi.fn();

const mockFrom = vi.fn().mockImplementation((table: string) => {
  if (table === "consent_records") {
    return {
      upsert: mockUpsert,
      select: mockSelect.mockReturnValue({
        eq: mockEq,
      }),
    };
  }
  // Audit logs table
  return { insert: vi.fn().mockResolvedValue({ error: null }) };
});

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mockFrom,
  }),
}));

// Mock audit to avoid side-effects
vi.mock("./audit", () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

import { updateConsent, getConsents } from "./consent";

describe("consent service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("updateConsent", () => {
    it("upserts consent record with correct data", async () => {
      await updateConsent({
        userId: "user-1",
        purpose: "marketing_email",
        granted: true,
      });

      expect(mockFrom).toHaveBeenCalledWith("consent_records");
      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          user_id: "user-1",
          purpose: "marketing_email",
          granted: true,
        }),
        { onConflict: "user_id,purpose" }
      );
    });

    it("logs audit event after updating consent", async () => {
      const { logAuditEvent } = await import("./audit");

      await updateConsent({
        userId: "user-2",
        purpose: "analytics",
        granted: false,
      });

      expect(logAuditEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          actorId: "user-2",
          action: "consent_updated",
          metadata: { purpose: "analytics", granted: false },
        })
      );
    });
  });

  describe("getConsents", () => {
    it("returns defaults when no records exist", async () => {
      mockEq.mockResolvedValue({ data: null });

      const consents = await getConsents("user-3");

      expect(consents).toEqual({
        marketing_email: false,
        marketing_sms: false,
        data_processing: false,
        third_party_sharing: false,
        analytics: false,
      });
    });

    it("merges stored records over defaults", async () => {
      mockEq.mockResolvedValue({
        data: [
          { purpose: "marketing_email", granted: true },
          { purpose: "data_processing", granted: false },
        ],
      });

      const consents = await getConsents("user-4");

      expect(consents.marketing_email).toBe(true);
      expect(consents.data_processing).toBe(false);
      // Unchanged defaults
      expect(consents.marketing_sms).toBe(false);
      expect(consents.analytics).toBe(false);
    });
  });
});
