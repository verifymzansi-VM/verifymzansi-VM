import { beforeEach, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { FoundationVerificationDesk } from "./verification-desk";
const { staff } = vi.hoisted(() => ({ staff: vi.fn() }));
vi.mock("@/lib/auth/require-staff", () => ({ requireStaff: staff }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error("REDIRECT:" + url);
  },
}));
vi.mock("./verification-review", () => ({
  FoundationVerificationReview: () => <p>Native encrypted evidence review</p>,
}));
beforeEach(() => vi.clearAllMocks());
it("opens the native evidence protocol for an explicitly assigned reviewer", async () => {
  staff.mockResolvedValue({ assignedCapabilities: ["queue:view", "case:claim", "evidence:view"] });
  render(await FoundationVerificationDesk());
  expect(screen.getByText("Native encrypted evidence review")).toBeInTheDocument();
  expect(staff).toHaveBeenCalledWith("queue:view");
});
it.each([
  { assigned: [] },
  { assigned: ["queue:view"] },
  { assigned: ["queue:view", "case:claim"] },
])("refuses an admin label without native evidence assignments: %j", async ({ assigned }) => {
  staff.mockResolvedValue({ role: "admin", assignedCapabilities: assigned });
  await expect(FoundationVerificationDesk()).rejects.toThrow("/error?reason=forbidden");
});
it("does not fall back to the source evidence desk or flags when native staff verification fails", async () => {
  staff.mockRejectedValue(new Error("Staff session unavailable"));
  await expect(FoundationVerificationDesk()).rejects.toThrow("Staff session unavailable");
});
