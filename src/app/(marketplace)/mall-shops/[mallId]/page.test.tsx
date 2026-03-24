import { describe, expect, it, vi } from "vitest";
import Page from "./page";

const { redirectMock } = vi.hoisted(() => ({
  redirectMock: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

describe("mall-shops/[mallId] page", () => {
  it("redirects to mzansi-business detail page", async () => {
    await expect(Page({ params: Promise.resolve({ mallId: "mall-1" }) })).rejects.toThrow(
      "redirect:/mzansi-business/mall-1"
    );
    expect(redirectMock).toHaveBeenCalledWith("/mzansi-business/mall-1");
  });
});
