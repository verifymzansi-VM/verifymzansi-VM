import { isValidElement } from "react";
import { beforeEach, expect, it, vi } from "vitest";
import ModerationPage from "@/app/admin/moderation/page";
import ReportsPage from "@/app/admin/reports/page";
import { FoundationModerationQueue } from "@/components/foundation/moderation-queue";

const entry = vi.hoisted(() => ({ staff: vi.fn(), legacy: vi.fn() }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: entry.staff }));
vi.mock("@/lib/data-backend", () => ({ getDataBackend: () => "foundation" }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: entry.legacy }));
vi.mock("next/navigation", () => ({
  redirect: (destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  entry.legacy.mockImplementation(() => {
    throw new Error("Retired tables accessed");
  });
});
for (const [page, capability, mode] of [
  [ModerationPage, "post:moderate", "content"],
  [ReportsPage, "report:resolve", "reports"],
] as const) {
  it(`${mode}: a presentation role or partial assignment cannot open the native desk`, async () => {
    for (const assignedCapabilities of [undefined, [], [capability], ["queue:claim"]]) {
      entry.staff.mockResolvedValue({
        role: "admin",
        user: { id: "synthetic" },
        assignedCapabilities,
      });
      await expect(page()).rejects.toThrow("REDIRECT:/admin");
    }
    expect(entry.legacy).not.toHaveBeenCalled();
  });
  it(`${mode}: current assignments reach the native viewer without querying retired tables`, async () => {
    entry.staff.mockResolvedValue({
      role: "moderator",
      user: { id: "synthetic" },
      assignedCapabilities: ["queue:claim", capability],
    });
    const result = await page();
    expect(isValidElement(result) && result.type === FoundationModerationQueue).toBe(true);
    expect(entry.staff).toHaveBeenCalledWith("queue:view");
    expect(entry.legacy).not.toHaveBeenCalled();
  });
}
