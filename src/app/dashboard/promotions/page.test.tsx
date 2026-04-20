import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Dashboard promotions page", () => {
  it("redirects legacy dashboard promotions URLs to the canonical tourism dashboard route", async () => {
    const { default: PromotionsPage } = await import("@/app/dashboard/promotions/page");
    await PromotionsPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard/tourism-events");
  });
});
