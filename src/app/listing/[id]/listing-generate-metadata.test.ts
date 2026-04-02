import { beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — hoisted so they are available inside the vi.mock() factory
// ---------------------------------------------------------------------------
const { mockFrom, mockSelect, mockEqId, mockEqStatus, mockSingle } = vi.hoisted(() => {
  const mockSingle = vi.fn();
  const mockEqStatus = vi.fn().mockReturnValue({ single: mockSingle });
  const mockEqId = vi.fn().mockReturnValue({ eq: mockEqStatus });
  const mockSelect = vi.fn().mockReturnValue({ eq: mockEqId });
  const mockFrom = vi.fn().mockReturnValue({ select: mockSelect });
  return { mockFrom, mockSelect, mockEqId, mockEqStatus, mockSingle };
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}));

// next/navigation — notFound() throws in Next.js; use a spy here
vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

import { generateMetadata } from "./page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeParams(id: string) {
  return { params: Promise.resolve({ id }) };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("generateMetadata — status filter (B1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockFrom.mockReturnValue({ select: mockSelect });
    mockSelect.mockReturnValue({ eq: mockEqId });
    mockEqId.mockReturnValue({ eq: mockEqStatus });
    mockEqStatus.mockReturnValue({ single: mockSingle });
  });

  it("happy path: returns title and description for a live listing", async () => {
    mockSingle.mockResolvedValueOnce({
      data: { title: "Red bicycle", description: "Great condition" },
      error: null,
    });

    const meta = await generateMetadata(makeParams("live-listing-id"));

    expect(meta.title).toContain("Red bicycle");
    expect(meta.description).toContain("Great condition");
  });

  it("passes status=live as the second .eq() filter (not just id)", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    await generateMetadata(makeParams("some-id"));

    // The chain: .eq("id", ...) → .eq("status", "live") → .single()
    // Verify the second .eq call uses "status" and "live"
    expect(mockEqStatus).toHaveBeenCalledWith("status", "live");
  });

  it("edge case: returns fallback metadata when listing is not live (null data)", async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: null });

    const meta = await generateMetadata(makeParams("pending-listing-id"));

    // Must NOT expose any private data — just a safe fallback title
    expect(meta.title).toBe("Listing Not Found");
    expect(meta.description).toBeUndefined();
    expect(JSON.stringify(meta)).not.toContain("secret");
  });

  it("edge case: description is sliced to 160 chars", async () => {
    const longDescription = "A".repeat(300);
    mockSingle.mockResolvedValueOnce({
      data: { title: "Title", description: longDescription },
      error: null,
    });

    const meta = await generateMetadata(makeParams("live-long-desc"));

    expect((meta.description as string).length).toBeLessThanOrEqual(160);
  });

  it("failure case: Supabase error resolves to fallback (not found) metadata", async () => {
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: "relation does not exist", code: "42P01" },
    });

    const meta = await generateMetadata(makeParams("error-id"));

    expect(meta.title).toBe("Listing Not Found");
  });
});
