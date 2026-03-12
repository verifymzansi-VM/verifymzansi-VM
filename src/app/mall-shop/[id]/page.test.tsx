import { describe, expect, it, vi } from "vitest";
import Page from "./page";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((target: string) => {
    throw new Error(`redirect:${target}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("mall-shop/[id] page", () => {
  it("redirects legacy mall shop detail URLs to the business detail page", async () => {
    await expect(Page({ params: Promise.resolve({ id: "business-1" }) })).rejects.toThrow(
      "redirect:/mzansi-business/business-1"
    );
    expect(redirectMock).toHaveBeenCalledWith("/mzansi-business/business-1");
  });
});
