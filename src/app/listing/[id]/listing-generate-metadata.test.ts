import { beforeEach, describe, expect, it, vi } from "vitest";

const { restoredListingDetail } = vi.hoisted(() => ({ restoredListingDetail: vi.fn() }));

// The public listing read returns only live, visible listings (null otherwise).
vi.mock("@/lib/foundation/marketplace-server", () => ({
  restoredListingDetail,
  restoredPublicDetail: vi.fn(),
}));

// next/navigation — notFound() throws in Next.js; use a spy here
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { generateMetadata } from "./page";

function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("generateMetadata", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("happy path: returns title and description for a live listing", async () => {
    restoredListingDetail.mockResolvedValueOnce({
      title: "Red bicycle",
      description: "Great condition",
    });

    const meta = await generateMetadata(makeParams("live-listing-id"));

    expect(restoredListingDetail).toHaveBeenCalledWith("live-listing-id");
    expect(meta.title).toContain("Red bicycle");
    expect(meta.description).toContain("Great condition");
  });

  it("edge case: returns fallback metadata when the listing is not public", async () => {
    restoredListingDetail.mockResolvedValueOnce(null);

    const meta = await generateMetadata(makeParams("pending-listing-id"));

    // Must NOT expose any private data — just a safe fallback title
    expect(meta.title).toBe("Listing Not Found");
    expect(meta.description).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain("secret");
  });

  it("edge case: description is sliced to 160 chars", async () => {
    restoredListingDetail.mockResolvedValueOnce({ title: "Title", description: "A".repeat(300) });

    const meta = await generateMetadata(makeParams("live-long-desc"));

    expect((meta.description as string).length).toBeLessThanOrEqual(160);
  });
});
