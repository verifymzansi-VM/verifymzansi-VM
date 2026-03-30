import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Dashboard promotions page", () => {
  it("redirects to the unified My Posts page filtered by PROMOTIONS_EVENTS", async () => {
    const { default: PromotionsPage } = await import("@/app/dashboard/promotions/page");
    await PromotionsPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard/listings?area=PROMOTIONS_EVENTS");
  });
});
