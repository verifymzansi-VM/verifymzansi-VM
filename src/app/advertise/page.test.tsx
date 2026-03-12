import { beforeEach, describe, expect, it, vi } from "vitest";
import AdvertisePage from "./page";

const permanentRedirect = vi.fn();

vi.mock("next/navigation", () => ({
  permanentRedirect: (url: string) => permanentRedirect(url),
}));

describe("AdvertisePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("permanently redirects to promotions", () => {
    AdvertisePage();

    expect(permanentRedirect).toHaveBeenCalledWith("/promotions");
  });
});
