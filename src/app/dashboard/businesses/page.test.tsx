import { describe, expect, it, vi } from "vitest";
import { redirect } from "next/navigation";
import BusinessesPage from "./page";

vi.mock("next/navigation", () => ({
  redirect: vi.fn(),
}));

describe("Dashboard businesses page", () => {
  it("redirects to the unified My Posts page filtered by MZANSI_BUSINESS", () => {
    BusinessesPage();
    expect(redirect).toHaveBeenCalledWith("/dashboard/listings?area=MZANSI_BUSINESS");
  });
});
