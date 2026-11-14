import { beforeEach, describe, expect, it, vi } from "vitest";
import { staffGuard } from "@/test/staff-guard";

const { mockCreateAdminClient } = vi.hoisted(() => ({ mockCreateAdminClient: vi.fn() }));

vi.mock(
  "@/lib/auth/require-staff",
  async () => (await import("@/test/staff-guard")).staffGuardModule
);

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mockCreateAdminClient,
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));

import IntelligenceMarketplacePage from "@/app/admin/intelligence/marketplace/page";
import IntelligenceOperationsPage from "@/app/admin/intelligence/operations/page";
import IntelligenceRevenuePage from "@/app/admin/intelligence/revenue/page";
import IntelligenceTrendsPage from "@/app/admin/intelligence/trends/page";
import IntelligenceUsersPage from "@/app/admin/intelligence/users/page";
import IntelligenceVerificationPage from "@/app/admin/intelligence/verification/page";

const PAGES = [
  ["marketplace", IntelligenceMarketplacePage],
  ["operations", IntelligenceOperationsPage],
  ["revenue", IntelligenceRevenuePage],
  ["trends", IntelligenceTrendsPage],
  ["users", IntelligenceUsersPage],
  ["verification", IntelligenceVerificationPage],
] as const;

// Hidden until they work on the live backend (SHOW_STAFF_INTELLIGENCE): the
// pages read tables the live backend does not have.
describe("admin intelligence pages while hidden", () => {
  beforeEach(() => {
    staffGuard.reset();
    staffGuard.as("admin", "admin-1");
    vi.clearAllMocks();
  });

  it.each(PAGES)("%s sends staff to the staff home without reading anything", async (_, Page) => {
    await expect(Page()).rejects.toThrow("redirect:/admin");
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("bi:view");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });

  it.each(PAGES)("%s keeps its staff guard", async (_, Page) => {
    staffGuard.deny("capability");
    await expect(Page()).rejects.toThrow("redirect:/admin");
    expect(staffGuard.requireStaff).toHaveBeenCalledWith("bi:view");
    expect(mockCreateAdminClient).not.toHaveBeenCalled();
  });
});
