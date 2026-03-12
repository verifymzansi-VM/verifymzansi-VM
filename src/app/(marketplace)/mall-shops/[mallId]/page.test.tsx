import { describe, expect, it, vi } from "vitest";
import Page from "./page";

const { notFoundMock } = vi.hoisted(() => ({
  notFoundMock: vi.fn(() => {
    throw new Error("notFound");
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: notFoundMock,
}));

describe("mall-shops/[mallId] page", () => {
  it("returns notFound for legacy mall landing pages", async () => {
    await expect(Page({ params: Promise.resolve({ mallId: "mall-1" }) })).rejects.toThrow(
      "notFound"
    );
    expect(notFoundMock).toHaveBeenCalled();
  });
});
